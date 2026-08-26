#!/usr/bin/env node
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client
} from "@aws-sdk/client-s3";
import {
  buildManifest,
  collectFiles,
  contentTypeFor,
  createScopedR2Credentials,
  describeFile,
  loadConfig,
  planImmutableUploads,
  SHA_RE,
  VERSION_RE
} from "./lib.mjs";

let client;
let bucket;
let sourceCommit;
let version;
let macKey;
let manifestPrefix;

export const STABLE_MANIFEST_MAX_BYTES = 32_768;
export const REMOTE_JSON_MAX_BYTES = 1_048_576;
export const PUBLIC_ORIGIN_USER_AGENT = "Gregeland-Games-Release-Publisher/1.0 (+https://games.gregeland.com)";

export async function main() {
  const config = await loadConfig();
  version = required("RELEASE_VERSION");
  sourceCommit = required("SOURCE_COMMIT").toLowerCase();
  const accountId = required("CLOUDFLARE_ACCOUNT_ID");
  bucket = required("R2_BUCKET");
  const publicBase = new URL(required("R2_PUBLIC_BASE"));
  const originProbe = createOriginProbeClient(
    required("RELEASE_ORIGIN_PROBE_URL"),
    required("RELEASE_ORIGIN_PROBE_TOKEN")
  );
  const allowResume = process.env.ALLOW_RESUME === "true";
  if (process.env.ALLOW_RESUME && !["true", "false"].includes(process.env.ALLOW_RESUME)) {
    throw new Error("ALLOW_RESUME must be true or false");
  }

  if (!VERSION_RE.test(version)) throw new Error("RELEASE_VERSION must exactly match vMAJOR.MINOR.PATCH");
  if (!SHA_RE.test(sourceCommit)) throw new Error("SOURCE_COMMIT must be a full lowercase Git commit SHA");
  if (required("GAME_SLUG") !== config.slug) throw new Error("GAME_SLUG does not match .gregeland-release.json");
  if (bucket !== "gregeland-games-releases") throw new Error("R2_BUCKET does not match the Gregeland release contract");
  if (!/^[0-9a-f]{32}$/.test(accountId)) throw new Error("CLOUDFLARE_ACCOUNT_ID is malformed");
  if (publicBase.protocol !== "https:") throw new Error("R2_PUBLIC_BASE must use HTTPS");
  if (publicBase.origin !== "https://play.games.gregeland.com") throw new Error("R2_PUBLIC_BASE does not match the Gregeland release origin");

  const releasePrefix = `releases/${config.slug}/${version}`;
  const downloadPrefix = `downloads/${config.slug}/${version}`;
  manifestPrefix = `manifests/${config.slug}`;
  const scopedCredentials = createScopedR2Credentials({
    accountId,
    accessKeyId: required("R2_ACCESS_KEY_ID"),
    secretAccessKey: required("R2_SECRET_ACCESS_KEY"),
    bucket,
    prefixes: [`${releasePrefix}/`, `${downloadPrefix}/`, `${manifestPrefix}/`]
  });

  client = new S3Client({
    region: "auto",
    endpoint: scopedCredentials.endpoint,
    forcePathStyle: true,
    maxAttempts: 4,
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
    credentials: {
      accessKeyId: scopedCredentials.accessKeyId,
      secretAccessKey: scopedCredentials.secretAccessKey,
      sessionToken: scopedCredentials.sessionToken
    }
  });

  const files = [];
  let webEntry;
  if (config.web.enabled) {
    const webDirectory = path.resolve(required("WEB_BUILD_DIR"));
    files.push(...await collectFiles(webDirectory, `${releasePrefix}/web`));
    webEntry = config.web.entry;
    if (!files.some((file) => file.key === `${releasePrefix}/web/${webEntry}`)) {
      throw new Error(`Web entry was not built: ${webEntry}`);
    }
  }
  if (config.mac.enabled) {
    const archive = path.resolve(required("MAC_ARCHIVE"));
    macKey = `${downloadPrefix}/${config.slug}-macos-universal.zip`;
    files.push(await describeFile(archive, macKey));
  }

  const localManifest = buildManifest({
    slug: config.slug,
    version,
    sourceCommit,
    publishedAt: new Date().toISOString(),
    webEntry,
    macKey,
    files
  });
  assertReleaseManifestSize(localManifest);

  const versionManifestKey = `${manifestPrefix}/versions/${version}.json`;
  const [versionManifestResult, indexResult, stableResult] = await Promise.all([
    getJson(versionManifestKey),
    getJson(`${manifestPrefix}/index.json`),
    getJson(`${manifestPrefix}/stable.json`)
  ]);
  const index = indexResult ? validateVersionIndex(indexResult.value, config.slug) : null;
  const stable = stableResult ? validateImmutableManifest(stableResult.value, { slug: config.slug }) : null;
  const authoritativeManifest = versionManifestResult
    ? validateImmutableManifest(versionManifestResult.value, {
        slug: config.slug,
        version,
        sourceCommit,
        webEntry: config.web.enabled ? webEntry : null,
        macKey: config.mac.enabled ? macKey : null
      })
    : null;
  if (versionManifestResult) verifyImmutableManifestEnvelope(versionManifestResult, versionManifestKey);
  if (authoritativeManifest) assertReleaseManifestSize(authoritativeManifest);

  const artifactDescriptors = authoritativeManifest?.files ?? files;
  await verifyPublicOriginIsUncached(originProbe, artifactDescriptors);
  const existingArtifactKeys = new Set();
  for (const file of artifactDescriptors) {
    if (await objectExists(file.key)) existingArtifactKeys.add(file.key);
  }

  const preflight = decideReleasePreflight({
    allowResume,
    slug: config.slug,
    version,
    sourceCommit,
    expectedArtifactKeys: files.map((file) => file.key),
    existingArtifactKeys,
    macKey,
    immutableManifest: authoritativeManifest,
    index,
    stable
  });
  const selectedManifest = authoritativeManifest ?? localManifest;
  const nextIndex = preflight.updateIndex ? buildNextVersionIndex(selectedManifest, indexResult?.value) : null;
  if (nextIndex) assertVersionIndexSize(nextIndex);
  if (preflight.updateStable) assertReleaseManifestSize(selectedManifest);

  let manifest;
  if (authoritativeManifest) {
    for (const file of authoritativeManifest.files) {
      if (!existingArtifactKeys.has(file.key)) {
        throw new Error(`immutable version manifest advertises a missing artifact: ${file.key}`);
      }
      await verifyRemoteFile(file);
    }
    manifest = authoritativeManifest;
    await verifyPublicFiles(originProbe, manifest.files);
  } else {
    const existingImmutableKeys = [...existingArtifactKeys];
    planImmutableUploads([...files.map((file) => file.key), versionManifestKey], new Set(existingImmutableKeys), allowResume);
    for (const file of files) {
      if (existingArtifactKeys.has(file.key)) await verifyRemoteFile(file);
    }
    for (const file of files) {
      if (!existingArtifactKeys.has(file.key)) await uploadImmutableFile(file);
    }
    manifest = localManifest;
    await uploadImmutableJson(versionManifestKey, manifest);
    await verifyPublicFiles(originProbe, files);
  }

  await updateIndex(nextIndex, indexResult);
  await updateStable(manifest, stableResult, preflight.updateStable); // This is intentionally the final write.

  console.log(JSON.stringify({
    message: "release published",
    slug: config.slug,
    version,
    sourceCommit,
    artifacts: manifest.files.length,
    bytes: manifest.files.reduce((total, file) => total + file.size, 0),
    resumed: allowResume
  }));
}

