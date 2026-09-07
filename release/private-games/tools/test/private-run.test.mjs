import assert from "node:assert/strict";
import test from "node:test";
import { selectCandidateReleaseAssets, validateAnnotatedTag, validateCandidateRelease, validateCandidateReleaseTagReference, validateCandidateRun, validateTagReference } from "../private-run.mjs";

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

function asset(id, name, overrides = {}) {
  return {
    id,
    name,
    size: 1024,
    state: "uploaded",
    digest: `sha256:${"c".repeat(64)}`,
    ...overrides
  };
}

function release(overrides = {}) {
  return {
    id: 42,
    tag_name: version,
    target_commitish: sourceSha,
    draft: false,
    prerelease: true,
    assets: [],
    ...overrides
  };
}

const expectedRun = {
  repository,
  runId,
  sourceSha,
  version,
  workflow: ".github/workflows/release.yml",
  workflowName: "Build game release candidate"
};

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

test("candidate release requires the exact published prerelease identity", () => {
  assert.equal(validateCandidateRelease(release(), { sourceSha, version }).tag_name, version);
  assert.throws(() => validateCandidateRelease(release({ draft: true }), { sourceSha, version }), /published prerelease/);
  assert.throws(() => validateCandidateRelease(release({ prerelease: false }), { sourceSha, version }), /published prerelease/);
  assert.throws(() => validateCandidateRelease(release({ target_commitish: "d".repeat(40) }), { sourceSha, version }), /source SHA/);
});

test("Motion candidate release tags resolve to the exact approved source", () => {
  const staticTag = `${version}-static-candidates`;
  assert.deepEqual(
    validateCandidateReleaseTagReference(
      { ref: `refs/tags/${staticTag}`, object: { type: "commit", sha: sourceSha } },
      staticTag
    ),
    { type: "commit", sha: sourceSha }
  );
  assert.equal(
    validateCandidateRelease(release({ tag_name: staticTag }), { sourceSha, version, releaseTag: staticTag }).tag_name,
    staticTag
  );
  assert.throws(
    () => validateCandidateReleaseTagReference(
      { ref: `refs/tags/${version}-native-candidates`, object: { type: "commit", sha: sourceSha } },
      staticTag
    ),
    /does not match/
  );
});

test("candidate release asset set is complete and bounded", () => {
  const assets = [
    asset(10, "butts-v1.2.3-web.gpkg"),
    asset(11, "butts-v1.2.3-mac.gpkg")
  ];
  const selected = selectCandidateReleaseAssets(assets, {
    runId,
    sourceSha,
    candidateAssetNames: ["butts-v1.2.3-web.gpkg", "butts-v1.2.3-mac.gpkg"],
    candidateWebEnabled: true,
    candidateMacEnabled: true,
    webAssetName: "butts-v1.2.3-web.gpkg",
    macAssetName: "butts-v1.2.3-mac.gpkg"
  });
  assert.equal(selected.web.id, 10);
  assert.equal(selected.mac.id, 11);
});

test("candidate release asset validation rejects extra, incomplete, or mismatched data", () => {
  const expected = {
    runId,
    sourceSha,
    candidateAssetNames: ["butts-v1.2.3-web.gpkg"],
    candidateWebEnabled: true,
    candidateMacEnabled: false,
    webAssetName: "butts-v1.2.3-web.gpkg",
    macAssetName: ""
  };
  assert.throws(() => selectCandidateReleaseAssets([], expected), /unexpected asset count/);
  assert.throws(() => selectCandidateReleaseAssets([asset(10, expected.webAssetName, { state: "new" })], expected), /not uploaded/);
  assert.throws(() => selectCandidateReleaseAssets([asset(10, expected.webAssetName, { digest: null })], expected), /digest/);
  assert.throws(() => selectCandidateReleaseAssets([asset(10, "other-v1.2.3-web.gpkg")], expected), /unexpected/);
});

test("a shared Motion run must contain both exact packages while selecting one", () => {
  const shortSha = sourceSha.slice(0, 12);
  const dodge = `web-dodge-${version}-${shortSha}-web.gpkg`;
  const tracker = `motion-tracker-${version}-${shortSha}-web.gpkg`;
  const motionRun = run({
    repository: { full_name: "geland/motion-games" },
    name: `Static candidates from ${version} (push)`,
    path: ".github/workflows/static-release-candidates.yml"
  });
  assert.equal(validateCandidateRun(motionRun, {
    repository: "geland/motion-games",
    runId,
    sourceSha,
    version,
    workflow: ".github/workflows/static-release-candidates.yml",
    workflowName: `Static candidates from ${version} (push)`
  }).path, ".github/workflows/static-release-candidates.yml");
  const selected = selectCandidateReleaseAssets([asset(20, dodge), asset(21, tracker)], {
    runId,
    sourceSha,
    candidateAssetNames: [dodge, tracker],
    candidateWebEnabled: true,
    candidateMacEnabled: false,
    webAssetName: tracker,
    macAssetName: ""
  });
  assert.equal(selected.web.id, 21);
  const selectedDodge = selectCandidateReleaseAssets([asset(20, dodge), asset(21, tracker)], {
    runId,
    sourceSha,
    candidateAssetNames: [dodge, tracker],
    candidateWebEnabled: true,
    candidateMacEnabled: false,
    webAssetName: dodge,
    macAssetName: ""
  });
  assert.equal(selectedDodge.web.id, 20);
  assert.throws(() => selectCandidateReleaseAssets([asset(20, dodge)], {
    runId,
    sourceSha,
    candidateAssetNames: [dodge, tracker],
    candidateWebEnabled: true,
    candidateMacEnabled: false,
    webAssetName: dodge,
    macAssetName: ""
  }), /unexpected asset count/);
});

test("a shared native Motion run requires both same-run Mac packages while selecting one", () => {
  const shortSha = sourceSha.slice(0, 12);
  const balloon = `balloon-${version}-${shortSha}-mac.gpkg`;
  const labyrinth = `labyrinth-${version}-${shortSha}-mac.gpkg`;
  const motionRun = run({
    repository: { full_name: "geland/motion-games" },
    name: `Native candidates from ${version} (push)`,
    path: ".github/workflows/native-release-candidates.yml"
  });
  assert.equal(validateCandidateRun(motionRun, {
    repository: "geland/motion-games",
    runId,
    sourceSha,
    version,
    workflow: ".github/workflows/native-release-candidates.yml",
    workflowName: `Native candidates from ${version} (push)`
  }).path, ".github/workflows/native-release-candidates.yml");

  const expected = {
    runId,
    sourceSha,
    candidateAssetNames: [balloon, labyrinth],
    candidateWebEnabled: false,
    candidateMacEnabled: true,
    webAssetName: "",
    macAssetName: balloon
  };
  const selected = selectCandidateReleaseAssets([asset(30, balloon), asset(31, labyrinth)], expected);
  assert.equal(selected.web, null);
  assert.equal(selected.mac.id, 30);

  assert.throws(() => selectCandidateReleaseAssets([
    asset(30, balloon),
    asset(31, labyrinth, { size: 0 })
  ], expected), /size/);
  assert.throws(() => selectCandidateReleaseAssets([asset(30, balloon)], expected), /unexpected asset count/);
});
