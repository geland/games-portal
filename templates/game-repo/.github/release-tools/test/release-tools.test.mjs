import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { assertProjectReleaseReady, buildManifest, contentTypeFor, createScopedR2Credentials, disablePresetSigning, isSafeMacExecutableName, patchMacReleaseVersion, planImmutableUploads, sanitizeStagedProjectText, validateConfig, VERSION_RE } from "../lib.mjs";
import { PUBLIC_ORIGIN_USER_AGENT, assertReleaseManifestSize, assertUncachedOriginResponse, assertVersionIndexSize, buildCacheProbeKeys, compareReleaseVersions, decideReleasePreflight, parseOriginProbeResponse, publicOriginResponseDiagnostics, validateImmutableManifest, validateVersionIndex } from "../publish-release.mjs";

const config = {
  slug: "astro-bro",
  projectPath: ".",
  godotVersion: "4.6.2",
  web: { enabled: true, preset: "Web", entry: "index.html" },
  mac: { enabled: true, preset: "macOS", bundleName: "Astro Bro", entitlements: null }
};
const sourceCommit = "a".repeat(40);
const publishedAt = "2026-08-25T12:00:00.000Z";
const releaseToolRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function releaseManifest(version = "v1.2.3") {
  const slug = "astro-bro";
  const webKey = `releases/${slug}/${version}/web/index.html`;
  const macKey = `downloads/${slug}/${version}/${slug}-macos-universal.zip`;
  return {
    slug,
    version,
    sourceCommit,
    publishedAt,
    web: { entry: "index.html" },
    mac: { key: macKey, filename: `${slug}-macos-universal.zip` },
    files: [
      { key: webKey, size: 10, sha256: "b".repeat(64), contentType: "text/html; charset=utf-8" },
      { key: macKey, size: 20, sha256: "c".repeat(64), contentType: "application/zip" }
    ]
  };
}

function versionEntry(manifest) {
  return {
    version: manifest.version,
    sourceCommit: manifest.sourceCommit,
    publishedAt: manifest.publishedAt,
    manifest: `manifests/${manifest.slug}/versions/${manifest.version}.json`
  };
}

test("new manifests carry commit time and old immutable manifests remain valid unchanged", () => {
  const old = releaseManifest();
  const original = JSON.stringify(old);
  assert.equal(validateImmutableManifest(old), old);
  assert.equal(JSON.stringify(old), original);
  const sourceCommittedAt = "2026-08-24T23:00:00.000Z";
  const next = buildManifest({ ...old, sourceCommittedAt, webEntry: old.web.entry, macKey: old.mac.key });
  assert.equal(next.sourceCommittedAt, sourceCommittedAt);
  assert.equal(validateImmutableManifest(next), next);
  for (const invalid of [null, "invalid", "2026-02-30T00:00:00.000Z"]) {
    assert.throws(() => validateImmutableManifest({ ...old, sourceCommittedAt: invalid }), /sourceCommittedAt/);
  }
});

test("release versions are exact semantic tags", () => {
  assert.equal(VERSION_RE.test("v1.2.3"), true);
  for (const value of ["1.2.3", "v01.2.3", "v1.2", "v1.2.3-beta", "v1.2.3/evil"]) assert.equal(VERSION_RE.test(value), false);
});

test("release version ordering is numeric and supports large components", () => {
  assert.equal(compareReleaseVersions("v1.10.0", "v1.9.99"), 1);
  assert.equal(compareReleaseVersions("v2.0.0", "v2.0.0"), 0);
  assert.equal(compareReleaseVersions("v999999999999999999999.0.0", "v999999999999999999998.999.999"), 1);
  assert.throws(() => compareReleaseVersions("v1.0", "v1.0.0"), /invalid release version/);
});

test("Mac executable names allow safe spaces and reject unsafe path names", () => {
  for (const value of ["Racing Maze", "Astro Bro", "Game.2D+Client"]) assert.equal(isSafeMacExecutableName(value), true);
  for (const value of [".", "..", "../Game", "Contents/MacOS/Game", "Game\\Helper", " Game", "Game\tHelper", "Game\nHelper", "Game\u007fHelper", ""]) {
    assert.equal(isSafeMacExecutableName(value), false);
  }
});

test("Mac signing requires the plist-named main executable to be executable", async () => {
  const script = await readFile(path.resolve(releaseToolRoot, "../scripts/sign-notarize-macos.sh"), "utf8");
  assert.match(script, /! -f .*Contents\/MacOS\/\$\{EXECUTABLE\}.*\|\| ! -x .*Contents\/MacOS\/\$\{EXECUTABLE\}/);
});