export function compareReleaseVersions(left, right) {
  const leftParts = parseReleaseVersion(left);
  const rightParts = parseReleaseVersion(right);
  for (let index = 0; index < leftParts.length; index += 1) {
    if (leftParts[index] < rightParts[index]) return -1;
    if (leftParts[index] > rightParts[index]) return 1;
  }
  return 0;
}

export function validateImmutableManifest(raw, expected = {}) {
  assertExactKeys(raw, ["slug", "version", "sourceCommit", "publishedAt", "files"], ["web", "mac"], "release manifest");
  if (typeof raw.slug !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(raw.slug)) {
    throw new Error("release manifest slug is invalid");
  }
  if (Object.hasOwn(expected, "slug") && raw.slug !== expected.slug) {
    throw new Error(`release manifest slug does not match ${expected.slug}`);
  }
  if (!VERSION_RE.test(raw.version)) throw new Error("release manifest version is invalid");
  if (Object.hasOwn(expected, "version") && raw.version !== expected.version) {
    throw new Error(`release manifest version does not match ${expected.version}`);
  }
  if (!SHA_RE.test(raw.sourceCommit)) throw new Error("release manifest sourceCommit is invalid");
  if (Object.hasOwn(expected, "sourceCommit") && raw.sourceCommit !== expected.sourceCommit) {
    throw new Error("release manifest sourceCommit does not match the requested source commit");
  }
  assertPublishedAt(raw.publishedAt, "release manifest publishedAt");

  const expectsWeb = Object.hasOwn(expected, "webEntry");
  const expectsMac = Object.hasOwn(expected, "macKey");
  if (raw.web !== undefined) {
    assertExactKeys(raw.web, ["entry"], [], "release manifest web target");
    if (!isSafeRelativePath(raw.web.entry) || !raw.web.entry.endsWith(".html")) {
      throw new Error("release manifest web entry is invalid");
    }
  }
  if (expectsWeb) {
    if (expected.webEntry === null && raw.web !== undefined) throw new Error("release manifest advertises an unexpected Web target");
    if (expected.webEntry !== null && raw.web?.entry !== expected.webEntry) {
      throw new Error("release manifest Web target does not match the requested target");
    }
  }

  const contractMacKey = `downloads/${raw.slug}/${raw.version}/${raw.slug}-macos-universal.zip`;
  if (raw.mac !== undefined) {
    assertExactKeys(raw.mac, ["key", "filename"], [], "release manifest Mac target");
    if (raw.mac.key !== contractMacKey || raw.mac.filename !== path.posix.basename(contractMacKey)) {
      throw new Error("release manifest Mac target does not match the release contract");
    }
  }
  if (expectsMac) {
    if (expected.macKey === null && raw.mac !== undefined) throw new Error("release manifest advertises an unexpected Mac target");
    if (expected.macKey !== null && raw.mac?.key !== expected.macKey) {
      throw new Error("release manifest Mac target does not match the requested target");
    }
  }
  if (raw.web === undefined && raw.mac === undefined) throw new Error("release manifest must advertise at least one target");

  if (!Array.isArray(raw.files) || raw.files.length === 0) throw new Error("release manifest files must be a non-empty array");
  const keys = new Set();
  const webPrefix = `releases/${raw.slug}/${raw.version}/web/`;
  for (const file of raw.files) {
    assertExactKeys(file, ["key", "size", "sha256", "contentType"], [], "release manifest file");
    if (!isSafeObjectKey(file.key)) throw new Error("release manifest file key is unsafe");
    if (keys.has(file.key)) throw new Error(`release manifest contains a duplicate file key: ${file.key}`);
    keys.add(file.key);
    if (!Number.isSafeInteger(file.size) || file.size <= 0) throw new Error(`release manifest file size is invalid: ${file.key}`);
    if (typeof file.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(file.sha256)) {
      throw new Error(`release manifest file SHA-256 is invalid: ${file.key}`);
    }
    if (file.contentType !== contentTypeFor(file.key)) {
      throw new Error(`release manifest file content type is invalid: ${file.key}`);
    }
    const isWebFile = raw.web !== undefined && file.key.startsWith(webPrefix);
    const isMacFile = raw.mac !== undefined && file.key === raw.mac.key;
    if (!isWebFile && !isMacFile) throw new Error(`release manifest file is outside its advertised targets: ${file.key}`);
  }
  if (raw.web && !keys.has(`${webPrefix}${raw.web.entry}`)) {
    throw new Error("release manifest does not include its advertised Web entry");
  }
  if (raw.mac && !keys.has(raw.mac.key)) throw new Error("release manifest does not include its advertised Mac archive");
  return raw;
}

