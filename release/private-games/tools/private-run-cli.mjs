#!/usr/bin/env node
import { appendFile } from "node:fs/promises";
import process from "node:process";
import { selectCandidateArtifacts, validateAnnotatedTag, validateCandidateRun, validateTagReference } from "./private-run.mjs";

if (process.argv[2] !== "verify") throw new Error("usage: private-run-cli.mjs verify");

const repository = required("SOURCE_REPOSITORY");
const [owner, name, extra] = repository.split("/");
if (!owner || !name || extra) throw new Error("SOURCE_REPOSITORY is invalid");
const runIdText = required("BUILD_RUN_ID");
if (!/^[1-9][0-9]{0,18}$/.test(runIdText)) throw new Error("BUILD_RUN_ID is invalid");
const runId = Number(runIdText);
if (!Number.isSafeInteger(runId)) throw new Error("BUILD_RUN_ID is too large");
const sourceSha = required("SOURCE_SHA");
const version = required("RELEASE_VERSION");
const token = required("PRIVATE_ACTIONS_READ_TOKEN");
const apiRoot = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
const headers = {
  Accept: "application/vnd.github+json",
  Authorization: `Bearer ${token}`,
  "X-GitHub-Api-Version": "2026-03-10",
  "User-Agent": "geland-games-private-release-verifier"
};

const tagReference = await fetchJson(`${apiRoot}/git/ref/tags/${encodeURIComponent(version)}`, headers);
let target = validateTagReference(tagReference, version);
const seenTags = new Set();
for (let depth = 0; target.type === "tag"; depth += 1) {
  if (depth >= 5 || seenTags.has(target.sha)) throw new Error("version tag indirection is invalid");
  seenTags.add(target.sha);
  const annotatedTag = await fetchJson(`${apiRoot}/git/tags/${target.sha}`, headers);
  target = validateAnnotatedTag(annotatedTag, target.sha);
}
if (target.sha !== sourceSha) throw new Error("version tag does not resolve to the approved source SHA");
const ambiguousBranch = await fetchJson(`${apiRoot}/git/ref/heads/${encodeURIComponent(version)}`, headers, true);
if (ambiguousBranch !== null) throw new Error("a branch conflicts with the approved version tag name");

const run = await fetchJson(`${apiRoot}/actions/runs/${runId}`, headers);
validateCandidateRun(run, {
  repository,
  runId,
  sourceSha,
  version,
  workflow: required("SOURCE_WORKFLOW"),
  workflowName: required("SOURCE_WORKFLOW_NAME")
});

const artifactsResponse = await fetchJson(`${apiRoot}/actions/runs/${runId}/artifacts?per_page=100`, headers);
const selected = selectCandidateArtifacts(artifactsResponse, {
  runId,
  sourceSha,
  candidateArtifactNames: requiredArtifactNames("CANDIDATE_ARTIFACT_NAMES_JSON"),
  candidateWebEnabled: requiredBoolean("CANDIDATE_WEB_ENABLED"),
  candidateMacEnabled: requiredBoolean("CANDIDATE_MAC_ENABLED"),
  webArtifactName: process.env.WEB_ARTIFACT_NAME ?? "",
  macArtifactName: process.env.MAC_ARTIFACT_NAME ?? ""
});

const output = required("GITHUB_OUTPUT");
const values = {
  web_artifact_id: selected.web?.id ?? "",
  web_artifact_digest: selected.web?.digest ?? "",
  mac_artifact_id: selected.mac?.id ?? "",
  mac_artifact_digest: selected.mac?.digest ?? ""
};
await appendFile(output, Object.entries(values).map(([key, value]) => `${key}=${value}\n`).join(""));

async function fetchJson(url, requestHeaders, allowNotFound = false) {
  const response = await fetch(url, { headers: requestHeaders, redirect: "error" });
  if (allowNotFound && response.status === 404) return null;
  if (!response.ok) throw new Error(`GitHub Actions metadata request failed with HTTP ${response.status}`);
  const length = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(length) && length > 2 * 1024 * 1024) throw new Error("GitHub Actions metadata response is too large");
  return response.json();
}

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function requiredBoolean(name) {
  const value = required(name);
  if (value !== "true" && value !== "false") throw new Error(`${name} must be true or false`);
  return value === "true";
}

function requiredArtifactNames(name) {
  const raw = required(name);
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error(`${name} must be JSON`);
  }
  if (!Array.isArray(value)) throw new Error(`${name} must be a JSON array`);
  return value;
}
