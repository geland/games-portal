const REPOSITORY_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const SHA_RE = /^[0-9a-f]{40}$/;
const VERSION_RE = /^v(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$/;
const DIGEST_RE = /^sha256:[0-9a-f]{64}$/;
const MAX_ARTIFACT_BYTES = 5 * 1024 * 1024 * 1024;

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
  if (expected.workflow !== ".github/workflows/release.yml") throw new Error("expected workflow path is invalid");

  if (run.id !== expected.runId) throw new Error("candidate run ID does not match");
  if (object(run.repository, "candidate repository").full_name !== expected.repository) throw new Error("candidate repository does not match");
  if (run.name !== "Build game release candidate") throw new Error("candidate workflow name does not match");
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

export function selectCandidateArtifacts(responseValue, expectedValue) {
  const response = object(responseValue, "candidate artifact response");
  const expected = object(expectedValue, "expected candidate artifacts");
  positiveInteger(expected.runId, "expected run ID");
  if (!SHA_RE.test(expected.sourceSha ?? "")) throw new Error("expected source SHA is invalid");
  const expectedNames = [];
  if (expected.candidateWebEnabled) expectedNames.push(expected.webArtifactName);
  if (expected.candidateMacEnabled) expectedNames.push(expected.macArtifactName);
  if (expectedNames.length === 0 || expectedNames.some((name) => typeof name !== "string" || !/^[a-z0-9][a-z0-9.+-]{0,199}-gpkg$/.test(name))) {
    throw new Error("expected candidate artifact names are invalid");
  }
  if (!Array.isArray(response.artifacts)) throw new Error("candidate artifacts must be an array");
  if (response.total_count !== response.artifacts.length) throw new Error("candidate artifact response is incomplete");
  if (response.artifacts.length !== expectedNames.length) throw new Error("candidate run has an unexpected artifact count");

  const selected = new Map();
  for (const artifactValue of response.artifacts) {
    const artifact = object(artifactValue, "candidate artifact");
    if (!expectedNames.includes(artifact.name) || selected.has(artifact.name)) throw new Error("candidate run has an unexpected or duplicate artifact");
    positiveInteger(artifact.id, "candidate artifact ID");
    if (!Number.isSafeInteger(artifact.size_in_bytes) || artifact.size_in_bytes <= 0 || artifact.size_in_bytes > MAX_ARTIFACT_BYTES) {
      throw new Error("candidate artifact size is invalid");
    }
    if (artifact.expired !== false) throw new Error("candidate artifact is expired");
    if (!DIGEST_RE.test(artifact.digest ?? "")) throw new Error("candidate artifact digest is invalid");
    const workflowRun = object(artifact.workflow_run, "candidate artifact workflow run");
    if (workflowRun.id !== expected.runId || workflowRun.head_sha !== expected.sourceSha) {
      throw new Error("candidate artifact workflow identity does not match");
    }
    selected.set(artifact.name, { id: artifact.id, digest: artifact.digest });
  }

  return {
    web: expected.candidateWebEnabled ? selected.get(expected.webArtifactName) : null,
    mac: expected.candidateMacEnabled ? selected.get(expected.macArtifactName) : null
  };
}
