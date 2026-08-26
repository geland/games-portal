import { createHash, createHmac } from "node:crypto";
import { lstat, readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

export const VERSION_RE = /^v(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$/;
export const SHA_RE = /^[0-9a-f]{40}$/;
export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isSafeMacExecutableName(value) {
  return typeof value === "string"
    && value.length >= 1
    && value.length <= 128
    && value !== "."
    && value !== ".."
    && !/[\\/\x00-\x1f\x7f]/.test(value)
    && /^[A-Za-z0-9][A-Za-z0-9 ._+\-]*$/.test(value);
}

const MIME_TYPES = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".mp3", "audio/mpeg"],
  [".ogg", "audio/ogg"],
  [".pck", "application/octet-stream"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".wasm", "application/wasm"],
  [".webp", "image/webp"],
  [".zip", "application/zip"]
]);

export function contentTypeFor(filename) {
  return MIME_TYPES.get(path.extname(filename).toLowerCase()) ?? "application/octet-stream";
}

export function isSafeRelativePath(value) {
  if (typeof value !== "string" || !value || value.startsWith("/") || value.includes("\\") || /[\x00-\x1f\x7f]/.test(value)) {
    return false;
  }
  return value.split("/").every((part) => part && part !== "." && part !== "..");
}

function expectString(value, label) {
  if (typeof value !== "string" || !value || /[\r\n\0]/.test(value)) {
    throw new Error(`${label} must be a non-empty, single-line string`);
  }
  return value;
}

export function validateConfig(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("release config must be an object");
  const allowedRoot = new Set(["$schema", "slug", "projectPath", "godotVersion", "web", "mac"]);
  for (const key of Object.keys(raw)) if (!allowedRoot.has(key)) throw new Error(`unknown config key: ${key}`);

  const slug = expectString(raw.slug, "slug");
  if (!SLUG_RE.test(slug)) throw new Error("slug must use lowercase letters, digits, and interior hyphens");
  if (raw.godotVersion !== "4.6.2") throw new Error("godotVersion must be exactly 4.6.2");
  const projectPath = expectString(raw.projectPath, "projectPath");
  if (!isSafeRelativePath(projectPath) && projectPath !== ".") throw new Error("projectPath must stay inside the repository");

  const web = validateTarget(raw.web, "web", ["enabled", "preset", "entry"]);
  const mac = validateTarget(raw.mac, "mac", ["enabled", "preset", "bundleName", "entitlements"]);
  if (!web.enabled && !mac.enabled) throw new Error("at least one release target must be enabled");
  if (!isSafeRelativePath(web.entry) || !web.entry.endsWith(".html")) throw new Error("web.entry must be a safe relative HTML path");
  if (!/^[A-Za-z0-9][A-Za-z0-9 ._-]{0,99}$/.test(mac.bundleName)) throw new Error("mac.bundleName contains unsafe characters");
  if (mac.entitlements !== null && !isSafeRelativePath(expectString(mac.entitlements, "mac.entitlements"))) {
    throw new Error("mac.entitlements must stay inside the repository");
  }
  return { slug, projectPath, godotVersion: raw.godotVersion, web, mac };
}

function validateTarget(raw, label, allowed) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error(`${label} must be an object`);
  for (const key of Object.keys(raw)) if (!allowed.includes(key)) throw new Error(`unknown ${label} key: ${key}`);
  if (typeof raw.enabled !== "boolean") throw new Error(`${label}.enabled must be boolean`);
  return {
    enabled: raw.enabled,
    preset: expectString(raw.preset, `${label}.preset`),
    ...(label === "web"
      ? { entry: expectString(raw.entry, "web.entry") }
      : {
          bundleName: expectString(raw.bundleName, "mac.bundleName"),
          entitlements: raw.entitlements === null ? null : expectString(raw.entitlements, "mac.entitlements")
        })
  };
}

export async function loadConfig(filename = process.env.RELEASE_CONFIG_FILE ?? ".gregeland-release.json") {
  return validateConfig(JSON.parse(await readFile(filename, "utf8")));
}

export function parsePresets(text) {
  const presets = new Map();
  let section = null;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    const match = /^\[preset\.(\d+)(\.options)?\]$/.exec(line);
    if (match) {
      const index = match[1];
      if (!presets.has(index)) presets.set(index, { values: new Map(), options: new Map() });
      section = match[2] ? presets.get(index).options : presets.get(index).values;
      continue;
    }
    if (line.startsWith("[") || !section || !line.includes("=")) continue;
    const split = line.indexOf("=");
    section.set(line.slice(0, split), decodeGodotValue(line.slice(split + 1)));
  }
  return presets;
}

