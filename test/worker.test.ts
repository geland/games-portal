import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { testable } from "../src/worker";

describe("release gateway", () => {
  it("redirects a stable play URL through a validated manifest", async () => {
    await env.GAME_RELEASES.put("manifests/astro-bro/stable.json", JSON.stringify({
      slug: "astro-bro",
      version: "v1.0.0",
      sourceCommit: "0123456789abcdef0123456789abcdef01234567",
      publishedAt: "2026-08-25T12:00:00.000Z",
      web: { entry: "index.html" },
      files: [{
        key: "releases/astro-bro/v1.0.0/web/index.html",
        size: 100,
        sha256: "a".repeat(64),
        contentType: "text/html; charset=utf-8"
      }]
    }));

    const response = await SELF.fetch("https://games.gregeland.com/play/astro-bro", { redirect: "manual" });
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "https://play.games.gregeland.com/releases/astro-bro/v1.0.0/web/index.html"
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("rejects an unsafe download target in a manifest", () => {
    expect(testable.isReleaseManifest({
      slug: "astro-bro",
      version: "v1.0.0",
      sourceCommit: "0123456789abcdef0123456789abcdef01234567",
      publishedAt: "2026-08-25T12:00:00.000Z",
      mac: { key: "downloads/astro-bro/../private.zip", filename: "private.zip" },
      files: [{ key: "downloads/astro-bro/../private.zip", size: 1, sha256: "a".repeat(64), contentType: "application/zip" }]
    })).toBe(false);
  });

  it("redirects a notarized Mac download to the R2 custom domain", async () => {
    await env.GAME_RELEASES.put("manifests/racing-maze/stable.json", JSON.stringify({
      slug: "racing-maze",
      version: "v1.0.0",
      sourceCommit: "0123456789abcdef0123456789abcdef01234567",
      publishedAt: "2026-08-25T12:00:00.000Z",
      mac: {
        key: "downloads/racing-maze/v1.0.0/racing-maze-macos-universal.zip",
        filename: "racing-maze-macos-universal.zip"
      },
      files: [{
        key: "downloads/racing-maze/v1.0.0/racing-maze-macos-universal.zip",
        size: 100,
        sha256: "b".repeat(64),
        contentType: "application/zip"
      }]
    }));

    const response = await SELF.fetch(
      "https://games.gregeland.com/download/racing-maze/mac",
      { redirect: "manual" }
    );
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "https://play.games.gregeland.com/downloads/racing-maze/v1.0.0/racing-maze-macos-universal.zip"
    );
  });

  it("rejects unsupported methods with hardened response headers", async () => {
    const response = await SELF.fetch("https://games.gregeland.com/play/astro-bro", {
      method: "POST"
    });
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET, HEAD");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("rejects traversal-shaped object keys", () => {
    expect(testable.safeObjectKey("/releases/../secret")).toBeNull();
    expect(testable.safeObjectKey("/releases/%2e%2e/secret")).toBeNull();
    expect(testable.isSafeRelativePath("index.html")).toBe(true);
  });
});
