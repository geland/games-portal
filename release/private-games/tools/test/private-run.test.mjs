import assert from "node:assert/strict";
import test from "node:test";
import { selectCandidateArtifacts, validateAnnotatedTag, validateCandidateRun, validateTagReference } from "../private-run.mjs";

const runId = 32920663099;
const sourceSha = "b".repeat(40);
const version = "v1.2.3";
const repository = "geland/butts";

function run(overrides = {}) {
  return {
    id: runId,
    repository: { full_name: repository },
    name: "Build game release candidate",
    path: ".github/workflows/release.yml",
    event: "push",
    head_sha: sourceSha,
    head_branch: version,
    status: "completed",
    conclusion: "success",
    run_attempt: 1,
    ...overrides
  };
}

function artifact(id, name, overrides = {}) {
  return {
    id,
    name,
    size_in_bytes: 1024,
    expired: false,
    digest: `sha256:${"c".repeat(64)}`,
    workflow_run: { id: runId, head_sha: sourceSha },
    ...overrides
  };
}

const expectedRun = { repository, runId, sourceSha, version, workflow: ".github/workflows/release.yml" };

test("candidate run requires a successful exact tag build", () => {
  assert.equal(validateCandidateRun(run(), expectedRun).head_sha, sourceSha);
  assert.throws(() => validateCandidateRun(run({ event: "workflow_dispatch" }), expectedRun), /version tag push/);
  assert.throws(() => validateCandidateRun(run({ head_sha: "d".repeat(40) }), expectedRun), /source SHA/);
  assert.throws(() => validateCandidateRun(run({ head_branch: "v1.2.4" }), expectedRun), /tag/);
  assert.throws(() => validateCandidateRun(run({ conclusion: "failure" }), expectedRun), /successfully/);
});

test("version tag references resolve through bounded annotated tags", () => {
  const commit = validateTagReference({ ref: `refs/tags/${version}`, object: { type: "commit", sha: sourceSha } }, version);
  assert.deepEqual(commit, { type: "commit", sha: sourceSha });
  const tagSha = "d".repeat(40);
  const annotated = validateTagReference({ ref: `refs/tags/${version}`, object: { type: "tag", sha: tagSha } }, version);
  assert.deepEqual(annotated, { type: "tag", sha: tagSha });
  assert.deepEqual(
    validateAnnotatedTag({ sha: tagSha, object: { type: "commit", sha: sourceSha } }, tagSha),
    { type: "commit", sha: sourceSha }
  );
  assert.throws(() => validateTagReference({ ref: "refs/heads/v1.2.3", object: { type: "commit", sha: sourceSha } }, version), /does not match/);
  assert.throws(() => validateAnnotatedTag({ sha: tagSha, object: { type: "blob", sha: sourceSha } }, tagSha), /type/);
});

test("candidate artifact set is complete, bounded, and tied to the run", () => {
  const response = {
    total_count: 2,
    artifacts: [
      artifact(10, "butts-v1.2.3-web-gpkg"),
      artifact(11, "butts-v1.2.3-mac-gpkg")
    ]
  };
  const selected = selectCandidateArtifacts(response, {
    runId,
    sourceSha,
    candidateWebEnabled: true,
    candidateMacEnabled: true,
    webArtifactName: "butts-v1.2.3-web-gpkg",
    macArtifactName: "butts-v1.2.3-mac-gpkg"
  });
  assert.equal(selected.web.id, 10);
  assert.equal(selected.mac.id, 11);
});

test("candidate artifact validation rejects hidden, expired, or mismatched data", () => {
  const expected = {
    runId,
    sourceSha,
    candidateWebEnabled: true,
    candidateMacEnabled: false,
    webArtifactName: "butts-v1.2.3-web-gpkg",
    macArtifactName: ""
  };
  assert.throws(() => selectCandidateArtifacts({ total_count: 2, artifacts: [artifact(10, expected.webArtifactName)] }, expected), /incomplete/);
  assert.throws(() => selectCandidateArtifacts({ total_count: 1, artifacts: [artifact(10, expected.webArtifactName, { expired: true })] }, expected), /expired/);
  assert.throws(() => selectCandidateArtifacts({ total_count: 1, artifacts: [artifact(10, expected.webArtifactName, { digest: null })] }, expected), /digest/);
  assert.throws(() => selectCandidateArtifacts({ total_count: 1, artifacts: [artifact(10, expected.webArtifactName, { workflow_run: { id: 99, head_sha: sourceSha } })] }, expected), /identity/);
});
