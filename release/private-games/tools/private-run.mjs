const REPOSITORY_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const SHA_RE = /^[0-9a-f]{40}$/;
const VERSION_RE = /^v(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$/;
const DIGEST_RE = /^sha256:[0-9a-f]{64}$/;
const MAX_RELEASE_ASSET_BYTES = 2 * 1024 * 1024 * 1024 - 1;
const APPROVED_WORKFLOWS = new Map([
  [".github/workflows/release.yml", () => "Build game release candidate"],
  [".github/workflows/static-release-candidates.yml", (version) => `Static candidates from ${version} (push)`],
  [".github/workflows/native-release-candidates.yml", (version) => `Native candidates from ${version} (push)`]
]);

function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value;
}

function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label} must be a positive safe integer`);
  return value;
}

export function validateCandidateRun(runValue, expectedValue) {
  const run = object(runValue, "candidate workflow run");
  const expected = object(expectedValue, "expected candidate run");
  if (!REPOSITORY_RE.test(expected.repository ?? "")) throw new Error("expected repository is invalid");
  if (!SHA_RE.test(expected.sourceSha ?? "")) throw new Error("expected source SHA is invalid");
  if (!VERSION_RE.test(expected.version ?? "")) throw new Error("expected version is invalid");
  positiveInteger(expected.runId, "expected run ID");
  const expectedName = APPROVED_WORKFLOWS.get(expected.workflow)?.(expected.version);
  if (!expectedName || expectedName !== expected.workflowName) throw new Error("expected workflow identity is invalid");

  if (run.id !== expected.runId) throw new Error("candidate run ID does not match");
  if (object(run.repository, "candidate repository").full_name !== expected.repository) throw new Error("candidate repository does not match");
  if (run.name !== expected.workflowName) throw new Error("candidate workflow name does not match");
  if (run.path !== expected.workflow) throw new Error("candidate workflow path does not match");
  if (run.event !== "push") throw new Error("publishable candidate must be triggered by an exact version tag push");
  if (run.head_sha !== expected.sourceSha) throw new Error("candidate run source SHA does not match");
  if (run.head_branch !== expected.version) throw new Error("candidate run tag does not match the release version");
  if (run.status !== "completed" || run.conclusion !== "success") throw new Error("candidate workflow run did not complete successfully");
  positiveInteger(run.run_attempt, "candidate run attempt");
  return run;
}

export function validateTagReference(referenceValue, version) {
  if (!VERSION_RE.test(version ?? "")) throw new Error("expected version is invalid");
  const reference = object(referenceValue, "version tag reference");
  if (reference.ref !== `refs/tags/${version}`) throw new Error("version tag reference does not match");
  return validateGitObject(reference.object, "version tag object");
}

export function validateAnnotatedTag(tagValue, expectedTagSha) {
  if (!SHA_RE.test(expectedTagSha ?? "")) throw new Error("expected annotated tag SHA is invalid");
  const tag = object(tagValue, "annotated tag");
  if (tag.sha !== expectedTagSha) throw new Error("annotated tag SHA does not match");
  return validateGitObject(tag.object, "annotated tag target");
}

function validateGitObject(value, label) {
  const gitObject = object(value, label);
  if (!['commit', 'tag'].includes(gitObject.type)) throw new Error(`${label} type is invalid`);
  if (!SHA_RE.test(gitObject.sha ?? "")) throw new Error(`${label} SHA is invalid`);
  return { type: gitObject.type, sha: gitObject.sha };
}

export function validateCandidateRelease(releaseValue, expectedValue) {
  const release = object(releaseValue, "candidate release");
  const expected = object(expectedValue, "expected candidate release");
  if (!SHA_RE.test(expected.sourceSha ?? "")) throw new Error("expected source SHA is invalid");
  if (!VERSION_RE.test(expected.version ?? "")) throw new Error("expected version is invalid");
  positiveInteger(release.id, "candidate release ID");
  if (release.tag_name !== expected.version) throw new Error("candidate release tag does not match");
  if (release.target_commitish !== expected.sourceSha) throw new Error("candidate release source SHA does not match");
  if (release.draft !== false || release.prerelease !== true) throw new Error("candidate release must be a published prerelease");
  if (!Array.isArray(release.assets)) throw new Error("candidate release assets must be an array");
  return release;
}

export function selectCandidateReleaseAssets(assetsValue, expectedValue) {
  const expected = object(expectedValue, "expected candidate release assets");
  positiveInteger(expected.runId, "expected run ID");
  if (!SHA_RE.test(expected.sourceSha ?? "")) throw new Error("expected source SHA is invalid");
  const expectedNames = [];
  if (expected.candidateWebEnabled) expectedNames.push(expected.webAssetName);
  if (expected.candidateMacEnabled) expectedNames.push(expected.macAssetName);
  const allExpectedNames = expected.candidateAssetNames;
  const validName = (name) => typeof name === "string" && /^[a-z0-9][a-z0-9.+-]{0,199}\.gpkg$/.test(name);
  if (expectedNames.length === 0 || expectedNames.some((name) => !validName(name))) {
    throw new Error("expected candidate release asset names are invalid");
  }
  if (!Array.isArray(allExpectedNames)
      || allExpectedNames.length === 0
      || allExpectedNames.length > 10
      || allExpectedNames.some((name) => !validName(name))
      || new Set(allExpectedNames).size !== allExpectedNames.length
      || expectedNames.some((name) => !allExpectedNames.includes(name))) {
    throw new Error("complete candidate release asset names are invalid");
  }
  if (!Array.isArray(assetsValue)) throw new Error("candidate release assets must be an array");
  if (assetsValue.length !== allExpectedNames.length) throw new Error("candidate release has an unexpected asset count");

  const selected = new Map();
  for (const assetValue of assetsValue) {
    const asset = object(assetValue, "candidate release asset");
    if (!allExpectedNames.includes(asset.name) || selected.has(asset.name)) throw new Error("candidate release has an unexpected or duplicate asset");
    positiveInteger(asset.id, "candidate release asset ID");
    if (!Number.isSafeInteger(asset.size) || asset.size <= 0 || asset.size > MAX_RELEASE_ASSET_BYTES) {
      throw new Error("candidate release asset size is invalid");
    }
    if (asset.state !== "uploaded") throw new Error("candidate release asset is not uploaded");
    if (!DIGEST_RE.test(asset.digest ?? "")) throw new Error("candidate release asset digest is invalid");
    selected.set(asset.name, { id: asset.id, digest: asset.digest });
  }

  return {
    web: expected.candidateWebEnabled ? selected.get(expected.webAssetName) : null,
    mac: expected.candidateMacEnabled ? selected.get(expected.macAssetName) : null
  };
}
