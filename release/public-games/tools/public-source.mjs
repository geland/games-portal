import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { isSafeRelativePath, loadConfig, setPresetOption, SHA_RE, VERSION_RE } from "../../../templates/game-repo/.github/release-tools/lib.mjs";

export const PUBLIC_REPOSITORIES = new Map([
  ["astro-bro", "judaheland-dev/astrobro"],
  ["racing-maze", "judaheland-dev/race-maze"],
  ["tower-defense", "judaheland-dev/tower-defense"]
]);

const REPOSITORY_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const BUNDLE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9.-]+$/;

function exactObject(value, label, allowed) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new Error(`unknown ${label} key: ${key}`);
  return value;
}

function singleLine(value, label) {
  if (typeof value !== "string" || !value || /[\r\n\0]/.test(value)) throw new Error(`${label} must be a non-empty single-line string`);
  return value;
}

export function validatePublicRegistry(raw) {
  exactObject(raw, "public registry", ["schemaVersion", "games"]);
  if (raw.schemaVersion !== 1) throw new Error("public registry schemaVersion must be 1");
  exactObject(raw.games, "public registry games", [...PUBLIC_REPOSITORIES.keys()]);
  const actualIds = Object.keys(raw.games).sort();
  const expectedIds = [...PUBLIC_REPOSITORIES.keys()].sort();
  if (actualIds.join("\n") !== expectedIds.join("\n")) throw new Error("public registry must contain exactly the approved games");

  const games = {};
  for (const [id, expectedRepository] of PUBLIC_REPOSITORIES) {
    const game = exactObject(raw.games[id], `public game ${id}`, ["repository", "config", "bundleIdentifier"]);
    const repository = singleLine(game.repository, `${id}.repository`);
    if (!REPOSITORY_RE.test(repository) || repository !== expectedRepository) throw new Error(`${id}.repository is not approved`);
    const config = singleLine(game.config, `${id}.config`);
    if (!isSafeRelativePath(config) || !config.endsWith(".json")) throw new Error(`${id}.config must be a safe JSON path`);
    const bundleIdentifier = singleLine(game.bundleIdentifier, `${id}.bundleIdentifier`);
    if (!BUNDLE_ID_RE.test(bundleIdentifier) || !bundleIdentifier.includes(".")) throw new Error(`${id}.bundleIdentifier is invalid`);
    games[id] = { repository, config, bundleIdentifier };
  }
  return { schemaVersion: 1, games };
}

export async function loadPublicRegistry(filename) {
  return validatePublicRegistry(JSON.parse(await readFile(filename, "utf8")));
}

export async function resolvePublicRelease({ registryFile, gameId, sourceSha, version, resume }) {
  if (!PUBLIC_REPOSITORIES.has(gameId)) throw new Error("selected game is not on the public-source allowlist");
  if (!SHA_RE.test(sourceSha)) throw new Error("source SHA must be exactly 40 lowercase hexadecimal characters");
  if (!VERSION_RE.test(version)) throw new Error("version must exactly match vMAJOR.MINOR.PATCH without leading zeroes");
  if (!['true', 'false'].includes(resume)) throw new Error("resume_existing must be true or false");
  const registry = await loadPublicRegistry(registryFile);
  const game = registry.games[gameId];
  const registryRoot = path.dirname(path.resolve(registryFile));
  const repositoryRoot = path.resolve(registryRoot, "../..");
  const configFile = path.resolve(repositoryRoot, game.config);
  if (path.relative(repositoryRoot, configFile).startsWith("..")) throw new Error("release config escaped the trusted repository");
  const config = await loadConfig(configFile);
  if (config.slug !== gameId) throw new Error("public game id and release slug must match");
  return {
    gameId,
    repository: game.repository,
    configPath: game.config,
    configFile,
    projectPath: config.projectPath,
    slug: config.slug,
    sourceSha,
    version,
    resume,
    webEnabled: config.web.enabled,
    webPreset: config.web.preset,
    webEntry: config.web.entry,
    macEnabled: config.mac.enabled,
    macPreset: config.mac.preset,
    macBundleName: config.mac.bundleName,
    macEntitlements: config.mac.entitlements ?? "",
    bundleIdentifier: game.bundleIdentifier,
    artifactStem: `${config.slug}-${version}-${sourceSha.slice(0, 12)}`
  };
}

