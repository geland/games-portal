import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { isSafeRelativePath, loadConfig, SHA_RE, VERSION_RE } from "../../../templates/game-repo/.github/release-tools/lib.mjs";

export const PRIVATE_REPOSITORIES = new Map([
  ["butts", "geland/butts"],
  ["blend-in", "geland/blend-in"],
  ["web-dodge", "geland/motion-games"],
  ["motion-tracker", "geland/motion-games"],
  ["balloon", "geland/motion-games"],
  ["labyrinth", "geland/motion-games"]
]);

export const PRIVATE_PROFILES = new Map([
  ["butts", ["web", "web+mac"]],
  ["blend-in", ["mac"]],
  ["web-dodge", ["web"]],
  ["motion-tracker", ["web"]],
  ["balloon", ["mac"]],
  ["labyrinth", ["mac"]]
]);

const PRIVATE_WORKFLOWS = new Map([
  ["butts", { path: ".github/workflows/release.yml", name: "Build game release candidate", packageStyle: "standard" }],
  ["blend-in", { path: ".github/workflows/release.yml", name: "Build game release candidate", packageStyle: "standard" }],
  ["web-dodge", { path: ".github/workflows/static-release-candidates.yml", name: null, packageStyle: "motion-static" }],
  ["motion-tracker", { path: ".github/workflows/static-release-candidates.yml", name: null, packageStyle: "motion-static" }],
  ["balloon", { path: ".github/workflows/native-release-candidates.yml", name: null, packageStyle: "motion-native" }],
  ["labyrinth", { path: ".github/workflows/native-release-candidates.yml", name: null, packageStyle: "motion-native" }]
]);

const PROFILE_TARGETS = new Map([
  ["web", { web: true, mac: false }],
  ["mac", { web: false, mac: true }],
  ["web+mac", { web: true, mac: true }]
]);
const REPOSITORY_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const BUNDLE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9.-]+$/;
const RUN_ID_RE = /^[1-9][0-9]{0,18}$/;

function exactObject(value, label, allowed) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new Error(`unknown ${label} key: ${key}`);
  return value;
}

function singleLine(value, label) {
  if (typeof value !== "string" || !value || /[\r\n\0]/.test(value)) throw new Error(`${label} must be a non-empty single-line string`);
  return value;
}

function sameStrings(actual, expected) {
  return actual.length === expected.length && [...actual].sort().join("\n") === [...expected].sort().join("\n");
}

export function validatePrivateRegistry(raw) {
  exactObject(raw, "private registry", ["schemaVersion", "games"]);
  if (raw.schemaVersion !== 1) throw new Error("private registry schemaVersion must be 1");
  exactObject(raw.games, "private registry games", [...PRIVATE_REPOSITORIES.keys()]);
  if (!sameStrings(Object.keys(raw.games), [...PRIVATE_REPOSITORIES.keys()])) {
    throw new Error("private registry must contain exactly the approved games");
  }

  const games = {};
  for (const [id, expectedRepository] of PRIVATE_REPOSITORIES) {
    const game = exactObject(raw.games[id], `private game ${id}`, ["repository", "config", "bundleIdentifier", "profiles"]);
    const repository = singleLine(game.repository, `${id}.repository`);
    if (!REPOSITORY_RE.test(repository) || repository !== expectedRepository) throw new Error(`${id}.repository is not approved`);
    const config = singleLine(game.config, `${id}.config`);
    if (!isSafeRelativePath(config) || !config.endsWith(".json")) throw new Error(`${id}.config must be a safe JSON path`);
    const bundleIdentifier = singleLine(game.bundleIdentifier, `${id}.bundleIdentifier`);
    if (!BUNDLE_ID_RE.test(bundleIdentifier) || !bundleIdentifier.includes(".")) throw new Error(`${id}.bundleIdentifier is invalid`);
    if (!Array.isArray(game.profiles) || !sameStrings(game.profiles, PRIVATE_PROFILES.get(id))) {
      throw new Error(`${id}.profiles must contain exactly the approved release profiles`);
    }
    for (const profile of game.profiles) if (!PROFILE_TARGETS.has(profile)) throw new Error(`${id}.profiles contains an invalid profile`);
    games[id] = { repository, config, bundleIdentifier, profiles: [...game.profiles] };
  }
  return { schemaVersion: 1, games };
}

export async function loadPrivateRegistry(filename) {
  return validatePrivateRegistry(JSON.parse(await readFile(filename, "utf8")));
}

