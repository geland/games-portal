#!/usr/bin/env node
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const VERSION_RE = /^v(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$/;
const SHA_RE = /^[0-9a-f]{40}$/;
const REPOSITORY_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const ASSET_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,199}$/;
const MAX_RELEASE_ASSET_BYTES = 2 * 1024 * 1024 * 1024 - 1;

const repository = required("RELEASE_REPOSITORY");
const version = required("RELEASE_VERSION");
const sourceCommit = required("SOURCE_COMMIT");
const token = required("GH_TOKEN");
const assetPaths = [
  optionalAsset("WEB_ENABLED", "WEB_PACKAGE"),
  optionalAsset("MAC_ENABLED", "MAC_PACKAGE")
].filter(Boolean);
if (assetPaths.length === 0) throw new Error("at least one candidate release target must be enabled");

if (!REPOSITORY_RE.test(repository)) throw new Error("RELEASE_REPOSITORY is invalid");
if (!VERSION_RE.test(version)) throw new Error("RELEASE_VERSION is invalid");
if (!SHA_RE.test(sourceCommit)) throw new Error("SOURCE_COMMIT is invalid");

const headers = {
  Accept: "application/vnd.github+json",
  Authorization: `Bearer ${token}`,
  "X-GitHub-Api-Version": "2026-03-10",
  "User-Agent": "gregeland-games-candidate-release"
};
const apiRoot = `https://api.github.com/repos/${repository}`;

const localAssets = [];
for (const filename of assetPaths) {
  const details = await stat(filename);
  const name = path.basename(filename);
  if (!details.isFile() || details.size <= 0 || details.size > MAX_RELEASE_ASSET_BYTES) {
    throw new Error(`candidate release asset size is invalid: ${name}`);
  }
  if (!ASSET_NAME_RE.test(name)) throw new Error(`candidate release asset name is invalid: ${name}`);
  localAssets.push({ filename, name, size: details.size, digest: `sha256:${await sha256(filename)}` });
}
if (new Set(localAssets.map(({ name }) => name)).size !== localAssets.length) {
  throw new Error("candidate release asset names must be unique");
}

let release = await fetchJson(`${apiRoot}/releases/tags/${encodeURIComponent(version)}`, { allowNotFound: true });
if (release === null) {
  release = await fetchJson(`${apiRoot}/releases`, {
    method: "POST",
    body: {
      tag_name: version,
      target_commitish: sourceCommit,
      name: `${version} release candidate`,
      body: "Credential-free Web and/or unsigned macOS candidate data for the protected Geland Games publisher.",
      draft: true,
      prerelease: true,
      make_latest: "false"
    }
  });
}
validateReleaseIdentity(release);

for (const local of localAssets) {
  const existing = release.assets.find((asset) => asset.name === local.name);
  if (existing) {
    validateRemoteAsset(existing, local);
    continue;
  }
  if (!release.draft) throw new Error(`published candidate release is missing asset: ${local.name}`);
  await uploadAsset(release.id, local);
  release = await fetchJson(`${apiRoot}/releases/${release.id}`);
  validateReleaseIdentity(release);
  validateRemoteAsset(release.assets.find((asset) => asset.name === local.name), local);
}

if (release.assets.length !== localAssets.length) throw new Error("candidate release has an unexpected asset count");
for (const local of localAssets) validateRemoteAsset(release.assets.find((asset) => asset.name === local.name), local);

if (release.draft) {
  release = await fetchJson(`${apiRoot}/releases/${release.id}`, {
    method: "PATCH",
    body: { draft: false, prerelease: true, make_latest: "false" }
  });
}
validateReleaseIdentity(release, false);
process.stdout.write(`Published ${localAssets.length} constrained candidate release asset(s) for ${version}.\n`);

function validateReleaseIdentity(value, allowDraft = true) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("candidate release response is invalid");
  if (!Number.isSafeInteger(value.id) || value.id <= 0) throw new Error("candidate release ID is invalid");
  if (value.tag_name !== version || value.target_commitish !== sourceCommit) throw new Error("candidate release identity does not match");
  if (value.prerelease !== true) throw new Error("candidate release must be a prerelease");
  if (value.draft !== true && value.draft !== false) throw new Error("candidate release draft state is invalid");
  if (!allowDraft && value.draft) throw new Error("candidate release remained a draft");
  if (!Array.isArray(value.assets)) throw new Error("candidate release assets are invalid");
}

function validateRemoteAsset(asset, local) {
  if (!asset || typeof asset !== "object" || Array.isArray(asset)) throw new Error(`candidate release asset is missing: ${local.name}`);
  if (!Number.isSafeInteger(asset.id) || asset.id <= 0 || asset.name !== local.name || asset.state !== "uploaded") {
    throw new Error(`candidate release asset metadata is invalid: ${local.name}`);
  }
  if (asset.size !== local.size || asset.digest !== local.digest) throw new Error(`candidate release asset bytes do not match: ${local.name}`);
}

async function uploadAsset(releaseId, local) {
  const url = `https://uploads.github.com/repos/${repository}/releases/${releaseId}/assets?name=${encodeURIComponent(local.name)}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/octet-stream", "Content-Length": String(local.size) },
    body: createReadStream(local.filename),
    duplex: "half",
    redirect: "error"
  });
  if (!response.ok) throw new Error(`GitHub release asset upload failed with HTTP ${response.status}`);
  validateRemoteAsset(await response.json(), local);
}

async function fetchJson(url, { method = "GET", body, allowNotFound = false } = {}) {
  const response = await fetch(url, {
    method,
    headers: body === undefined ? headers : { ...headers, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "error"
  });
  if (allowNotFound && response.status === 404) return null;
  if (!response.ok) throw new Error(`GitHub release request failed with HTTP ${response.status}`);
  return response.json();
}

async function sha256(filename) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filename)) hash.update(chunk);
  return hash.digest("hex");
}

function optionalAsset(enabledName, pathName) {
  const enabled = required(enabledName);
  if (enabled !== "true" && enabled !== "false") throw new Error(`${enabledName} must be true or false`);
  if (enabled === "false") return null;
  const filename = required(pathName);
  if (!path.isAbsolute(filename)) throw new Error(`${pathName} must be an absolute path`);
  return filename;
}

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}