test("Mac signing verifies the final archive after an extraction round trip", async () => {
  const script = await readFile(path.resolve(releaseToolRoot, "../scripts/sign-notarize-macos.sh"), "utf8");
  const archive = script.indexOf('ditto -c -k --sequesterRsrc --keepParent');
  const extract = script.indexOf('ditto -x -k "${MAC_ARCHIVE}"');
  const verify = script.indexOf('codesign --verify --deep --strict --verbose=4 "${ARCHIVED_APP}"');
  assert.ok(archive >= 0 && archive < extract && extract < verify);
  assert.match(script, /stapler validate -v "\$\{ARCHIVED_APP\}"/);
  assert.match(script, /spctl --assess --type execute --verbose=4 "\$\{ARCHIVED_APP\}"/);
});

test("configuration is strict", () => {
  assert.equal(validateConfig(config).slug, "astro-bro");
  assert.throws(() => validateConfig({ ...config, slug: "Astro Bro" }));
  assert.throws(() => validateConfig({ ...config, extra: true }));
});

test("critical Godot MIME types are explicit", () => {
  assert.equal(contentTypeFor("game.wasm"), "application/wasm");
  assert.equal(contentTypeFor("game.pck"), "application/octet-stream");
  assert.equal(contentTypeFor("index.html"), "text/html; charset=utf-8");
  assert.equal(contentTypeFor("music.mp3"), "audio/mpeg");
});

test("preset rewrite disables only release-time signing and notarization", () => {
  const source = `[preset.0]\nname="macOS"\nplatform="macOS"\n\n[preset.0.options]\ncodesign/codesign=1\ncodesign/identity="Local"\nnotarization/notarization=1\n\n[preset.1]\nname="Web"\nplatform="Web"\n`;
  const result = disablePresetSigning(source, "macOS");
  assert.match(result, /codesign\/codesign=0/);
  assert.match(result, /codesign\/identity=""/);
  assert.match(result, /notarization\/notarization=0/);
  assert.match(result, /name="Web"/);
});

test("Mac release versions are injected into both bundle version fields", () => {
  const source = `[preset.0]\nname="macOS"\nplatform="macOS"\n[preset.0.options]\napplication/short_version="0.1"\napplication/version="1"\n`;
  const result = patchMacReleaseVersion(source, "macOS", "v2.3.4");
  assert.match(result, /application\/short_version="2.3.4"/);
  assert.match(result, /application\/version="2.3.4"/);
  assert.throws(() => patchMacReleaseVersion(source, "macOS", "2.3.4"), /vMAJOR/);
});

test("temporary R2 credentials carry path scope and expire", () => {
  const creds = createScopedR2Credentials({
    accountId: "a".repeat(32), accessKeyId: "access", secretAccessKey: "secret", bucket: "games",
    prefixes: ["releases/astro-bro/v1.0.0/"], now: 100, ttlSeconds: 900
  });
  const jwt = Buffer.from(creds.sessionToken, "base64").toString().slice(4);
  const claims = JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString());
  assert.equal(claims.actions, undefined);
  assert.deepEqual(claims.paths.prefixPaths, ["releases/astro-bro/v1.0.0/"]);
  assert.equal(claims.exp, 1000);
});

test("manifest only advertises successful targets", () => {
  const manifest = buildManifest({ slug: "astro-bro", version: "v1.0.0", sourceCommit: "a".repeat(40), publishedAt: "2026-01-01T00:00:00Z", webEntry: "index.html", files: [] });
  assert.deepEqual(manifest.web, { entry: "index.html" });
  assert.equal(manifest.mac, undefined);
});

test("authoritative immutable manifests require strict source, target, and file schemas", () => {
  const manifest = releaseManifest();
  assert.equal(validateImmutableManifest(manifest, {
    slug: manifest.slug,
    version: manifest.version,
    sourceCommit,
    webEntry: "index.html",
    macKey: manifest.mac.key
  }), manifest);
  assert.throws(() => validateImmutableManifest({ ...manifest, extra: true }, { slug: manifest.slug }), /unknown key extra/);
  assert.throws(() => validateImmutableManifest(manifest, { slug: manifest.slug, sourceCommit: "d".repeat(40) }), /sourceCommit does not match/);
  assert.throws(() => validateImmutableManifest(manifest, { slug: manifest.slug, webEntry: null }), /unexpected Web target/);

  const missingMac = structuredClone(manifest);
  missingMac.files.pop();
  assert.throws(() => validateImmutableManifest(missingMac, { slug: manifest.slug }), /advertised Mac archive/);
  const wrongType = structuredClone(manifest);
  wrongType.files[0].contentType = "application/octet-stream";
  assert.throws(() => validateImmutableManifest(wrongType, { slug: manifest.slug }), /content type is invalid/);
});

