type ReleaseTarget = {
  entry: string;
};

type DownloadTarget = {
  key: string;
  filename?: string;
};

type ReleaseManifest = {
  slug: string;
  version: string;
  sourceCommit: string;
  publishedAt: string;
  web?: ReleaseTarget;
  mac?: DownloadTarget;
  files: Array<{ key: string; size: number; sha256: string; contentType: string }>;
};

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const VERSION_RE = /^v(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$/;
const SHA_RE = /^[0-9a-f]{40}$/;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return await routeRequest(request, env);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(JSON.stringify({ message: "games request failed", error: message }));
      return new Response("Game service unavailable", {
        status: 500,
        headers: securityHeaders("text/plain; charset=utf-8")
      });
    }
  }
} satisfies ExportedHandler<Env>;

async function routeRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);

  if (request.method !== "GET" && request.method !== "HEAD") {
    const response = textResponse("Method not allowed", 405);
    response.headers.set("Allow", "GET, HEAD");
    return response;
  }

  const playMatch = /^\/play\/([^/]+)\/?$/.exec(url.pathname);
  if (playMatch) {
    return redirectToRelease(env, playMatch[1] ?? "", "web");
  }

  const downloadMatch = /^\/download\/([^/]+)\/mac\/?$/.exec(url.pathname);
  if (downloadMatch) {
    return redirectToRelease(env, downloadMatch[1] ?? "", "mac");
  }

  if (url.pathname === "/tracker" || url.pathname === "/tracker/") {
    return redirectToRelease(env, "motion-tracker", "web");
  }

  return env.ASSETS.fetch(request);
}

async function redirectToRelease(
  env: Env,
  slug: string,
  target: "web" | "mac"
): Promise<Response> {
  if (!SLUG_RE.test(slug)) {
    return textResponse("Unknown game", 404);
  }

  const manifest = await readManifest(env, slug);
  if (!manifest || manifest.slug !== slug) {
    return textResponse("Release not found", 404);
  }

  let path: string | undefined;
  if (target === "mac") {
    path = manifest.mac?.key;
  } else {
    const entry = manifest.web?.entry;
    if (entry && isSafeRelativePath(entry)) {
      path = `releases/${slug}/${manifest.version}/web/${entry}`;
    }
  }

  if (!path || !isSafeRelativePath(path)) {
    return textResponse(
      target === "mac" ? "Mac download is being prepared" : "Web release is being prepared",
      404
    );
  }

  const publicBase = new URL(env.R2_PUBLIC_BASE);
  return new Response(null, {
    status: 302,
    headers: {
      "Cache-Control": "no-store",
      Location: new URL(`/${path}`, publicBase).toString(),
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff"
    }
  });
}

async function readManifest(env: Env, slug: string): Promise<ReleaseManifest | null> {
  const object = await env.GAME_RELEASES.get(`manifests/${slug}/stable.json`);
  if (!object || object.size > 32_768) {
    return null;
  }

  const value: unknown = await object.json();
  if (!isReleaseManifest(value)) {
    console.error(JSON.stringify({ message: "invalid release manifest", slug }));
    return null;
  }
  return value;
}

function isReleaseManifest(value: unknown): value is ReleaseManifest {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  const allowedKeys = new Set(["slug", "version", "sourceCommit", "publishedAt", "web", "mac", "files"]);
  if (Object.keys(candidate).some((key) => !allowedKeys.has(key))) return false;
  if (!(typeof candidate.slug === "string"
    && SLUG_RE.test(candidate.slug)
    && typeof candidate.version === "string"
    && VERSION_RE.test(candidate.version)
    && typeof candidate.sourceCommit === "string"
    && SHA_RE.test(candidate.sourceCommit)
    && typeof candidate.publishedAt === "string"
    && Number.isFinite(Date.parse(candidate.publishedAt))
    && new Date(candidate.publishedAt).toISOString() === candidate.publishedAt)) {
    return false;
  }

  const validEntry = (target: unknown): boolean => {
    if (target === undefined) return true;
    if (!target || typeof target !== "object") return false;
    const record = target as Record<string, unknown>;
    if (Object.keys(record).some((key) => key !== "entry")) return false;
    const entry = record.entry;
    return typeof entry === "string" && isSafeRelativePath(entry);
  };

  const validDownload = (target: unknown): boolean => {
    if (target === undefined) return true;
    if (!target || typeof target !== "object") return false;
    const download = target as Record<string, unknown>;
    if (Object.keys(download).some((key) => key !== "key" && key !== "filename")) return false;
    const expectedKey = `downloads/${candidate.slug}/${candidate.version}/${candidate.slug}-macos-universal.zip`;
    return typeof download.key === "string"
      && download.key === expectedKey
      && download.filename === `${candidate.slug}-macos-universal.zip`;
  };

  if (!validEntry(candidate.web) || !validDownload(candidate.mac)) return false;
  if (candidate.web === undefined && candidate.mac === undefined) return false;
  if (!Array.isArray(candidate.files) || candidate.files.length === 0) return false;
  const keys = new Set<string>();
  for (const value of candidate.files) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const file = value as Record<string, unknown>;
    if (Object.keys(file).some((key) => !["key", "size", "sha256", "contentType"].includes(key))) return false;
    if (typeof file.key !== "string" || !isSafeRelativePath(file.key) || keys.has(file.key)) return false;
    if (!Number.isSafeInteger(file.size) || (file.size as number) <= 0) return false;
    if (typeof file.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(file.sha256)) return false;
    if (typeof file.contentType !== "string" || file.contentType.length === 0) return false;
    keys.add(file.key);
  }
  const web = candidate.web as ReleaseTarget | undefined;
  const mac = candidate.mac as DownloadTarget | undefined;
  if (web && !keys.has(`releases/${candidate.slug}/${candidate.version}/web/${web.entry}`)) return false;
  if (mac && !keys.has(mac.key)) return false;
  return true;
}

function securityHeaders(contentType: string): Headers {
  return new Headers({
    "Content-Type": contentType,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(self), microphone=()"
  });
}

function textResponse(message: string, status: number): Response {
  return new Response(message, {
    status,
    headers: securityHeaders("text/plain; charset=utf-8")
  });
}

function safeObjectKey(pathname: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname).replace(/^\/+/, "");
  } catch {
    return null;
  }
  if (!decoded || decoded.includes("\\") || decoded.includes("\0")) return null;
  if (decoded.split("/").some((part) => !part || part === "." || part === "..")) return null;
  return decoded;
}

function isSafeRelativePath(path: string): boolean {
  return safeObjectKey(`/${path}`) === path && !path.startsWith("/");
}

export const testable = {
  isReleaseManifest,
  isSafeRelativePath,
  safeObjectKey
};
