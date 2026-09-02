import assert from "node:assert/strict";
import test from "node:test";
import { fetchSourceCommitDate, sourceCommitDate } from "../source-commit.mjs";

const sha = "a".repeat(40);
const commit = { sha, committer: { date: "2026-08-31T02:28:16Z" }, author: { date: "2025-01-01T00:00:00Z" } };

test("uses the exact commit committer date, never the author date or branch HEAD", () => {
  assert.equal(sourceCommitDate(commit, sha), "2026-08-31T02:28:16.000Z");
  assert.throws(() => sourceCommitDate(commit, "b".repeat(40)), /approved source SHA/);
  for (const date of [null, "2026-02-30T00:00:00Z", "yesterday", "2026-08-31T02:28:16Z\nvalue=bad"]) {
    assert.throws(() => sourceCommitDate({ sha, committer: { date } }, sha), /date is invalid/);
  }
});

test("reads a fixed GitHub endpoint with bounded lifetime and refuses redirects", async () => {
  const date = await fetchSourceCommitDate("geland/butts", sha, "test-token", async (url, options) => {
    assert.equal(url, `https://api.github.com/repos/geland/butts/git/commits/${sha}`);
    assert.equal(options.redirect, "error");
    assert.ok(options.signal instanceof AbortSignal);
    return Response.json(commit);
  });
  assert.equal(date, "2026-08-31T02:28:16.000Z");
});

test("fails closed on API errors, invalid identities, oversized or malformed data", async () => {
  await assert.rejects(fetchSourceCommitDate("geland/butts", sha, "test-token", async () => new Response("missing", { status: 404 })), /HTTP 404/);
  await assert.rejects(fetchSourceCommitDate("geland/butts", sha, "test-token", async () => new Response("x".repeat(2 * 1024 * 1024 + 1))), /too large/);
  await assert.rejects(fetchSourceCommitDate("geland/butts", sha, "test-token", async () => new Response("bad JSON")));
  await assert.rejects(fetchSourceCommitDate("geland/butts", "main", "test-token"), /identity/);
  await assert.rejects(fetchSourceCommitDate("geland/butts/extra", sha, "test-token"), /identity/);
  await assert.rejects(fetchSourceCommitDate("geland/butts", sha, ""), /required/);
});
