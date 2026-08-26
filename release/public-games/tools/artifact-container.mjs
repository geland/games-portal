import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { chmod, lstat, mkdir, open, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { isSafeRelativePath, SHA_RE, SLUG_RE, VERSION_RE } from "../../../templates/game-repo/.github/release-tools/lib.mjs";

const MAGIC = Buffer.from("GREGELAND-PKG-1\n", "ascii");
const MAX_MANIFEST_BYTES = 16 * 1024 * 1024;
const MAX_FILE_COUNT = 50_000;
const MAX_FILE_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_TOTAL_BYTES = 4 * 1024 * 1024 * 1024;

function exactObject(value, label, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  for (const key of Object.keys(value)) if (!keys.includes(key)) throw new Error(`unknown ${label} key: ${key}`);
  return value;
}

export function validateArtifactMetadata(value) {
  exactObject(value, "artifact metadata", ["formatVersion", "kind", "slug", "version", "sourceCommit", "bundleName", "entry", "files"]);
  if (value.formatVersion !== 1) throw new Error("artifact formatVersion must be 1");
  if (!['web', 'mac'].includes(value.kind)) throw new Error("artifact kind must be web or mac");
  if (!SLUG_RE.test(value.slug ?? "")) throw new Error("artifact slug is invalid");
  if (!VERSION_RE.test(value.version ?? "")) throw new Error("artifact version is invalid");
  if (!SHA_RE.test(value.sourceCommit ?? "")) throw new Error("artifact source commit is invalid");
  if (value.kind === "web") {
    if (value.bundleName !== null) throw new Error("Web artifact bundleName must be null");
    if (!isSafeRelativePath(value.entry ?? "") || !value.entry.endsWith(".html")) throw new Error("Web artifact entry is invalid");
  } else {
    if (typeof value.bundleName !== "string" || !/^[A-Za-z0-9][A-Za-z0-9 ._-]{0,99}$/.test(value.bundleName)) {
      throw new Error("Mac artifact bundleName is invalid");
    }
    if (value.entry !== null) throw new Error("Mac artifact entry must be null");
  }
  if (!Array.isArray(value.files) || value.files.length === 0 || value.files.length > MAX_FILE_COUNT) {
    throw new Error("artifact file count is invalid");
  }
  const seen = new Set();
  let total = 0;
  for (const [index, file] of value.files.entries()) {
    exactObject(file, `artifact file ${index}`, ["path", "size", "sha256", "mode"]);
    if (!isSafeRelativePath(file.path)) throw new Error(`unsafe artifact path: ${file.path}`);
    if (seen.has(file.path)) throw new Error(`duplicate artifact path: ${file.path}`);
    seen.add(file.path);
    if (!Number.isSafeInteger(file.size) || file.size <= 0 || file.size > MAX_FILE_BYTES) throw new Error(`invalid artifact size: ${file.path}`);
    if (!/^[0-9a-f]{64}$/.test(file.sha256 ?? "")) throw new Error(`invalid artifact digest: ${file.path}`);
    if (![0o644, 0o755].includes(file.mode)) throw new Error(`invalid artifact mode: ${file.path}`);
    total += file.size;
    if (!Number.isSafeInteger(total) || total > MAX_TOTAL_BYTES) throw new Error("artifact exceeds the total size limit");
  }
  const paths = [...seen];
  for (const filename of paths) {
    const parts = filename.split("/");
    for (let index = 1; index < parts.length; index += 1) {
      if (seen.has(parts.slice(0, index).join("/"))) throw new Error(`artifact path conflicts with a file: ${filename}`);
    }
  }
  if (value.kind === "web") {
    if (!seen.has(value.entry)) throw new Error("Web artifact does not contain its entry point");
  } else {
    const root = `${value.bundleName}.app/`;
    if (paths.some((filename) => !filename.startsWith(root))) throw new Error("Mac artifact contains a renamed or additional app root");
    if (!seen.has(`${root}Contents/Info.plist`)) throw new Error("Mac artifact is missing Contents/Info.plist");
    if (!paths.some((filename) => filename.startsWith(`${root}Contents/MacOS/`))) throw new Error("Mac artifact is missing its executable directory");
  }
  const validated = { ...value, files: value.files.map((file) => ({ ...file })) };
  Object.defineProperty(validated, "totalBytes", { value: total, enumerable: false });
  return validated;
}

export async function packArtifact({ kind, input, output, slug, version, sourceCommit, bundleName = null, entry = null }) {
  const root = path.resolve(input);
  const rootInfo = await lstat(root);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) throw new Error("artifact input must be a real directory");
  if (kind === "mac" && path.basename(root) !== `${bundleName}.app`) throw new Error("Mac input is not the expected app root");
  const sourceFiles = [];
  await walk(root, "", sourceFiles, kind === "mac" ? `${bundleName}.app` : "");
  const files = sourceFiles.map(({ sourcePath: _sourcePath, ...file }) => file);
  const metadata = validateArtifactMetadata({ formatVersion: 1, kind, slug, version, sourceCommit, bundleName, entry, files });
  const manifest = Buffer.from(`${JSON.stringify(metadata, null, 2)}\n`, "utf8");
  if (manifest.length > MAX_MANIFEST_BYTES) throw new Error("artifact manifest exceeds the size limit");
  const target = path.resolve(output);
  await mkdir(path.dirname(target), { recursive: true });
  let handle;
  try {
    handle = await open(target, "wx", 0o600);
    await writeAll(handle, MAGIC);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(manifest.length);
    await writeAll(handle, length);
    await writeAll(handle, manifest);
    for (const [index, file] of metadata.files.entries()) {
      const hash = createHash("sha256");
      let size = 0;
      for await (const chunk of createReadStream(sourceFiles[index].sourcePath)) {
        const buffer = Buffer.from(chunk);
        hash.update(buffer);
        size += buffer.length;
        await writeAll(handle, buffer);
      }
      if (size !== file.size || hash.digest("hex") !== file.sha256) throw new Error(`artifact input changed while packaging: ${file.path}`);
    }
    await handle.sync();
  } catch (error) {
    await handle?.close().catch(() => {});
    await rm(target, { force: true });
    throw error;
  }
  await handle.close();
  return { ...metadata, files: metadata.files.map(({ sourcePath: _sourcePath, ...file }) => file), totalBytes: metadata.totalBytes };
}

