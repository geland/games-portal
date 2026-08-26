const PROBE_PATH = "/v1/probe";
const HEALTH_PATH = "/healthz";
const MAX_KEY_LENGTH = 1_024;
const encoder = new TextEncoder();
type OriginProbeRuntimeEnv = OriginProbeEnv & { readonly RELEASE_ORIGIN_PROBE_TOKEN: string };

export default {
  async fetch(request: Request, env: OriginProbeRuntimeEnv): Promise<Response> {
    try {
      return await routeRequest(request, env);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(JSON.stringify({ message: "release origin probe failed", error: message }));
      return textResponse("Probe unavailable", 502);
    }
  }
} satisfies ExportedHandler<OriginProbeRuntimeEnv>;

async function routeRequest(request: Request, env: OriginProbeRuntimeEnv): Promise<Response> {
  const url = new URL(request.url);

  if (url.pathname === HEALTH_PATH && (request.method === "GET" || request.method === "HEAD")) {
    return new Response(request.method === "HEAD" ? null : "ok", {
      status: 200,
      headers: responseHeaders("text/plain; charset=utf-8")
    });
  }

  if (url.pathname !== PROBE_PATH) return textResponse("Not found", 404);
  if (request.method !== "HEAD") {
    const response = textResponse("Method not allowed", 405);
    response.headers.set("Allow", "HEAD");
    return response;
  }
  if (!await isAuthorized(request, env.RELEASE_ORIGIN_PROBE_TOKEN)) {
    return textResponse("Unauthorized", 401);
  }
  if ([...url.searchParams.keys()].some((key) => key !== "key") || url.searchParams.getAll("key").length !== 1) {
    return textResponse("Invalid probe", 400);
  }

  const key = validateProbeKey(url.searchParams.get("key"));
  if (!key) return textResponse("Invalid probe", 400);

  const publicBase = new URL(env.R2_PUBLIC_BASE);
  if (publicBase.origin !== "https://play.games.gregeland.com" || publicBase.pathname !== "/") {
    throw new Error("R2 public origin configuration is invalid");
  }

  const origin = await fetch(new URL(`/${key}`, publicBase), {
    method: "HEAD",
    redirect: "manual",
    headers: { "user-agent": "Gregeland-Games-Origin-Probe/1.0" }
  });
  return new Response(null, { status: 204, headers: originResultHeaders(origin) });
}

async function isAuthorized(request: Request, expectedToken: string): Promise<boolean> {
  const authorization = request.headers.get("authorization") ?? "";
  const actualToken = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  const [actualDigest, expectedDigest] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(actualToken)),
    crypto.subtle.digest("SHA-256", encoder.encode(expectedToken))
  ]);
  const subtle = crypto.subtle as SubtleCrypto & {
    timingSafeEqual(a: ArrayBuffer | ArrayBufferView, b: ArrayBuffer | ArrayBufferView): boolean;
  };
  return subtle.timingSafeEqual(actualDigest, expectedDigest) && actualToken.length > 0;
}

function validateProbeKey(value: string | null): string | null {
  if (!value || value.length > MAX_KEY_LENGTH || value.includes("\\") || value.includes("\0")) return null;
  const parts = value.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) return null;
  if (parts[0] !== "releases" && parts[0] !== "downloads") return null;
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(parts[1] ?? "")) return null;
  if (!/^v(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$/.test(parts[2] ?? "")) return null;
  return value;
}

function originResultHeaders(origin: Response): Headers {
  const headers = responseHeaders("text/plain; charset=utf-8");
  headers.set("X-Gregeland-Origin-Status", String(origin.status));
  for (const name of ["content-type", "content-length", "cf-cache-status", "age", "cf-ray", "cf-mitigated", "server"]) {
    const value = origin.headers.get(name);
    if (value) headers.set(`X-Gregeland-Origin-${name}`, value);
  }
  return headers;
}

function responseHeaders(contentType: string): Headers {
  return new Headers({
    "Content-Type": contentType,
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY"
  });
}

function textResponse(message: string, status: number): Response {
  return new Response(message, { status, headers: responseHeaders("text/plain; charset=utf-8") });
}

export const testable = { isAuthorized, originResultHeaders, validateProbeKey };
