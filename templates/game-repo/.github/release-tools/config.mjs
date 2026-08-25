#!/usr/bin/env node
import { appendFile, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { assertProjectReleaseReady, disablePresetSigning, loadConfig, SHA_RE, VERSION_RE } from "./lib.mjs";

const [command] = process.argv.slice(2);

if (command === "outputs") {
  const config = await loadConfig();
  const output = process.env.GITHUB_OUTPUT;
  if (!output) throw new Error("GITHUB_OUTPUT is not set");
  const values = {
    slug: config.slug,
    project_path: config.projectPath,
    web_enabled: String(config.web.enabled),
    web_preset: config.web.preset,
    web_entry: config.web.entry,
    mac_enabled: String(config.mac.enabled),
    mac_preset: config.mac.preset,
    mac_bundle_name: config.mac.bundleName,
    mac_entitlements: config.mac.entitlements ?? ""
  };
  await appendFile(output, Object.entries(values).map(([key, value]) => `${key}=${value}\n`).join(""));
} else if (command === "check-project") {
  const config = await loadConfig();
  const root = path.resolve(process.env.PROJECT_PATH ?? config.projectPath);
  const target = process.env.RELEASE_TARGET ?? "";
  const project = await readFile(path.join(root, "project.godot"), "utf8");
  const presets = await readFile(path.join(root, "export_presets.cfg"), "utf8");
  assertProjectReleaseReady(config, project, presets, target);
  if (target === "mac" && config.mac.entitlements) await readFile(path.resolve(config.mac.entitlements));
} else if (command === "disable-signing") {
  const config = await loadConfig();
  const presetFile = path.resolve(process.env.PROJECT_PATH ?? config.projectPath, "export_presets.cfg");
  await writeFile(presetFile, disablePresetSigning(await readFile(presetFile, "utf8"), config.mac.preset));
} else if (command === "resolve-release") {
  const event = process.env.RELEASE_EVENT ?? "";
  const head = (process.env.RELEASE_HEAD ?? "").toLowerCase();
  let version;
  let resume = false;
  if (!SHA_RE.test(head)) throw new Error("checked-out release commit is not an exact 40-character SHA");
  if (event === "push") {
    if (process.env.RELEASE_REF_TYPE !== "tag") throw new Error("automatic releases must come from a tag");
    version = process.env.RELEASE_REF_NAME ?? "";
  } else if (event === "workflow_dispatch") {
    version = process.env.RELEASE_INPUT_VERSION ?? "";
    const requested = (process.env.RELEASE_INPUT_COMMIT ?? "").toLowerCase();
    if (!SHA_RE.test(requested) || requested !== head) throw new Error("manual releases require the checked-out full commit SHA");
    if (![/^true$/, /^false$/].some((pattern) => pattern.test(process.env.RELEASE_INPUT_RESUME ?? "false"))) {
      throw new Error("manual resume input must be true or false");
    }
    resume = process.env.RELEASE_INPUT_RESUME === "true";
  } else {
    throw new Error(`unsupported release event: ${event}`);
  }
  if (!VERSION_RE.test(version)) throw new Error("release version must exactly match vMAJOR.MINOR.PATCH without leading zeroes");
  const output = process.env.GITHUB_OUTPUT;
  if (!output) throw new Error("GITHUB_OUTPUT is not set");
  await appendFile(output, `version=${version}\ncommit=${head}\nresume=${resume}\n`);
} else {
  throw new Error("usage: config.mjs outputs|check-project|disable-signing|resolve-release");
}
