import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { testable } from "../src/worker";

const sha = "e05e32210d2023ac75605784a866c697a4970320";
function manifest(version = "v1.5.0") {
  return {
    slug: "butts", version, sourceCommit: sha, publishedAt: "2026-08-31T03:34:35.238Z",
    web: { entry: "index.html" },
    files: [{ key: `releases/butts/${version}/web/index.html`, size: 10,
      sha256: "a".repeat(64), contentType: "text/html; charset=utf-8" }]
  };
}
const url = "https://games.gregeland.com/api/releases/butts";

describe("live catalog release metadata", () => {
  it("includes the latest Commanders release made by the pre-timestamp publisher", async () => {
    const release = { ...manifest("v1.3.0"), slug: "commanders",
      sourceCommit: "0dcc1135713001c8a3bba41b460c4ed6e0a2b624",
      files: [{ ...manifest().files[0], key: "releases/commanders/v1.3.0/web/index.html" }] };
    await env.GAME_RELEASES.put("manifests/commanders/stable.json", JSON.stringify(release));
    expect(await (await SELF.fetch("https://games.gregeland.com/api/releases/commanders")).json()).toEqual({
      slug: "commanders", version: "v1.3.0", sourceCommit: release.sourceCommit,
      sourceCommittedAt: "2026-09-02T15:41:44.000Z"
    });
  });

  it("returns only public display identity with the verified legacy commit date", async () => {
    await env.GAME_RELEASES.put("manifests/butts/stable.json", JSON.stringify(manifest()));
    const response = await SELF.fetch(url);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toEqual({ slug: "butts", version: "v1.5.0", sourceCommit: sha,
      sourceCommittedAt: "2026-08-31T02:28:16.000Z" });
  });

  it("reads a promoted release immediately without a portal build and retains play routing", async () => {
    await env.GAME_RELEASES.put("manifests/butts/stable.json", JSON.stringify(manifest()));
    expect((await (await SELF.fetch(url)).json() as { version: string }).version).toBe("v1.5.0");
    const next = { ...manifest("v1.6.0"), sourceCommit: "b".repeat(40), sourceCommittedAt: "2026-09-03T01:00:00.000Z" };
    await env.GAME_RELEASES.put("manifests/butts/stable.json", JSON.stringify(next));
    expect(await (await SELF.fetch(url)).json()).toEqual({ slug: "butts", version: "v1.6.0",
      sourceCommit: next.sourceCommit, sourceCommittedAt: next.sourceCommittedAt });
    expect((await SELF.fetch("https://games.gregeland.com/play/butts", { redirect: "manual" })).headers.get("location"))
      .toContain("/v1.6.0/web/index.html");
  });

  it("does not substitute a publication timestamp for an unknown commit date", async () => {
    await env.GAME_RELEASES.put("manifests/butts/stable.json", JSON.stringify({ ...manifest(), sourceCommit: "c".repeat(40) }));
    expect((await (await SELF.fetch(url)).json() as { sourceCommittedAt: unknown }).sourceCommittedAt).toBeNull();
  });

  it.each([
    { name: "missing", value: null }, { name: "invalid JSON", value: "{broken" },
    { name: "oversized", value: "x".repeat(32_769) },
    { name: "wrong slug", value: JSON.stringify({ ...manifest(), slug: "astro-bro" }) },
    { name: "invalid date", value: JSON.stringify({ ...manifest(), sourceCommittedAt: "yesterday" }) }
  ])("rejects $name manifests", async ({ value }) => {
    await env.GAME_RELEASES.delete("manifests/butts/stable.json");
    if (value !== null) await env.GAME_RELEASES.put("manifests/butts/stable.json", value);
    expect((await SELF.fetch(url)).status).toBe(404);
  });

  it.each(["dognado", "unknown", "%2e%2e", "butts/extra", "constructor"])("only exposes managed game slugs: %s", async (slug) => {
    expect((await SELF.fetch(`https://games.gregeland.com/api/releases/${slug}`)).status).toBe(404);
  });

  it("supports HEAD and rejects writes", async () => {
    await env.GAME_RELEASES.put("manifests/butts/stable.json", JSON.stringify(manifest()));
    const head = await SELF.fetch(url, { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
    const post = await SELF.fetch(url, { method: "POST" });
    expect(post.status).toBe(405);
    expect(post.headers.get("allow")).toBe("GET, HEAD");
  });

  it("keeps old manifests valid but rejects invalid optional timestamps", () => {
    expect(testable.isReleaseManifest(manifest())).toBe(true);
    for (const sourceCommittedAt of [null, 123, "2026-02-30T00:00:00.000Z", "2026-08-31", "invalid"]) {
      expect(testable.isReleaseManifest({ ...manifest(), sourceCommittedAt })).toBe(false);
    }
  });
});