function decodeGodotValue(value) {
  if (value.startsWith('"') && value.endsWith('"')) {
    try { return JSON.parse(value); } catch { return value.slice(1, -1); }
  }
  if (value === "true") return true;
  if (value === "false") return false;
  return value;
}

export function findPreset(presets, name, platform) {
  for (const [index, preset] of presets) {
    if (preset.values.get("name") === name && preset.values.get("platform") === platform) return { index, ...preset };
  }
  throw new Error(`export preset ${JSON.stringify(name)} for ${platform} was not found`);
}

export function setPresetOption(text, presetName, platform, key, encodedValue) {
  const parsed = parsePresets(text);
  const preset = findPreset(parsed, presetName, platform);
  const normalized = text.replaceAll("\r\n", "\n");
  const header = `[preset.${preset.index}.options]`;
  const start = normalized.indexOf(header);
  if (start < 0) throw new Error(`${platform} preset options section is missing`);
  const next = normalized.indexOf("\n[preset.", start + header.length);
  const end = next < 0 ? normalized.length : next;
  const section = normalized.slice(start, end);
  const keyPattern = new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}=.*$`, "gm");
  const occurrences = [...section.matchAll(keyPattern)];
  if (occurrences.length > 1) throw new Error(`duplicate preset option: ${key}`);
  let nextSection;
  if (occurrences.length === 1) nextSection = section.replace(keyPattern, `${key}=${encodedValue}`);
  else nextSection = `${section.replace(/\n*$/, "")}\n${key}=${encodedValue}\n`;
  return normalized.slice(0, start) + nextSection + normalized.slice(end);
}

export function patchMacReleaseVersion(text, presetName, releaseVersion) {
  if (!VERSION_RE.test(releaseVersion)) throw new Error("release version must exactly match vMAJOR.MINOR.PATCH");
  const value = JSON.stringify(releaseVersion.slice(1));
  let result = setPresetOption(text, presetName, "macOS", "application/short_version", value);
  result = setPresetOption(result, presetName, "macOS", "application/version", value);
  return result;
}

export function assertProjectReleaseReady(config, projectText, presetsText, target) {
  const presets = parsePresets(presetsText);
  if (target === "web") {
    if (!config.web.enabled) throw new Error("Web target is not enabled");
    const web = findPreset(presets, config.web.preset, "Web");
    const compatibility = /renderer\/rendering_method\s*=\s*"gl_compatibility"/.test(projectText)
      || /config\/features\s*=.*"GL Compatibility"/.test(projectText);
    if (!compatibility) throw new Error("Web releases require the GL Compatibility renderer in project.godot");
    if (web.options.get("variant/thread_support") === true) throw new Error("threaded Web exports are not supported by the default hosting path");
    if (web.options.get("variant/extensions_support") === true) throw new Error("Web extension support requires a separately designed cross-origin-isolated path");
    if (web.options.get("progressive_web_app/enabled") === true) throw new Error("PWA exports are disabled for immutable version paths");
  } else if (target === "mac") {
    if (!config.mac.enabled) throw new Error("Mac target is not enabled");
    const mac = findPreset(presets, config.mac.preset, "macOS");
    const bundleId = mac.options.get("application/bundle_identifier");
    if (typeof bundleId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9.-]+$/.test(bundleId) || !bundleId.includes(".")) {
      throw new Error("the macOS preset needs a valid, unique application/bundle_identifier");
    }
    for (const key of ["codesign/certificate_password", "notarization/apple_id_password", "notarization/api_key"]) {
      const value = mac.options.get(key);
      if (typeof value === "string" && value.length > 0) throw new Error(`${key} must not be stored in export_presets.cfg`);
    }
  } else throw new Error("release target must be web or mac");
}

export function disablePresetSigning(text, presetName) {
  const presets = parsePresets(text);
  const preset = findPreset(presets, presetName, "macOS");
  const header = `[preset.${preset.index}.options]`;
  const start = text.indexOf(header);
  if (start < 0) throw new Error("macOS preset options section is missing");
  const next = text.indexOf("\n[preset.", start + header.length);
  const end = next < 0 ? text.length : next;
  const before = text.slice(0, start);
  let section = text.slice(start, end);
  const after = text.slice(end);
  const replacements = new Map([
    ["codesign/codesign", "0"],
    ["codesign/enable", "false"],
    ["codesign/identity", '""'],
    ["codesign/certificate_file", '""'],
    ["codesign/certificate_password", '""'],
    ["codesign/entitlements/debugging", "false"],
    ["notarization/notarization", "0"],
    ["notarization/enable", "false"],
    ["notarization/apple_id_name", '""'],
    ["notarization/apple_id_password", '""'],
    ["notarization/api_uuid", '""'],
    ["notarization/api_key", '""'],
    ["notarization/api_key_id", '""']
  ]);
  section = section.split(/(?<=\n)/).map((line) => {
    const key = line.slice(0, line.indexOf("="));
    return replacements.has(key) ? `${key}=${replacements.get(key)}${line.endsWith("\n") ? "\n" : ""}` : line;
  }).join("");
  return before + section + after;
}

export async function collectFiles(root, keyPrefix) {
  const files = [];
  async function walk(directory, relative) {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const rel = relative ? `${relative}/${entry.name}` : entry.name;
      if (!isSafeRelativePath(rel)) throw new Error(`unsafe artifact path: ${rel}`);
      const full = path.join(directory, entry.name);
      const info = await lstat(full);
      if (info.isSymbolicLink()) throw new Error(`artifact symlinks are not allowed: ${rel}`);
      if (info.isDirectory()) await walk(full, rel);
      else if (info.isFile()) files.push(await describeFile(full, `${keyPrefix}/${rel}`, rel));
      else throw new Error(`unsupported artifact type: ${rel}`);
    }
  }
  await walk(root, "");
  if (files.length === 0) throw new Error(`artifact directory is empty: ${root}`);
  return files;
}

export async function describeFile(filename, key, relative = path.basename(filename)) {
  const info = await stat(filename);
  if (!info.isFile() || info.size === 0) throw new Error(`artifact must be a non-empty regular file: ${filename}`);
  return {
    filename,
    key,
    relative,
    size: info.size,
    sha256: await hashFile(filename, "sha256", "hex"),
    md5: await hashFile(filename, "md5", "base64"),
    contentType: contentTypeFor(filename)
  };
}

async function hashFile(filename, algorithm, encoding) {
  const hash = createHash(algorithm);
  const file = await import("node:fs").then(({ createReadStream }) => createReadStream(filename));
  for await (const chunk of file) hash.update(chunk);
  return hash.digest(encoding);
}

function base64url(value) {
  return Buffer.from(value).toString("base64url");
}

export function createScopedR2Credentials({ accountId, accessKeyId, secretAccessKey, bucket, prefixes, now = Math.floor(Date.now() / 1000), ttlSeconds = 7200 }) {
  const endpointHost = `${accountId}.r2.cloudflarestorage.com`;
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const claims = base64url(JSON.stringify({
    bucket,
    scope: "object-read-write",
    paths: { prefixPaths: prefixes, objectPaths: [] },
    sub: accountId,
    iss: accessKeyId,
    aud: endpointHost,
    iat: now,
    exp: now + ttlSeconds
  }));
  const unsigned = `${header}.${claims}`;
  const signature = createHmac("sha256", secretAccessKey).update(unsigned).digest("base64url");
  const jwt = `${unsigned}.${signature}`;
  return {
    accessKeyId,
    secretAccessKey: createHash("sha256").update(jwt).digest("hex"),
    sessionToken: Buffer.from(`jwt/${jwt}`).toString("base64"),
    endpoint: `https://${endpointHost}`
  };
}

