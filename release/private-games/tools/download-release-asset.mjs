#!/usr/bin/env node
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import path from "node:path";
import process from "node:process";

const REPOSITORY_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const DIGEST_RE = /^sha256:[0-9a-f]{64}$/;
const MAX_RELEASE_ASSET_BYTES = 2 * 1024 * 1024 * 1024 - 1;

const repository = required("SOURCE_REPOSITORY");
const assetId = required("RELEASE_ASSET_ID");
const expectedDigest = required("RELEASE_ASSET_DIGEST");
const output = required("RELEASE_ASSET_OUTPUT");
const token = required("PRIVATE_ACTIONS_READ_TOKEN");

if (!REPOSITORY_RE.test(repository)) throw new Error("SOURCE_REPOSITORY is invalid");
if (!/^[1-9][0-9]{0,18}$/.test(assetId) || !Number.isSafeInteger(Number(assetId))) throw new Error("RELEASE_ASSET_ID is invalid");
if (!DIGEST_RE.test(expectedDigest)) throw new Error("RELEASE_ASSET_DIGEST is invalid");
if (!path.isAbsolute(output)) throw new Error("RELEASE_ASSET_OUTPUT must be absolute");

const response = await fetch(`https://api.github.com/repos/${repository}/releases/assets/${assetId}`, {
  headers: {
    Accept: "application/octet-stream",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2026-03-10",
    "User-Agent": "gregeland-games-release-asset-downloader"
  },
  redirect: "follow"
});
if (!response.ok || !response.body) throw new Error(`GitHub release asset download failed with HTTP ${response.status}`);
const advertisedLength = Number(response.headers.get("content-length") ?? "0");
if (Number.isFinite(advertisedLength) && advertisedLength > MAX_RELEASE_ASSET_BYTES) throw new Error("release asset is too large");

await mkdir(path.dirname(output), { recursive: true, mode: 0o700 });
const hash = createHash("sha256");
let size = 0;
const meter = new Transform({
  transform(chunk, _encoding, callback) {
    size += chunk.length;
    if (size > MAX_RELEASE_ASSET_BYTES) return callback(new Error("release asset exceeded the size limit"));
    hash.update(chunk);
    callback(null, chunk);
  }
});

try {
  await pipeline(Readable.fromWeb(response.body), meter, createWriteStream(output, { flags: "wx", mode: 0o600 }));
  if (size <= 0) throw new Error("release asset is empty");
  const actualDigest = `sha256:${hash.digest("hex")}`;
  if (actualDigest !== expectedDigest) throw new Error("release asset digest does not match verified metadata");
} catch (error) {
  await rm(output, { force: true });
  throw error;
}

process.stdout.write(`Downloaded and verified ${size} bytes.\n`);

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}