export async function resolvePrivateRelease({ registryFile, gameId, sourceSha, version, profile, buildRunId, resume }) {
  if (!PRIVATE_REPOSITORIES.has(gameId)) throw new Error("selected game is not on the private-source allowlist");
  if (!SHA_RE.test(sourceSha)) throw new Error("source SHA must be exactly 40 lowercase hexadecimal characters");
  if (!VERSION_RE.test(version)) throw new Error("version must exactly match vMAJOR.MINOR.PATCH without leading zeroes");
  if (!RUN_ID_RE.test(buildRunId) || !Number.isSafeInteger(Number(buildRunId))) throw new Error("build run ID must be a positive GitHub run ID");
  if (!['true', 'false'].includes(resume)) throw new Error("resume_existing must be true or false");
  const registry = await loadPrivateRegistry(registryFile);
  const game = registry.games[gameId];
  if (!game.profiles.includes(profile)) throw new Error("release profile is not approved for the selected game");
  const targets = PROFILE_TARGETS.get(profile);
  const registryRoot = path.dirname(path.resolve(registryFile));
  const repositoryRoot = path.resolve(registryRoot, "../..");
  const configFile = path.resolve(repositoryRoot, game.config);
  if (path.relative(repositoryRoot, configFile).startsWith("..")) throw new Error("release config escaped the trusted repository");
  const config = await loadConfig(configFile);
  if (config.slug !== gameId) throw new Error("private game id and release slug must match");
  if (targets.web && !config.web.enabled) throw new Error("selected release profile requires a disabled Web target");
  if (targets.mac && !config.mac.enabled) throw new Error("selected release profile requires a disabled Mac target");

  const workflow = PRIVATE_WORKFLOWS.get(gameId);
  let webArtifactName = config.web.enabled ? `${config.slug}-${version}-web-gpkg` : "";
  let webPackageFilename = config.web.enabled ? `${config.slug}-${version}-web.gpkg` : "";
  let macArtifactName = config.mac.enabled ? `${config.slug}-${version}-mac-gpkg` : "";
  let macPackageFilename = config.mac.enabled ? `${config.slug}-${version}-mac.gpkg` : "";
  let candidateArtifactNames = [webArtifactName, macArtifactName].filter(Boolean);
  if (workflow.packageStyle === "motion-static") {
    const sourceAbbreviation = sourceSha.slice(0, 12);
    const motionStem = (slug) => `${slug}-${version}-${sourceAbbreviation}-web`;
    webArtifactName = motionStem(config.slug);
    webPackageFilename = `${webArtifactName}.gpkg`;
    macArtifactName = "";
    macPackageFilename = "";
    candidateArtifactNames = [motionStem("web-dodge"), motionStem("motion-tracker")];
  } else if (workflow.packageStyle === "motion-native") {
    const sourceAbbreviation = sourceSha.slice(0, 12);
    const motionStem = (slug) => `${slug}-${version}-${sourceAbbreviation}-mac`;
    webArtifactName = "";
    webPackageFilename = "";
    macArtifactName = motionStem(config.slug);
    macPackageFilename = `${macArtifactName}.gpkg`;
    candidateArtifactNames = [motionStem("balloon"), motionStem("labyrinth")];
  }
  const sourceWorkflowName = workflow.packageStyle === "motion-static"
    ? `Static candidates from ${version} (push)`
    : workflow.packageStyle === "motion-native"
      ? `Native candidates from ${version} (push)`
      : workflow.name;

  return {
    gameId,
    repository: game.repository,
    configPath: game.config,
    configFile,
    sourceWorkflow: workflow.path,
    sourceWorkflowName,
    sourceSha,
    version,
    profile,
    buildRunId,
    resume,
    slug: config.slug,
    webEnabled: targets.web,
    webPreset: config.web.preset,
    webEntry: config.web.entry,
    macEnabled: targets.mac,
    macPreset: config.mac.preset,
    macBundleName: config.mac.bundleName,
    macEntitlements: config.mac.entitlements ?? "",
    bundleIdentifier: game.bundleIdentifier,
    candidateWebEnabled: config.web.enabled,
    candidateMacEnabled: config.mac.enabled,
    webArtifactName,
    webPackageFilename,
    macArtifactName,
    macPackageFilename,
    candidateArtifactNames
  };
}

export async function writeEffectiveConfig({ outputFile, ...options }) {
  const resolved = await resolvePrivateRelease(options);
  const raw = JSON.parse(await readFile(resolved.configFile, "utf8"));
  raw.web.enabled = resolved.webEnabled;
  raw.mac.enabled = resolved.macEnabled;
  const destination = path.resolve(outputFile);
  await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
  await writeFile(destination, `${JSON.stringify(raw, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  return resolved;
}