export function validateVersionIndex(raw, slug) {
  assertExactKeys(raw, ["slug", "versions"], [], "version index");
  if (raw.slug !== slug) throw new Error(`version index slug does not match ${slug}`);
  if (!Array.isArray(raw.versions)) throw new Error("version index versions must be an array");
  const versions = new Set();
  for (const entry of raw.versions) {
    assertExactKeys(entry, ["version", "sourceCommit", "publishedAt", "manifest"], [], "version index entry");
    if (!VERSION_RE.test(entry.version)) throw new Error("version index entry version is invalid");
    if (versions.has(entry.version)) throw new Error(`version index contains duplicate ${entry.version}`);
    versions.add(entry.version);
    if (!SHA_RE.test(entry.sourceCommit)) throw new Error(`version index sourceCommit is invalid for ${entry.version}`);
    assertPublishedAt(entry.publishedAt, `version index publishedAt for ${entry.version}`);
    if (entry.manifest !== `manifests/${slug}/versions/${entry.version}.json`) {
      throw new Error(`version index manifest key is invalid for ${entry.version}`);
    }
  }
  return raw;
}

export function assertReleaseManifestSize(manifest) {
  return jsonBufferWithinLimit(manifest, STABLE_MANIFEST_MAX_BYTES, "release manifest");
}