export async function preparePublicStage({ registryFile, gameId, target, projectDirectory, version }) {
  const resolved = await resolvePublicRelease({
    registryFile,
    gameId,
    sourceSha: "0".repeat(40),
    version,
    resume: "false"
  });
  if (target !== "web" && target !== "mac") throw new Error("release target must be web or mac");
  if (target === "web" && !resolved.webEnabled) throw new Error("Web is not enabled for the selected game");
  if (target === "mac" && !resolved.macEnabled) throw new Error("Mac is not enabled for the selected game");
  const projectRoot = path.resolve(projectDirectory);
  const projectFile = path.join(projectRoot, "project.godot");
  const presetFile = path.join(projectRoot, "export_presets.cfg");

  if (target === "web") {
    let projectText = await readFile(projectFile, "utf8");
    projectText = setProjectSetting(projectText, "rendering", "renderer/rendering_method", '"gl_compatibility"');
    projectText = setProjectSetting(projectText, "rendering", "renderer/rendering_method.mobile", '"gl_compatibility"');
    projectText = setProjectSetting(projectText, "rendering", "textures/vram_compression/import_etc2_astc", "true");
    await writeFile(projectFile, projectText);
    await writeFile(presetFile, renderTrustedWebPreset(resolved.webPreset));
  } else {
    let presets = await readFile(presetFile, "utf8");
    presets = setPresetOption(presets, resolved.macPreset, "macOS", "application/bundle_identifier", JSON.stringify(resolved.bundleIdentifier));
    const shortVersion = version.slice(1);
    presets = setPresetOption(presets, resolved.macPreset, "macOS", "application/short_version", JSON.stringify(shortVersion));
    presets = setPresetOption(presets, resolved.macPreset, "macOS", "application/version", JSON.stringify(shortVersion));
    await writeFile(presetFile, presets);
  }
  return resolved;
}

export function setProjectSetting(text, sectionName, key, encodedValue) {
  if (!/^[a-z0-9_./]+$/.test(key) || !/^[a-z0-9_]+$/.test(sectionName)) throw new Error("invalid Godot setting name");
  const newline = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.replaceAll("\r\n", "\n").split("\n");
  const header = `[${sectionName}]`;
  let start = lines.findIndex((line) => line.trim() === header);
  if (start < 0) {
    while (lines.at(-1) === "") lines.pop();
    lines.push("", header, `${key}=${encodedValue}`, "");
    return lines.join(newline);
  }
  let end = lines.findIndex((line, index) => index > start && /^\s*\[.*\]\s*$/.test(line));
  if (end < 0) end = lines.length;
  const matches = [];
  for (let index = start + 1; index < end; index += 1) {
    if (lines[index].slice(0, lines[index].indexOf("=")).trim() === key) matches.push(index);
  }
  if (matches.length > 1) throw new Error(`duplicate project setting: ${key}`);
  if (matches.length === 1) lines[matches[0]] = `${key}=${encodedValue}`;
  else lines.splice(end, 0, `${key}=${encodedValue}`);
  return lines.join(newline);
}

export function renderTrustedWebPreset(name) {
  if (typeof name !== "string" || !/^[A-Za-z0-9 _.-]+$/.test(name)) throw new Error("invalid Web preset name");
  return `[preset.0]

name=${JSON.stringify(name)}
platform="Web"
runnable=false
dedicated_server=false
custom_features=""
export_filter="all_resources"
include_filter=""
exclude_filter=".godot/**,**/.DS_Store,addons/godot_ai/**,build/**,tests/**"
export_path="build/web/index.html"
patches=PackedStringArray()
patch_delta_encoding=false
patch_delta_compression_level_zstd=19
patch_delta_min_reduction=0.1
patch_delta_include_filters="*"
patch_delta_exclude_filters=""
encryption_include_filters=""
encryption_exclude_filters=""
seed=0
encrypt_pck=false
encrypt_directory=false
script_export_mode=2

[preset.0.options]

custom_template/debug=""
custom_template/release=""
variant/extensions_support=false
variant/thread_support=false
vram_texture_compression/for_desktop=true
vram_texture_compression/for_mobile=true
html/export_icon=true
html/custom_html_shell=""
html/head_include=""
html/canvas_resize_policy=2
html/focus_canvas_on_start=true
html/experimental_virtual_keyboard=false
progressive_web_app/enabled=false
progressive_web_app/offline_page=""
progressive_web_app/display=1
progressive_web_app/orientation=0
progressive_web_app/icon_144x144=""
progressive_web_app/icon_180x180=""
progressive_web_app/icon_512x512=""
progressive_web_app/background_color=Color(0, 0, 0, 1)
dotnet/include_scripts_content=false
`;
}
