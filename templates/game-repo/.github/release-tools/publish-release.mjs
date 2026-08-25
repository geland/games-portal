#!/usr/bin/env node
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import path from "node:path";
import process from "node:process";
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
  createScopedR2Credentials,
  describeFile,
  loadConfig,
  planImmutableUploads,
  SHA_RE,
  VERSION_RE
} from "./lib.mjs";

const config = await loadConfig();
const version = required("RELEASE_VERSION");
const sourceCommit = required("SOURCE_COMMIT").toLowerCase();
const accountId = required("CLOUDFLARE_ACCOUNT_ID");
const bucket = required("R2_BUCKET");
const publicBase = new URL(required("R2_PUBLIC_BASE"));
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
const manifestPrefix = `manifests/${config.slug}`;
const scopedCredentials = createScopedR2Credentials({
  accountId,
  accessKeyId: required("R2_ACCESS_KEY_ID"),
  secretAccessKey: required("R2_SECRET_ACCESS_KEY"),
  bucket,
  prefixes: [`${releasePrefix}/`, `${downloadPrefix}/`, `${manifestPrefix}/`]
});

const client = new S3Client({
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
let macKey;
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

const versionManifestKey = `${manifestPrefix}/versions/${version}.json`;
const existingFiles = new Set();
for (const file of files) {
  if (await objectExists(file.key)) existingFiles.add(file.key);
}
const existingVersionManifest = await getJson(versionManifestKey);
const existingImmutableKeys = [...existingFiles, ...(existingVersionManifest ? [versionManifestKey] : [])];
planImmutableUploads([...files.map((file) => file.key), versionManifestKey], new Set(existingImmutableKeys), allowResume);

const preflightIndex = await getJson(`${manifestPrefix}/index.json`);
if (preflightIndex && (preflightIndex.value?.slug !== config.slug || !Array.isArray(preflightIndex.value?.versions))) {
  throw new Error("existing version index is invalid");
}
const preflightIndexed = preflightIndex?.value.versions.find((item) => item?.version === version);
const preflightStable = await getJson(`${manifestPrefix}/stable.json`);
if ((preflightIndexed || preflightStable?.value?.version === version) && !existingVersionManifest) {
  throw new Error("a mutable manifest references this version but its immutable version manifest is missing");
}

if (existingVersionManifest && existingFiles.size !== files.length) {
  throw new Error("an immutable version manifest exists but one or more advertised artifacts are missing");
}
for (const file of files) {
  if (existingFiles.has(file.key)) await verifyRemoteFile(file);
}
for (const file of files) {
  if (!existingFiles.has(file.key)) await uploadImmutableFile(file);
}
await verifyPublicTargets();

const publishedAt = existingVersionManifest?.value?.publishedAt ?? new Date().toISOString();
const manifest = buildManifest({ slug: config.slug, version, sourceCommit, publishedAt, webEntry, macKey, files });
if (existingVersionManifest) {
  if (!isDeepStrictEqual(existingVersionManifest.value, manifest)) {
    throw new Error("existing immutable version manifest does not exactly describe the rebuilt artifacts");
  }
} else {
  await uploadImmutableJson(versionManifestKey, manifest);
}
await updateIndex(manifest);
await updateStable(manifest); // This is intentionally the final write.

console.log(JSON.stringify({
  message: "release published",
  slug: config.slug,
  version,
  sourceCommit,
  objects: files.length + 3,
  bytes: files.reduce((total, file) => total + file.size, 0)
}));

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
  if (head.ContentLength !== file.size || head.Metadata?.sha256 !== file.sha256) {
    throw new Error(`remote metadata verification failed: ${file.key}`);
  }
  const object = await client.send(new GetObjectCommand({ Bucket: bucket, Key: file.key }));
  const remote = await hashBody(object.Body);
  if (remote.size !== file.size || remote.sha256 !== file.sha256) {
    throw new Error(`remote byte verification failed: ${file.key}`);
  }
}

async function uploadImmutableJson(key, value) {
  const body = jsonBuffer(value);
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

async function updateIndex(manifest) {
  const key = `${manifestPrefix}/index.json`;
  const current = await getJson(key);
  const existing = current?.value;
  if (existing && (existing.slug !== config.slug || !Array.isArray(existing.versions))) {
    throw new Error(`invalid existing version index: ${key}`);
  }
  const expectedEntry = { version, sourceCommit, publishedAt: manifest.publishedAt, manifest: versionManifestKey };
  const indexed = existing?.versions.find((item) => item?.version === version);
  if (indexed) {
    if (!allowResume || !isDeepStrictEqual(indexed, expectedEntry)) throw new Error(`version index already contains conflicting ${version}`);
    return;
  }
  const next = {
    slug: config.slug,
    versions: [
      expectedEntry,
      ...(existing?.versions ?? [])
    ]
  };
  await putMutableJson(key, next, current?.etag);
}

async function updateStable(manifest) {
  const key = `${manifestPrefix}/stable.json`;
  const current = await getJson(key);
  if (current?.value?.slug && current.value.slug !== config.slug) throw new Error(`invalid existing stable manifest: ${key}`);
  if (allowResume && current?.value?.version === version) {
    if (!isDeepStrictEqual(current.value, manifest)) throw new Error("stable manifest already names this version with conflicting content");
    return;
  }
  await putMutableJson(key, manifest, current?.etag);
}

async function putMutableJson(key, value, previousEtag) {
  const body = jsonBuffer(value);
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
    const data = await readBody(result.Body, 1_048_576);
    if (!result.ETag) throw new Error(`R2 did not return an ETag for mutable manifest coordination: ${key}`);
    return { value: JSON.parse(data.toString("utf8")), etag: result.ETag };
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
}

async function verifyJson(key, expected) {
  const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const actual = await readBody(result.Body, 1_048_576);
  if (!actual.equals(expected)) throw new Error(`remote JSON verification failed: ${key}`);
}

async function verifyPublicTargets() {
  const checks = [];
  if (webEntry) checks.push({ key: `${releasePrefix}/web/${webEntry}`, type: "text/html" });
  if (macKey) checks.push({ key: macKey, type: "application/zip" });
  for (const check of checks) {
    let lastStatus = "network error";
    for (const delay of [0, 500, 1_000, 2_000, 4_000, 8_000]) {
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
      try {
        const response = await fetch(new URL(`/${check.key}`, publicBase), { method: "HEAD", redirect: "error" });
        lastStatus = String(response.status);
        if (response.ok && response.headers.get("content-type")?.toLowerCase().startsWith(check.type)) {
          lastStatus = "ok";
          break;
        }
      } catch (error) {
        lastStatus = error instanceof Error ? error.message : String(error);
      }
    }
    if (lastStatus !== "ok") {
      throw new Error(`public-origin smoke check failed after bounded retries: ${check.key} (${lastStatus})`);
    }
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

function jsonBuffer(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
}