export function assertVersionIndexSize(index) {
  return jsonBufferWithinLimit(index, REMOTE_JSON_MAX_BYTES, "version index");
}

export function assertUncachedOriginResponse({ key, status, cacheStatus, age, diagnostics = "" }) {
  const normalized = typeof cacheStatus === "string" ? cacheStatus.toUpperCase() : "";
  const detail = diagnostics ? `; ${diagnostics}` : "";
  if (status !== 404) throw new Error(`public-origin cache probe was expected to be missing: ${key} (${status}${detail})`);
  if (!["DYNAMIC", "BYPASS"].includes(normalized) || age !== null) {
    throw new Error(
      `public-origin caching is enabled or ambiguous for ${key}${detail}; keep the R2 origin uncached until a managed 404/410 zero-TTL rule and recovery policy are installed`
    );
  }
}

export function publicOriginResponseDiagnostics(headers) {
  return ["cf-ray", "cf-mitigated", "server", "cf-cache-status"]
    .map((name) => [name, headers.get(name)])
    .filter(([, value]) => value)
    .map(([name, value]) => `${name}=${value}`)
    .join(", ");
}

export function parseOriginProbeResponse(response, key) {
  if (response.status !== 204) {
    throw new Error(`release origin probe request failed: ${key} (${response.status})`);
  }
  const statusText = response.headers.get("x-gregeland-origin-status") ?? "";
  if (!/^[1-5][0-9]{2}$/.test(statusText)) {
    throw new Error(`release origin probe returned an invalid status: ${key}`);
  }
  const headers = new Headers();
  for (const name of ["content-type", "content-length", "cf-cache-status", "age", "cf-ray", "cf-mitigated", "server"]) {
    const value = response.headers.get(`x-gregeland-origin-${name}`);
    if (value) headers.set(name, value);
  }
  const status = Number(statusText);
  return { status, ok: status >= 200 && status < 300, headers };
}

export function createOriginProbeClient(rawUrl, token) {
  const url = new URL(rawUrl);
  if (url.origin !== "https://games-release-probe.geland.workers.dev"
    || url.pathname !== "/v1/probe"
    || url.search
    || url.hash
    || url.username
    || url.password) {
    throw new Error("RELEASE_ORIGIN_PROBE_URL does not match the trusted probe service");
  }
  if (token.length < 32 || token.length > 512) {
    throw new Error("RELEASE_ORIGIN_PROBE_TOKEN is malformed");
  }
  return async (key) => {
    const requestUrl = new URL(url);
    requestUrl.searchParams.set("key", key);
    const response = await fetch(requestUrl, {
      method: "HEAD",
      redirect: "error",
      headers: {
        authorization: `Bearer ${token}`,
        "user-agent": PUBLIC_ORIGIN_USER_AGENT
      }
    });
    return parseOriginProbeResponse(response, key);
  };
}