test("version indexes are strict and reject duplicate versions", () => {
  const manifest = releaseManifest();
  const entry = versionEntry(manifest);
  assert.doesNotThrow(() => validateVersionIndex({ slug: manifest.slug, versions: [entry] }, manifest.slug));
  assert.throws(() => validateVersionIndex({ slug: manifest.slug, versions: [entry, entry] }, manifest.slug), /duplicate v1.2.3/);
});

test("release documents are bounded before any R2 write", () => {
  assert.doesNotThrow(() => assertReleaseManifestSize(releaseManifest()));
  const oversizedManifest = releaseManifest();
  oversizedManifest.files = Array.from({ length: 300 }, (_, index) => ({
    key: `releases/astro-bro/v1.2.3/web/assets/file-${index}.pck`,
    size: 1,
    sha256: "d".repeat(64),
    contentType: "application/octet-stream"
  }));
  assert.throws(() => assertReleaseManifestSize(oversizedManifest), /32768-byte publication limit/);

  const oversizedIndex = {
    slug: "astro-bro",
    versions: Array.from({ length: 8_000 }, (_, index) => ({
      version: `v1.0.${index}`,
      sourceCommit,
      publishedAt,
      manifest: `manifests/astro-bro/versions/v1.0.${index}.json`
    }))
  };
  assert.throws(() => assertVersionIndexSize(oversizedIndex), /1048576-byte publication limit/);
});

test("public release probes fail closed if CDN caching can preserve a 404", () => {
  assert.doesNotThrow(() => assertUncachedOriginResponse({
    key: "releases/game/probe.html", status: 404, cacheStatus: "DYNAMIC", age: null
  }));
  assert.doesNotThrow(() => assertUncachedOriginResponse({
    key: "releases/game/probe.html", status: 404, cacheStatus: "BYPASS", age: null
  }));
  assert.throws(() => assertUncachedOriginResponse({
    key: "releases/game/probe.html", status: 404, cacheStatus: "MISS", age: null
  }), /caching is enabled or ambiguous/);
  assert.throws(() => assertUncachedOriginResponse({
    key: "releases/game/probe.html", status: 404, cacheStatus: "DYNAMIC", age: "1"
  }), /caching is enabled or ambiguous/);

  const probes = buildCacheProbeKeys([
    { key: "releases/game/v1.0.0/web/index.html" },
    { key: "releases/game/v1.0.0/web/game.js" },
    { key: "releases/game/v1.0.0/web/engine/game.js" },
    { key: "releases/game/v1.0.0/web/game.wasm" },
    { key: "downloads/game/v1.0.0/game.zip" }
  ], "v1.0.0", sourceCommit);
  assert.equal(probes.length, 5);
  assert.ok(probes.some((key) => key.endsWith(".js")));
  assert.ok(probes.some((key) => key.endsWith(".wasm")));
  assert.ok(probes.some((key) => key.endsWith(".zip")));
  assert.throws(() => buildCacheProbeKeys([
    { key: "releases/game/v1.0.0/web/.gregeland-cache-probe-collision.js" }
  ], "v1.0.0", sourceCommit), /reserved cache-probe namespace/);
});

test("public-origin checks identify the release publisher", () => {
  assert.match(PUBLIC_ORIGIN_USER_AGENT, /^Gregeland-Games-Release-Publisher\/1\.0 /);
  assert.equal(publicOriginResponseDiagnostics(new Headers({
    "cf-ray": "abc-SEA",
    "cf-mitigated": "challenge",
    "authorization": "must-not-appear"
  })), "cf-ray=abc-SEA, cf-mitigated=challenge");
  const response = parseOriginProbeResponse(new Response(null, {
    status: 204,
    headers: {
      "x-gregeland-origin-status": "404",
      "x-gregeland-origin-cf-cache-status": "BYPASS",
      "x-gregeland-origin-age": "1"
    }
  }), "downloads/game/v1.0.0/probe.zip");
  assert.equal(response.status, 404);
  assert.equal(response.headers.get("cf-cache-status"), "BYPASS");
  assert.equal(response.headers.get("age"), "1");
});

test("ordinary releases must advance beyond every stable or indexed version", () => {
  const stable = releaseManifest("v1.5.0");
  const indexedNewer = releaseManifest("v2.0.0");
  const common = {
    allowResume: false,
    slug: stable.slug,
    sourceCommit,
    expectedArtifactKeys: [],
    existingArtifactKeys: new Set(),
    macKey: undefined,
    immutableManifest: null,
    index: { slug: stable.slug, versions: [versionEntry(indexedNewer)] },
    stable
  };
  assert.throws(() => decideReleasePreflight({ ...common, version: "v1.6.0" }), /newer than published version v2.0.0/);
  assert.deepEqual(decideReleasePreflight({ ...common, version: "v2.0.1" }), {
    artifactSource: "local", updateIndex: true, updateStable: true
  });
});

