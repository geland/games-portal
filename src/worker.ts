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
  web?: ReleaseTarget;
  tracker?: ReleaseTarget;
  mac?: DownloadTarget;
};

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const VERSION_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

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
    return redirectToRelease(env, "web-dodge", "tracker");
  }

  return env.ASSETS.fetch(request);
}

async function redirectToRelease(
  env: Env,
  slug: string,
  target: "web" | "tracker" | "mac"
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
    const entry = manifest[target]?.entry;
    if (entry && isSafeRelativePath(entry)) {
      const section = target === "tracker" ? "tracker" : "web";
      path = `releases/${slug}/${manifest.version}/${section}/${entry}`;
    }
  }

  if (!path || !isSafeRelativePath(path)) {
    return textResponse(
      target === "mac" ? "Mac download is being prepared" : "Web release is being prepared",
      404
    );
  }

  const publicBase = new URL(env.R2_PUBLIC_BASE);
  return Response.redirect(new URL(`/${path}`, publicBase).toString(), 302);
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
  if (!(typeof candidate.slug === "string"
    && SLUG_RE.test(candidate.slug)
    && typeof candidate.version === "string"
    && VERSION_RE.test(candidate.version))) {
    return false;
  }

  const validEntry = (target: unknown): boolean => {
    if (target === undefined) return true;
    if (!target || typeof target !== "object") return false;
    const entry = (target as Record<string, unknown>).entry;
    return typeof entry === "string" && isSafeRelativePath(entry);
  };

  const validDownload = (target: unknown): boolean => {
    if (target === undefined) return true;
    if (!target || typeof target !== "object") return false;
    const download = target as Record<string, unknown>;
    return typeof download.key === "string"
      && isSafeRelativePath(download.key)
      && download.key.startsWith(`downloads/${candidate.slug}/${candidate.version}/`)
      && (download.filename === undefined
        || (typeof download.filename === "string"
          && download.filename.length > 0
          && download.filename.length <= 255
          && !/[\\/\u0000-\u001f\u007f]/.test(download.filename)));
  };

  return validEntry(candidate.web)
    && validEntry(candidate.tracker)
    && validDownload(candidate.mac);
}

function securityHeaders(contentType: string): Headers {
  return new Headers({
    "Content-Type": contentType,
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