export function buildCacheProbeKeys(files, requestedVersion, requestedSourceCommit) {
  if (!VERSION_RE.test(requestedVersion) || !SHA_RE.test(requestedSourceCommit)) {
    throw new Error("cache probe identity is invalid");
  }
  const keys = new Set();
  for (const file of files) {
    if (!isSafeObjectKey(file.key)) throw new Error(`cache probe file key is unsafe: ${file.key}`);
    if (file.key.split("/").some((part) => part.startsWith(".gregeland-cache-probe-"))) {
      throw new Error(`artifact uses the reserved cache-probe namespace: ${file.key}`);
    }
    const directory = path.posix.dirname(file.key);
    const extension = path.posix.extname(file.key).toLowerCase();
    keys.add(`${directory}/.gregeland-cache-probe-${requestedVersion}-${requestedSourceCommit}${extension}`);
  }
  return [...keys].sort();
}

export function decideReleasePreflight({
  allowResume,
  slug,
  version,
  sourceCommit,
  expectedArtifactKeys,
  existingArtifactKeys,
  macKey,
  immutableManifest,
  index,
  stable
}) {
  const indexed = index?.versions.find((entry) => entry.version === version);
  if (!immutableManifest && (indexed || stable?.version === version)) {
    throw new Error("a mutable manifest references this version but its immutable version manifest is missing");
  }

  if (!allowResume) {
    if (immutableManifest) throw new Error(`immutable release key already exists: manifests/${slug}/versions/${version}.json`);
    const existingKey = expectedArtifactKeys.find((key) => existingArtifactKeys.has(key));
    if (existingKey) throw new Error(`immutable release key already exists: ${existingKey}`);
    const highest = highestReleaseVersion([
      ...(index?.versions.map((entry) => entry.version) ?? []),
      ...(stable ? [stable.version] : [])
    ]);
    if (highest && compareReleaseVersions(version, highest) <= 0) {
      throw new Error(`ordinary release ${version} must be newer than published version ${highest}`);
    }
    return { artifactSource: "local", updateIndex: true, updateStable: true };
  }

  if (stable && stable.version !== version && compareReleaseVersions(version, stable.version) <= 0) {
    throw new Error(`resume cannot move stable backward from ${stable.version} to ${version}; use the separate rollback operation`);
  }

  if (immutableManifest) {
    const expectedEntry = indexEntryFor(immutableManifest);
    if (indexed && !isDeepStrictEqual(indexed, expectedEntry)) {
      throw new Error(`version index already contains conflicting ${version}`);
    }
    if (stable?.version === version && !isDeepStrictEqual(stable, immutableManifest)) {
      throw new Error("stable manifest already names this version with conflicting content");
    }
    const updateStable = stable?.version !== version;
    if (updateStable) assertNoNewerIndexedVersion(index, version);
    return { artifactSource: "manifest", updateIndex: !indexed, updateStable };
  }

  if (macKey && existingArtifactKeys.has(macKey)) {
    throw new Error(
      "automatic resume cannot recover an existing signed Mac archive without its immutable version manifest; preserve the original notarized artifact and use approved manual recovery"
    );
  }
  assertNoNewerIndexedVersion(index, version);
  return { artifactSource: "local", updateIndex: true, updateStable: true };
}

function parseReleaseVersion(value) {
  if (!VERSION_RE.test(value)) throw new Error(`invalid release version: ${value}`);
  return value.slice(1).split(".").map((part) => BigInt(part));
}

function highestReleaseVersion(versions) {
  return versions.reduce((highest, candidate) => (
    highest === null || compareReleaseVersions(candidate, highest) > 0 ? candidate : highest
  ), null);
}

function assertNoNewerIndexedVersion(index, requestedVersion) {
  const highest = highestReleaseVersion(index?.versions.map((entry) => entry.version) ?? []);
  if (highest && compareReleaseVersions(highest, requestedVersion) > 0) {
    throw new Error(`resume cannot promote ${requestedVersion} while newer indexed version ${highest} exists`);
  }
}

