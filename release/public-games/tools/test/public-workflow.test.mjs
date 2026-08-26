import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const portalRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const workflow = await readFile(path.join(portalRoot, ".github/workflows/release-public-game.yml"), "utf8");
const releaseDocs = await readFile(path.join(portalRoot, "release/public-games/README.md"), "utf8");
const credentialDocs = await readFile(path.join(portalRoot, "docs/ci-credentials.md"), "utf8");
const privateCandidateWorkflow = await readFile(path.join(portalRoot, "templates/game-repo/.github/workflows/release.yml"), "utf8");
const portalDeployWorkflow = await readFile(path.join(portalRoot, ".github/workflows/deploy.yml"), "utf8");

function job(name, nextName = null) {
  const start = workflow.indexOf(`  ${name}:\n`);
  assert.notEqual(start, -1, `missing ${name} job`);
  const end = nextName ? workflow.indexOf(`  ${nextName}:\n`, start + 1) : workflow.length;
  assert.notEqual(end, -1, `missing ${nextName} job`);
  return workflow.slice(start, end);
}

test("central public release is manual-only with a fixed choice", () => {
  const trigger = workflow.slice(workflow.indexOf("on:\n"), workflow.indexOf("permissions:\n"));
  assert.match(trigger, /workflow_dispatch:/);
  assert.doesNotMatch(trigger, /\bpush:|pull_request:|schedule:/);
  const choices = [...trigger.matchAll(/^          - (.+)$/gm)].map((match) => match[1]);
  assert.deepEqual(choices, ["astro-bro", "racing-maze"]);
  assert.doesNotMatch(workflow, /^\s+- tower-defense\s*$/m);
});

test("every third-party action is pinned to a full commit", () => {
  const uses = [...workflow.matchAll(/^\s+uses:\s+([^\s#]+)/gm)].map((match) => match[1]);
  assert.ok(uses.length >= 6);
  for (const action of uses) assert.match(action, /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+@[0-9a-f]{40}$/);
});

test("workflow refuses non-main or mismatched workflow commits as defense in depth", () => {
  const authorize = job("authorize", "build-public-game");
  assert.match(authorize, /EVENT_REF: \$\{\{ github\.ref \}\}/);
  assert.match(authorize, /EXPECTED_PORTAL_SHA: \$\{\{ github\.workflow_sha \}\}/);
  assert.match(authorize, /WORKFLOW_REF: \$\{\{ github\.workflow_ref \}\}/);
  assert.match(authorize, /test "\$\{EVENT_REF\}" = "refs\/heads\/main"/);
  assert.match(authorize, /test "\$\{EVENT_SHA\}" = "\$\{EXPECTED_PORTAL_SHA\}"/);
});

test("documentation requires external protected-main review controls", () => {
  for (const docs of [releaseDocs, credentialDocs]) {
    assert.match(docs, /\*\*MUST\*\* protect/);
    assert.match(docs, /selected branch `main` only/);
    assert.match(docs, /require(?:d)?\s+(?:a |at least one )?reviewer/i);
    assert.match(docs, /prevent self-review/i);
    assert.match(docs, /defense in depth/i);
    assert.match(docs, /do not\s+prove|cannot\s+prove/i);
  }
});

test("public source build job has no environment or production secret references", () => {
  const build = job("build-public-game", "sign-and-publish");
  assert.match(build, /repository: \$\{\{ needs\.authorize\.outputs\.source_repository \}\}/);
  assert.match(build, /Verify exact public source before the fresh Mac stage/);
  assert.match(build, /Re-verify exact clean checkouts before artifact handoff/);
  assert.match(build, /\/usr\/bin\/git -C trusted status --porcelain=v1 --untracked-files=all/);
  assert.match(build, /\/usr\/bin\/git -C public-source status --porcelain=v1 --untracked-files=all/);
  assert.match(build, /status --porcelain=v1 --untracked-files=all/);
  assert.doesNotMatch(build, /^    environment:/m);
  assert.doesNotMatch(build, /\$\{\{\s*secrets\.|APPLE_|R2_ACCESS_KEY|R2_SECRET|CLOUDFLARE_ACCOUNT_ID/);
});

test("central-only tooling is not embedded in the reusable private-game template", async () => {
  const templateTools = path.join(portalRoot, "templates/game-repo/.github/release-tools");
  for (const name of ["public-source.mjs", "public-source-cli.mjs", "artifact-container.mjs", "artifact-container-cli.mjs"]) {
    await assert.rejects(readFile(path.join(templateTools, name)), /ENOENT/);
  }
});

test("private game candidate workflow has no production credential path", () => {
  assert.match(privateCandidateWorkflow, /name: Build game release candidate/);
  assert.match(privateCandidateWorkflow, /retention-days: 1/);
  assert.doesNotMatch(privateCandidateWorkflow, /environment:|\$\{\{\s*secrets\.|R2_ACCESS_KEY|R2_SECRET_ACCESS_KEY|APPLE_DEVELOPER_ID|sign-notarize-macos|publish-release\.mjs/);
});

test("portal deployment is manual, pinned, and isolated from game release secrets", () => {
  assert.match(portalDeployWorkflow, /github\.event_name == 'workflow_dispatch'/);
  assert.match(portalDeployWorkflow, /environment: portal-production/);
  assert.doesNotMatch(portalDeployWorkflow, /R2_ACCESS_KEY|R2_SECRET_ACCESS_KEY|APPLE_/);
  const uses = [...portalDeployWorkflow.matchAll(/^\s+-?\s*uses:\s+([^\s#]+)/gm)].map((match) => match[1]);
  assert.ok(uses.length >= 4);
  for (const action of uses) assert.match(action, /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+@[0-9a-f]{40}$/);
});

test("production job never checks out or runs public source", () => {
  const publish = job("sign-and-publish");
  assert.match(publish, /environment:\n      name: game-release-production/);
  assert.match(publish, /test ! -e public-source/);
  assert.doesNotMatch(publish, /repository: \$\{\{ needs\.authorize\.outputs\.source_repository \}\}/);
  assert.equal((publish.match(/uses: actions\/checkout@/g) ?? []).length, 1);
  assert.equal((publish.match(/artifact-container-cli\.mjs" unpack/g) ?? []).length, 2);
  assert.ok(publish.indexOf("artifact-container-cli.mjs\" unpack") < publish.indexOf("APPLE_DEVELOPER_ID_P12_BASE64"));
  assert.ok(publish.indexOf("sign-notarize-macos.sh") < publish.indexOf("publish-release.mjs"));
});
