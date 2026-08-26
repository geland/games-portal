import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const portalRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const workflow = await readFile(path.join(portalRoot, ".github/workflows/release-private-game.yml"), "utf8");
const candidate = await readFile(path.join(portalRoot, "templates/game-repo/.github/workflows/release.yml"), "utf8");
const releaseDocs = await readFile(path.join(portalRoot, "release/private-games/README.md"), "utf8");
const runVerifier = await readFile(path.join(portalRoot, "release/private-games/tools/private-run-cli.mjs"), "utf8");

function job(name, nextName = null) {
  const start = workflow.indexOf(`  ${name}:\n`);
  assert.notEqual(start, -1, `missing ${name} job`);
  const end = nextName ? workflow.indexOf(`  ${nextName}:\n`, start + 1) : workflow.length;
  assert.notEqual(end, -1, `missing ${nextName} job`);
  return workflow.slice(start, end);
}

test("private publication is manual-only and repository choices are fixed", () => {
  const trigger = workflow.slice(workflow.indexOf("on:\n"), workflow.indexOf("permissions:\n"));
  assert.match(trigger, /workflow_dispatch:/);
  assert.doesNotMatch(trigger, /\bpush:|pull_request:|schedule:/);
  for (const game of ["butts", "blend-in"]) assert.match(trigger, new RegExp(`^          - ${game}$`, "m"));
  assert.doesNotMatch(trigger, /^          - commanders$/m);
  assert.doesNotMatch(trigger, /repository:/);
});

test("every private-release third-party action is pinned", () => {
  const uses = [...workflow.matchAll(/^\s+uses:\s+([^\s#]+)/gm)].map((match) => match[1]);
  assert.ok(uses.length >= 4);
  for (const action of uses) assert.match(action, /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+@[0-9a-f]{40}$/);
});

test("authorization has no environment or credential", () => {
  const authorize = job("authorize", "verify-sign-publish");
  assert.match(authorize, /EXPECTED_WORKFLOW_REF:/);
  assert.match(authorize, /test "\$\{EVENT_REF\}" = "refs\/heads\/main"/);
  assert.doesNotMatch(authorize, /^    environment:/m);
  assert.doesNotMatch(authorize, /\$\{\{\s*secrets\./);
});

test("production receives only constrained candidate data", () => {
  const production = job("verify-sign-publish");
  assert.match(production, /environment:\n      name: game-release-production/);
  assert.doesNotMatch(production.slice(0, production.indexOf("    steps:")), /runner\.temp/);
  assert.equal((production.match(/uses: actions\/checkout@/g) ?? []).length, 1);
  assert.doesNotMatch(production, /repository: \$\{\{ needs\.authorize\.outputs\.source_repository \}\}\n\s+ref:/);
  assert.match(production, /test ! -e private-source/);
  assert.equal((production.match(/artifact-ids:/g) ?? []).length, 2);
  assert.equal((production.match(/digest-mismatch: error/g) ?? []).length, 2);
  assert.equal((production.match(/artifact-container-cli\.mjs" unpack/g) ?? []).length, 2);
  assert.ok(production.indexOf("private-run-cli.mjs\" verify") < production.indexOf("actions/download-artifact@"));
  assert.ok(production.indexOf("artifact-container-cli.mjs\" unpack") < production.indexOf("APPLE_DEVELOPER_ID_P12_BASE64"));
  assert.ok(production.indexOf("sign-notarize-macos.sh") < production.indexOf("publish-release.mjs"));
  assert.match(production, /MAC_ENTITLEMENTS:.*mac_entitlements != '' && format\('\{0\}\/trusted\/\{1\}'[^\n]+\|\| ''/);
  assert.match(runVerifier, /\/git\/ref\/tags\//);
  assert.match(runVerifier, /\/git\/ref\/heads\//);
  assert.ok(runVerifier.indexOf("/git/ref/tags/") < runVerifier.indexOf("/actions/runs/"));
});

test("source candidate packages data with no production credential path", () => {
  assert.match(candidate, /tags:\n      - 'v\*\.\*\.\*'/);
  assert.equal((candidate.match(/artifact-container-cli\.mjs pack/g) ?? []).length, 2);
  assert.match(candidate, /Re-verify exact clean source before artifact handoff/);
  assert.match(candidate, /retention-days: 1/);
  assert.doesNotMatch(candidate, /environment:|\$\{\{\s*secrets\.|R2_ACCESS_KEY|APPLE_DEVELOPER_ID|sign-notarize-macos|publish-release\.mjs/);
});

test("documentation makes exact tag provenance and external protection mandatory", () => {
  assert.match(releaseDocs, /ineligible for publication/);
  assert.match(releaseDocs, /exact\s+`vMAJOR\.MINOR\.PATCH`\s+tag/);
  assert.match(releaseDocs, /must remain main-only/i);
  assert.match(releaseDocs, /reviewer other than the dispatcher/i);
  assert.match(releaseDocs, /prevent self-review/i);
  assert.match(releaseDocs, /disallow bypass/i);
});