function indexEntryFor(manifest) {
  return {
    version: manifest.version,
    sourceCommit: manifest.sourceCommit,
    publishedAt: manifest.publishedAt,
    manifest: `manifests/${manifest.slug}/versions/${manifest.version}.json`
  };
}

function assertExactKeys(value, requiredKeys, optionalKeys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  const allowed = new Set([...requiredKeys, ...optionalKeys]);
  for (const key of requiredKeys) if (!Object.hasOwn(value, key)) throw new Error(`${label} is missing ${key}`);
  for (const key of Object.keys(value)) if (!allowed.has(key)) throw new Error(`${label} contains unknown key ${key}`);
}

function assertPublishedAt(value, label) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) {
    throw new Error(`${label} must be an exact ISO-8601 UTC timestamp`);
  }
}

function isSafeRelativePath(value) {
  return typeof value === "string"
    && value.length > 0
    && !value.startsWith("/")
    && !value.includes("\\")
    && !/[\x00-\x1f\x7f]/.test(value)
    && value.split("/").every((part) => part && part !== "." && part !== "..");
}

function isSafeObjectKey(value) {
  return isSafeRelativePath(value);
}

function verifyImmutableManifestEnvelope(result, key) {
  const digest = createHash("sha256").update(result.body).digest("hex");
  if (result.contentLength !== result.body.length || result.metadata?.sha256 !== digest) {
    throw new Error(`immutable version manifest metadata verification failed: ${key}`);
  }
  if (result.contentType !== "application/json; charset=utf-8") {
    throw new Error(`immutable version manifest content type is invalid: ${key}`);
  }
}

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function isMissing(error) {
  return error?.$metadata?.httpStatusCode === 404 || error?.name === "NotFound" || error?.name === "NoSuchKey";
}

function isPreconditionFailed(error) {
  return error?.$metadata?.httpStatusCode === 412 || error?.name === "PreconditionFailed";
}

async function objectExists(key) {
  try {
    await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return true;
  } catch (error) {
    if (isMissing(error)) return false;
    throw error;
  }
}

async function uploadImmutableFile(file) {
  try {
    await client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: file.key,
      Body: createReadStream(file.filename),
      ContentLength: file.size,
      ContentMD5: file.md5,
      ContentType: file.contentType,
      CacheControl: "public,max-age=31536000,immutable",
      ContentDisposition: file.key === macKey ? `attachment; filename="${path.posix.basename(file.key)}"` : undefined,
      Metadata: { sha256: file.sha256, sourcecommit: sourceCommit, version },
      IfNoneMatch: "*"
    }));
  } catch (error) {
    if (isPreconditionFailed(error)) throw new Error(`immutable release key appeared during upload: ${file.key}`);
    throw error;
  }
  await verifyRemoteFile(file);
}

async function verifyRemoteFile(file) {
  const head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: file.key }));
  if (
    head.ContentLength !== file.size
    || head.ContentType !== file.contentType
    || head.Metadata?.sha256 !== file.sha256
    || head.Metadata?.sourcecommit !== sourceCommit
    || head.Metadata?.version !== version
  ) {
    throw new Error(`remote metadata verification failed: ${file.key}`);
  }
  const object = await client.send(new GetObjectCommand({ Bucket: bucket, Key: file.key }));
  const remote = await hashBody(object.Body);
  if (remote.size !== file.size || remote.sha256 !== file.sha256) {
    throw new Error(`remote byte verification failed: ${file.key}`);
  }
}

async function uploadImmutableJson(key, value) {
  const body = assertReleaseManifestSize(value);
  try {
    await client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentLength: body.length,
      ContentMD5: createHash("md5").update(body).digest("base64"),
      ContentType: "application/json; charset=utf-8",
      CacheControl: "public,max-age=31536000,immutable",
      Metadata: { sha256: createHash("sha256").update(body).digest("hex"), sourcecommit: sourceCommit, version },
      IfNoneMatch: "*"
    }));
  } catch (error) {
    if (isPreconditionFailed(error)) throw new Error(`immutable release key appeared during upload: ${key}`);
    throw error;
  }
  await verifyJson(key, body);
}

