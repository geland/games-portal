import assert from "node:assert/strict";
import { link, mkdtemp, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { packArtifact, unpackArtifact, validateArtifactMetadata } from "../artifact-container.mjs";

const identity = {
  kind: "web",
  slug: "astro-bro",
  version: "v1.0.0",
  sourceCommit: "a".repeat(40),
  bundleName: null,
  entry: "index.html"
};

test("artifact container round-trips verified regular files", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "gregeland-container-"));
  const input = path.join(root, "input");
  const download = path.join(root, "download");
  await mkdir(path.join(input, "assets"), { recursive: true });
  await mkdir(download);
  await writeFile(path.join(input, "index.html"), "<canvas></canvas>");
  await writeFile(path.join(input, "assets/game.pck"), "pck-data");
  const packageFile = path.join(download, "game.gpkg");
  await packArtifact({ ...identity, input, output: packageFile });
  const output = path.join(root, "release", "web");
  const metadata = await unpackArtifact({ packageFile, output, expected: identity });
  assert.equal(metadata.files.length, 2);
  assert.equal(await readFile(path.join(output, "assets/game.pck"), "utf8"), "pck-data");
});

test("packaging rejects symlinks and hardlinks", async () => {
  const symlinkRoot = await mkdtemp(path.join(os.tmpdir(), "gregeland-symlink-"));
  await writeFile(path.join(symlinkRoot, "index.html"), "ok");
  await symlink("index.html", path.join(symlinkRoot, "linked.html"));
  await assert.rejects(packArtifact({ ...identity, input: symlinkRoot, output: path.join(symlinkRoot, "../symlink.gpkg") }), /symlinks/);

  const hardlinkRoot = await mkdtemp(path.join(os.tmpdir(), "gregeland-hardlink-"));
  await writeFile(path.join(hardlinkRoot, "index.html"), "ok");
  await link(path.join(hardlinkRoot, "index.html"), path.join(hardlinkRoot, "copy.html"));
  await assert.rejects(packArtifact({ ...identity, input: hardlinkRoot, output: path.join(hardlinkRoot, "../hardlink.gpkg") }), /hardlinks/);
});

test("unpacking rejects traversal before writing files", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "gregeland-traversal-"));
  const input = path.join(root, "input");
  const download = path.join(root, "download");
  await mkdir(input);
  await mkdir(download);
  await writeFile(path.join(input, "index.html"), "ok");
  const packageFile = path.join(download, "game.gpkg");
  await packArtifact({ ...identity, input, output: packageFile });
  const data = await readFile(packageFile);
  const marker = Buffer.from("index.html");
  const first = data.indexOf(marker);
  const index = data.indexOf(marker, first + marker.length);
  assert.notEqual(index, -1);
  Buffer.from("../x.html").copy(data, index);
  await writeFile(packageFile, data);
  await assert.rejects(unpackArtifact({ packageFile, output: path.join(root, "output"), expected: identity }), /unsafe artifact path/);
});

test("unpacking rejects unexpected downloaded files", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "gregeland-extra-"));
  const input = path.join(root, "input");
  const download = path.join(root, "download");
  await mkdir(input);
  await mkdir(download);
  await writeFile(path.join(input, "index.html"), "ok");
  const packageFile = path.join(download, "game.gpkg");
  await packArtifact({ ...identity, input, output: packageFile });
  await writeFile(path.join(download, "unexpected"), "no");
  await assert.rejects(unpackArtifact({ packageFile, output: path.join(root, "output"), expected: identity }), /unexpected files/);
});

test("Mac metadata rejects multiple roots, link records, and oversized files", () => {
  const base = {
    formatVersion: 1,
    kind: "mac",
    slug: "racing-maze",
    version: "v1.0.0",
    sourceCommit: "b".repeat(40),
    bundleName: "Racing Maze",
    entry: null,
    files: [
      { path: "Racing Maze.app/Contents/Info.plist", size: 1, sha256: "c".repeat(64), mode: 0o644 },
      { path: "Racing Maze.app/Contents/MacOS/Racing Maze", size: 1, sha256: "d".repeat(64), mode: 0o755 }
    ]
  };
  assert.doesNotThrow(() => validateArtifactMetadata(base));
  assert.throws(() => validateArtifactMetadata({ ...base, files: [...base.files, {
    path: "Other.app/Contents/MacOS/Other", size: 1, sha256: "e".repeat(64), mode: 0o755
  }] }), /renamed or additional/);
  assert.throws(() => validateArtifactMetadata({ ...base, files: [{ ...base.files[0], link: "target" }, base.files[1]] }), /unknown artifact file/);
  assert.throws(() => validateArtifactMetadata({ ...base, files: [{ ...base.files[0], size: 2 * 1024 * 1024 * 1024 + 1 }, base.files[1]] }), /size/);
});
