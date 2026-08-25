#!/usr/bin/env node
import { lstat, open, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { isSafeRelativePath } from "./lib.mjs";

const [directory, entry] = process.argv.slice(2);
if (!directory || !isSafeRelativePath(entry ?? "")) throw new Error("usage: verify-web.mjs <directory> <entry>");
const root = path.resolve(directory);
const html = await readFile(path.join(root, entry), "utf8");
if (!/<canvas|Godot|Engine/i.test(html)) throw new Error("Web entry does not look like a Godot export");

const extensions = new Set();
for (const item of await readdir(root)) {
  const filename = path.join(root, item);
  const info = await lstat(filename);
  if (info.isSymbolicLink()) throw new Error(`Web export contains a symlink: ${item}`);
  if (info.isFile()) {
    if (info.size === 0) throw new Error(`Web export contains an empty file: ${item}`);
    extensions.add(path.extname(item).toLowerCase());
  }
}
for (const extension of [".html", ".js", ".pck", ".wasm"]) {
  if (!extensions.has(extension)) throw new Error(`Web export is missing ${extension}`);
}
const wasm = (await readdir(root)).find((item) => item.endsWith(".wasm"));
const handle = await open(path.join(root, wasm), "r");
const header = Buffer.alloc(4);
try {
  await handle.read(header, 0, 4, 0);
} finally {
  await handle.close();
}
if (!header.equals(Buffer.from([0x00, 0x61, 0x73, 0x6d]))) throw new Error("WebAssembly file has an invalid magic header");