function buildNextVersionIndex(manifest, existing) {
  return {
    slug: manifest.slug,
    versions: [
      indexEntryFor(manifest),
      ...(existing?.versions ?? [])
    ]
  };
}

async function updateIndex(next, current) {
  if (!next) return;
  const key = `${manifestPrefix}/index.json`;
  await putMutableJson(key, next, current?.etag, REMOTE_JSON_MAX_BYTES, "version index");
}

async function updateStable(manifest, current, shouldWrite) {
  if (!shouldWrite) return;
  const key = `${manifestPrefix}/stable.json`;
  await putMutableJson(key, manifest, current?.etag, STABLE_MANIFEST_MAX_BYTES, "stable manifest");
}

async function putMutableJson(key, value, previousEtag, maxBytes, label) {
  const body = jsonBufferWithinLimit(value, maxBytes, label);
  try {
    await client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentLength: body.length,
      ContentMD5: createHash("md5").update(body).digest("base64"),
      ContentType: "application/json; charset=utf-8",
      CacheControl: "no-store",
      Metadata: { sha256: createHash("sha256").update(body).digest("hex"), sourcecommit: sourceCommit, version },
      ...(previousEtag ? { IfMatch: previousEtag } : { IfNoneMatch: "*" })
    }));
  } catch (error) {
    if (isPreconditionFailed(error)) throw new Error(`concurrent manifest update detected: ${key}`);
    throw error;
  }
  await verifyJson(key, body);
}

async function getJson(key) {
  try {
    const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const data = await readBody(result.Body, REMOTE_JSON_MAX_BYTES);
    if (!result.ETag) throw new Error(`R2 did not return an ETag for mutable manifest coordination: ${key}`);
    return {
      value: JSON.parse(data.toString("utf8")),
      etag: result.ETag,
      body: data,
      contentLength: result.ContentLength,
      contentType: result.ContentType,
      metadata: result.Metadata
    };
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
}

async function verifyJson(key, expected) {
  const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const actual = await readBody(result.Body, REMOTE_JSON_MAX_BYTES);
  if (!actual.equals(expected)) throw new Error(`remote JSON verification failed: ${key}`);
}

async function verifyPublicFiles(originProbe, files) {
  for (const file of files) {
    const expectedType = file.contentType.split(";", 1)[0].toLowerCase();
    let lastStatus = "network error";
    for (const delay of [0, 500, 1_000, 2_000, 4_000, 8_000]) {
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
      try {
        const response = await originProbe(file.key);
        lastStatus = String(response.status);
        if (response.ok && response.headers.get("content-type")?.toLowerCase().startsWith(expectedType)) {
          lastStatus = "ok";
          break;
        }
      } catch (error) {
        lastStatus = error instanceof Error ? error.message : String(error);
      }
    }
    if (lastStatus !== "ok") {
      throw new Error(`public-origin smoke check failed after bounded retries: ${file.key} (${lastStatus})`);
    }
  }
}

async function verifyPublicOriginIsUncached(originProbe, files) {
  for (const key of buildCacheProbeKeys(files, version, sourceCommit)) {
    const response = await originProbe(key);
    assertUncachedOriginResponse({
      key,
      status: response.status,
      cacheStatus: response.headers.get("cf-cache-status"),
      age: response.headers.get("age"),
      diagnostics: publicOriginResponseDiagnostics(response.headers)
    });
  }
}

async function hashBody(body) {
  if (!body) throw new Error("R2 returned an empty response body");
  const hash = createHash("sha256");
  let size = 0;
  for await (const chunk of body) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    hash.update(buffer);
  }
  return { size, sha256: hash.digest("hex") };
}

async function readBody(body, limit) {
  if (!body) throw new Error("R2 returned an empty response body");
  const chunks = [];
  let size = 0;
  for await (const chunk of body) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > limit) throw new Error("remote manifest exceeded the size limit");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

function jsonBufferWithinLimit(value, maxBytes, label) {
  const body = Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
  if (body.length > maxBytes) throw new Error(`${label} exceeds the ${maxBytes}-byte publication limit`);
  return body;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