async function walk(root, relative, files, prefix) {
  const directory = relative ? path.join(root, relative) : root;
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const rel = relative ? `${relative}/${entry.name}` : entry.name;
    if (!isSafeRelativePath(rel)) throw new Error(`unsafe artifact input path: ${rel}`);
    const filename = path.join(root, rel);
    const info = await lstat(filename);
    if (info.isSymbolicLink()) throw new Error(`artifact symlinks are not allowed: ${rel}`);
    if (info.isDirectory()) await walk(root, rel, files, prefix);
    else if (info.isFile()) {
      if (info.nlink !== 1) throw new Error(`artifact hardlinks are not allowed: ${rel}`);
      if (info.size <= 0 || info.size > MAX_FILE_BYTES) throw new Error(`artifact file size is invalid: ${rel}`);
      const artifactPath = prefix ? `${prefix}/${rel}` : rel;
      files.push({
        path: artifactPath,
        size: info.size,
        sha256: await hashFile(filename),
        mode: info.mode & 0o111 ? 0o755 : 0o644,
        sourcePath: filename
      });
      if (files.length > MAX_FILE_COUNT) throw new Error("artifact contains too many files");
    } else throw new Error(`unsupported artifact input type: ${rel}`);
  }
}

export async function unpackArtifact({ packageFile, output, expected }) {
  const packagePath = path.resolve(packageFile);
  await assertSingleDownloadedFile(packagePath);
  const packageInfo = await lstat(packagePath);
  if (!packageInfo.isFile() || packageInfo.isSymbolicLink() || packageInfo.nlink !== 1) throw new Error("downloaded artifact package must be one regular file");
  const handle = await open(packagePath, "r");
  let metadata;
  let dataOffset;
  try {
    const prefix = await readExactly(handle, MAGIC.length + 4, 0);
    if (!prefix.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error("artifact package magic is invalid");
    const manifestLength = prefix.readUInt32BE(MAGIC.length);
    if (manifestLength <= 0 || manifestLength > MAX_MANIFEST_BYTES) throw new Error("artifact package manifest length is invalid");
    const manifest = await readExactly(handle, manifestLength, MAGIC.length + 4);
    metadata = validateArtifactMetadata(JSON.parse(manifest.toString("utf8")));
    dataOffset = MAGIC.length + 4 + manifestLength;
    if (packageInfo.size !== dataOffset + metadata.totalBytes) throw new Error("artifact package size does not match its manifest");
    validateExpected(metadata, expected);
  } finally {
    await handle.close();
  }

  const destination = path.resolve(output);
  await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
  try {
    await mkdir(destination, { recursive: false, mode: 0o700 });
  } catch (error) {
    if (error?.code === "EEXIST") throw new Error("artifact extraction directory must not already exist");
    throw error;
  }
  let offset = dataOffset;
  try {
    for (const file of metadata.files) {
      const filename = path.resolve(destination, file.path);
      if (!filename.startsWith(`${destination}${path.sep}`)) throw new Error(`artifact path escaped extraction root: ${file.path}`);
      await mkdir(path.dirname(filename), { recursive: true, mode: 0o755 });
      const outputHandle = await open(filename, "wx", file.mode);
      const hash = createHash("sha256");
      let written = 0;
      try {
        for await (const chunk of createReadStream(packagePath, { start: offset, end: offset + file.size - 1 })) {
          const buffer = Buffer.from(chunk);
          hash.update(buffer);
          written += buffer.length;
          await writeAll(outputHandle, buffer);
        }
      } finally {
        await outputHandle.close();
      }
      if (written !== file.size || hash.digest("hex") !== file.sha256) throw new Error(`artifact content verification failed: ${file.path}`);
      await chmod(filename, file.mode);
      offset += file.size;
    }
  } catch (error) {
    await rm(destination, { recursive: true, force: true });
    throw error;
  }
  return { ...metadata, files: metadata.files.map(({ sourcePath: _sourcePath, ...file }) => file), totalBytes: metadata.totalBytes };
}

function validateExpected(metadata, expected) {
  exactObject(expected, "expected artifact identity", ["kind", "slug", "version", "sourceCommit", "bundleName", "entry"]);
  for (const key of ["kind", "slug", "version", "sourceCommit", "bundleName", "entry"]) {
    if (metadata[key] !== expected[key]) throw new Error(`artifact ${key} does not match the approved release`);
  }
}

async function assertSingleDownloadedFile(packagePath) {
  const parent = path.dirname(packagePath);
  const expectedName = path.basename(packagePath);
  const entries = await readdir(parent);
  if (entries.length !== 1 || entries[0] !== expectedName) throw new Error("artifact download contains unexpected files");
}

async function readExactly(handle, length, position) {
  const buffer = Buffer.alloc(length);
  let offset = 0;
  while (offset < length) {
    const result = await handle.read(buffer, offset, length - offset, position + offset);
    if (result.bytesRead === 0) throw new Error("artifact package ended unexpectedly");
    offset += result.bytesRead;
  }
  return buffer;
}

async function writeAll(handle, buffer) {
  let offset = 0;
  while (offset < buffer.length) {
    const result = await handle.write(buffer, offset, buffer.length - offset);
    if (result.bytesWritten === 0) throw new Error("artifact package write made no progress");
    offset += result.bytesWritten;
  }
}

async function hashFile(filename) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filename)) hash.update(chunk);
  return hash.digest("hex");
}
