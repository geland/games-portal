import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { releasePresentation, refreshReleaseCard, refreshReleaseCards } from "../public/release-metadata.js";

const release = { slug: "butts", version: "v1.5.0", sourceCommit: "a".repeat(40), sourceCommittedAt: "2026-08-31T02:28:16.000Z" };

test("both protected publishers pass trusted commit metadata into publication", async () => {
  for (const kind of ["private", "public"]) {
    const workflow = await readFile(new URL(`../.github/workflows/release-${kind}-game.yml`, import.meta.url), "utf8");
    assert.match(workflow, /id: source_metadata/);
    assert.match(workflow, /SOURCE_COMMITTED_AT: \$\{\{ steps.source_metadata.outputs.source_committed_at \}\}/);
    assert.ok(workflow.indexOf('/source-commit.mjs"') < workflow.indexOf('/publish-release.mjs"'));
    assert.match(workflow, /SOURCE_REPOSITORY: \$\{\{ needs.authorize.outputs.source_repository \}\}/);
  }
});

function card(slug = "butts") {
  const version = { textContent: "v1.2.0" };
  const time = { textContent: "Updated Aug 27, 2026", dateTime: "2026-08-27", parentElement: { hidden: false } };
  return { dataset: { releaseSlug: slug }, version, time,
    querySelector(selector) { return selector.endsWith("time") ? time : version; } };
}

test("dates use the published commit in Pacific time, including daylight saving boundaries", () => {
  assert.equal(releasePresentation(release, "butts").label, "Updated Aug 30, 2026");
  assert.equal(releasePresentation({ ...release, sourceCommittedAt: "2026-09-02T01:01:08.000Z" }, "butts").date, "2026-09-01");
  assert.equal(releasePresentation({ ...release, sourceCommittedAt: "2026-01-01T07:59:59.000Z" }, "butts").date, "2025-12-31");
  assert.equal(releasePresentation({ ...release, sourceCommittedAt: "2026-01-01T08:00:00.000Z" }, "butts").date, "2026-01-01");
});

test("rejects mismatched identities and malformed data", () => {
  for (const data of [null, {}, { ...release, slug: "commanders" }, { ...release, version: "<script>" },
    { ...release, version: "v01.0.0" }, { ...release, sourceCommit: "short" },
    { ...release, sourceCommittedAt: "2026-02-30T00:00:00.000Z" }, { ...release, sourceCommittedAt: undefined }]) {
    assert.equal(releasePresentation(data, "butts"), null);
  }
});

test("updates both fields and requests uncached metadata with a timeout", async () => {
  const target = card();
  await refreshReleaseCard(target, async (url, options) => {
    assert.equal(url, "/api/releases/butts");
    assert.equal(options.cache, "no-store");
    assert.ok(options.signal instanceof AbortSignal);
    return Response.json(release);
  });
  assert.equal(target.version.textContent, "v1.5.0");
  assert.equal(target.time.dateTime, "2026-08-30");
  assert.equal(target.time.textContent, "Updated Aug 30, 2026");
  assert.equal(target.time.parentElement.hidden, false);
});

test("failed requests preserve the static fallback without blocking other cards", async () => {
  for (const fetcher of [async () => { throw new Error("offline/timeout"); },
    async () => new Response("unavailable", { status: 503 }), async () => new Response("{broken"),
    async () => Response.json({ ...release, slug: "wrong" })]) {
    const target = card();
    await refreshReleaseCard(target, fetcher);
    assert.equal(target.version.textContent, "v1.2.0");
    assert.equal(target.time.dateTime, "2026-08-27");
  }
  const bad = card("commanders"), good = card();
  await refreshReleaseCards([bad, good], async (url) => {
    if (url.includes("commanders")) throw new Error("offline");
    return Response.json(release);
  });
  assert.equal(good.version.textContent, "v1.5.0");
  assert.equal(bad.version.textContent, "v1.2.0");
});

test("an unknown legacy date is hidden instead of retaining a mismatched date", async () => {
  const target = card();
  await refreshReleaseCard(target, async () => Response.json({ ...release, sourceCommittedAt: null }));
  assert.equal(target.version.textContent, "v1.5.0");
  assert.equal(target.time.parentElement.hidden, true);
  await refreshReleaseCard(target, async () => Response.json(release));
  assert.equal(target.time.parentElement.hidden, false);
});

test("all managed cards are wired and external Pages cards remain static", async () => {
  const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
  const slugs = [...html.matchAll(/data-release-slug="([^"]+)"/g)].map((match) => match[1]);
  const expected = [];
  for (const registry of ["private", "public"]) {
    const data = JSON.parse(await readFile(new URL(`../release/${registry}-games/registry.json`, import.meta.url), "utf8"));
    expected.push(...Object.keys(data.games));
  }
  assert.deepEqual(slugs.sort(), expected.sort());
  assert.match(html, /app.js\?v=geland-4" type="module"/);
  assert.match(html, /v1\.5\.0<\/span><span><time datetime="2026-08-30"/);
  assert.match(html, /v1\.3\.0<\/span><span><time datetime="2026-09-02"/);
});