test("resume never moves stable backward", () => {
  const stable = releaseManifest("v2.0.0");
  assert.throws(() => decideReleasePreflight({
    allowResume: true,
    slug: stable.slug,
    version: "v1.9.0",
    sourceCommit,
    expectedArtifactKeys: [],
    existingArtifactKeys: new Set(),
    macKey: undefined,
    immutableManifest: null,
    index: { slug: stable.slug, versions: [] },
    stable
  }), /resume cannot move stable backward from v2.0.0 to v1.9.0/);
});

test("resume can finish a newer partial Web release while the prior version is stable", () => {
  const stable = releaseManifest("v1.0.0");
  const webKey = "releases/astro-bro/v2.0.0/web/index.html";
  assert.deepEqual(decideReleasePreflight({
    allowResume: true,
    slug: stable.slug,
    version: "v2.0.0",
    sourceCommit,
    expectedArtifactKeys: [webKey],
    existingArtifactKeys: new Set([webKey]),
    macKey: undefined,
    immutableManifest: null,
    index: { slug: stable.slug, versions: [versionEntry(stable)] },
    stable
  }), { artifactSource: "local", updateIndex: true, updateStable: true });
});

test("resume can promote an authoritative newer release after its index write", () => {
  const stable = releaseManifest("v1.0.0");
  const manifest = releaseManifest("v2.0.0");
  assert.deepEqual(decideReleasePreflight({
    allowResume: true,
    slug: manifest.slug,
    version: manifest.version,
    sourceCommit,
    expectedArtifactKeys: manifest.files.map((file) => file.key),
    existingArtifactKeys: new Set(manifest.files.map((file) => file.key)),
    macKey: manifest.mac.key,
    immutableManifest: manifest,
    index: { slug: manifest.slug, versions: [versionEntry(manifest), versionEntry(stable)] },
    stable
  }), { artifactSource: "manifest", updateIndex: false, updateStable: true });
});

test("resume uses the immutable manifest instead of rebuilt signed bytes", () => {
  const manifest = releaseManifest();
  const result = decideReleasePreflight({
    allowResume: true,
    slug: manifest.slug,
    version: manifest.version,
    sourceCommit,
    expectedArtifactKeys: manifest.files.map((file) => file.key),
    existingArtifactKeys: new Set(manifest.files.map((file) => file.key)),
    macKey: manifest.mac.key,
    immutableManifest: manifest,
    index: { slug: manifest.slug, versions: [versionEntry(manifest)] },
    stable: structuredClone(manifest)
  });
  assert.deepEqual(result, { artifactSource: "manifest", updateIndex: false, updateStable: false });
});

test("resume fails clearly for an orphaned non-reproducible Mac archive", () => {
  const manifest = releaseManifest();
  assert.throws(() => decideReleasePreflight({
    allowResume: true,
    slug: manifest.slug,
    version: manifest.version,
    sourceCommit,
    expectedArtifactKeys: manifest.files.map((file) => file.key),
    existingArtifactKeys: new Set([manifest.mac.key]),
    macKey: manifest.mac.key,
    immutableManifest: null,
    index: { slug: manifest.slug, versions: [] },
    stable: null
  }), /original notarized artifact.*manual recovery/);
});

test("normal publication rejects existing immutable keys while resume fills only gaps", () => {
  const keys = ["releases/game/v1.0.0/web/index.html", "manifests/game/versions/v1.0.0.json"];
  const existing = new Set([keys[0]]);
  assert.throws(() => planImmutableUploads(keys, existing, false), /already exists/);
  assert.deepEqual(planImmutableUploads(keys, existing, true), { existing: [keys[0]], missing: [keys[1]] });
});

test("staged sanitation removes godot_ai without removing runtime plugins", () => {
  const source = `[autoload]\n_mcp_game_helper="*res://addons/godot_ai/runtime/game_helper.gd"\nGame="*res://game.gd"\n[editor_plugins]\nenabled=PackedStringArray("res://addons/beehave/plugin.cfg", "res://addons/godot_ai/plugin.cfg")\n`;
  const result = sanitizeStagedProjectText(source);
  assert.doesNotMatch(result, /godot_ai/);
  assert.match(result, /Game="\*res:\/\/game.gd"/);
  assert.match(result, /beehave/);
});

test("target validation permits native rendering on a fresh Mac stage", () => {
  const project = `config/features=PackedStringArray("4.6", "Forward Plus")\n`;
  const presets = `[preset.0]\nname="Web"\nplatform="Web"\n[preset.0.options]\nvariant/thread_support=false\n[preset.1]\nname="macOS"\nplatform="macOS"\n[preset.1.options]\napplication/bundle_identifier="com.gregeland.game"\n`;
  assert.doesNotThrow(() => assertProjectReleaseReady(config, project, presets, "mac"));
  assert.throws(() => assertProjectReleaseReady(config, project, presets, "web"), /Compatibility/);
});
