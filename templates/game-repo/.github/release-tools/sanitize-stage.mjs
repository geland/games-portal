#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { sanitizeStagedProjectText } from "./lib.mjs";

const [projectDirectory] = process.argv.slice(2);
if (!projectDirectory) throw new Error("usage: sanitize-stage.mjs <staged-project-directory>");
const projectFile = path.resolve(projectDirectory, "project.godot");
const text = await readFile(projectFile, "utf8");

// godot_ai is editor/MCP tooling, not a runtime dependency. Its directory is
// excluded during staging; remove the generated helper autoload and plugin
// entry from only the staged project.godot so headless export cannot start it.
await writeFile(projectFile, sanitizeStagedProjectText(text));
