#!/usr/bin/env node
import { appendFile } from "node:fs/promises";
import process from "node:process";
import { preparePublicStage, resolvePublicRelease } from "./public-source.mjs";

const command = process.argv[2];
const registryFile = required("PUBLIC_GAME_REGISTRY");

if (command === "resolve") {
  const release = await resolvePublicRelease({
    registryFile,
    gameId: required("SELECTED_GAME"),
    sourceSha: required("SOURCE_SHA"),
    version: required("RELEASE_VERSION"),
    resume: required("RESUME_EXISTING")
  });
  const output = required("GITHUB_OUTPUT");
  const values = {
    game_id: release.gameId,
    source_repository: release.repository,
    source_sha: release.sourceSha,
    version: release.version,
    resume: release.resume,
    config_path: release.configPath,
    project_path: release.projectPath,
    slug: release.slug,
    web_enabled: String(release.webEnabled),
    web_preset: release.webPreset,
    web_entry: release.webEntry,
    mac_enabled: String(release.macEnabled),
    mac_preset: release.macPreset,
    mac_bundle_name: release.macBundleName,
    mac_entitlements: release.macEntitlements,
    bundle_identifier: release.bundleIdentifier,
    artifact_stem: release.artifactStem
  };
  await appendFile(output, Object.entries(values).map(([key, value]) => `${key}=${value}\n`).join(""));
} else if (command === "prepare-stage") {
  await preparePublicStage({
    registryFile,
    gameId: required("SELECTED_GAME"),
    target: required("RELEASE_TARGET"),
    projectDirectory: required("PROJECT_PATH"),
    version: required("RELEASE_VERSION")
  });
} else {
  throw new Error("usage: public-source-cli.mjs resolve|prepare-stage");
}

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}