export function buildManifest({ slug, version, sourceCommit, publishedAt, webEntry, macKey, files }) {
  const manifest = { slug, version, sourceCommit, publishedAt };
  if (webEntry) manifest.web = { entry: webEntry };
  if (macKey) manifest.mac = { key: macKey, filename: path.posix.basename(macKey) };
  manifest.files = files.map(({ key, size, sha256, contentType }) => ({ key, size, sha256, contentType }));
  return manifest;
}

export function planImmutableUploads(keys, existingKeys, allowResume) {
  const existing = keys.filter((key) => existingKeys.has(key));
  if (existing.length > 0 && !allowResume) throw new Error(`immutable release key already exists: ${existing[0]}`);
  return { existing, missing: keys.filter((key) => !existingKeys.has(key)) };
}

export function sanitizeStagedProjectText(text) {
  return text
    .split(/(?<=\n)/)
    .filter((line) => !line.includes('="*res://addons/godot_ai/'))
    .map((line) => {
      if (!line.startsWith("enabled=PackedStringArray(")) return line;
      const suffix = line.endsWith("\n") ? "\n" : "";
      const plugins = [...line.matchAll(/"([^"]+)"/g)]
        .map((match) => match[1])
        .filter((plugin) => plugin !== "res://addons/godot_ai/plugin.cfg");
      return `enabled=PackedStringArray(${plugins.map((plugin) => JSON.stringify(plugin)).join(", ")})${suffix}`;
    })
    .join("");
}
