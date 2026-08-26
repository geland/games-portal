#!/usr/bin/env node
import { appendFile } from "node:fs/promises";
import process from "node:process";
import { resolvePrivateRelease, writeEffectiveConfig } from "./private-source.mjs";

const command = process.argv[2];
const options = {
  registryFile: required("PRIVATE_GAME_REGISTRY"),
  gameId: required("SELECTED_GAME"),
  sourceSha: required("SOURCE_SHA"),
  version: required("RELEASE_VERSION"),
  profile: required("RELEASE_PROFILE"),
  buildRunId: required("BUILD_RUN_ID"),
  resume: required("RESUME_EXISTING")
};

if (command === "resolve") {
  const release = await resolvePrivateRelease(options);
  const values = {
    game_id: release.gameId,
    source_repository: release.repository,
    source_workflow: release.sourceWorkflow,
    source_workflow_name: release.sourceWorkflowName,
    source_sha: release.sourceSha,
    version: release.version,
    profile: release.profile,
    build_run_id: release.buildRunId,
    resume: release.resume,
    config_path: release.configPath,
    slug: release.slug,
    web_enabled: String(release.webEnabled),
    web_entry: release.webEntry,
    mac_enabled: String(release.macEnabled),
    mac_bundle_name: release.macBundleName,
    mac_entitlements: release.macEntitlements,
    bundle_identifier: release.bundleIdentifier,
    candidate_web_enabled: String(release.candidateWebEnabled),
    candidate_mac_enabled: String(release.candidateMacEnabled),
    web_artifact_name: release.webArtifactName,
    web_package_filename: release.webPackageFilename,
    mac_artifact_name: release.macArtifactName,
    mac_package_filename: release.macPackageFilename,
    candidate_artifact_names_json: JSON.stringify(release.candidateArtifactNames)
  };
  await appendFile(required("GITHUB_OUTPUT"), Object.entries(values).map(([key, value]) => `${key}=${value}\n`).join(""));
} else if (command === "write-effective-config") {
  await writeEffectiveConfig({ ...options, outputFile: required("EFFECTIVE_CONFIG_OUTPUT") });
} else {
  throw new Error("usage: private-source-cli.mjs resolve|write-effective-config");
}

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}
