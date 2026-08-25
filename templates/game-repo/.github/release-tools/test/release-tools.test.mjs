import assert from "node:assert/strict";
import test from "node:test";
import { assertProjectReleaseReady, buildManifest, contentTypeFor, createScopedR2Credentials, disablePresetSigning, planImmutableUploads, sanitizeStagedProjectText, validateConfig, VERSION_RE } from "../lib.mjs";

const config = {
  slug: "astro-bro",
  projectPath: ".",
  godotVersion: "4.6.2",
  web: { enabled: true, preset: "Web", entry: "index.html" },
  mac: { enabled: true, preset: "macOS", bundleName: "Astro Bro", entitlements: null }
};

test("release versions are exact semantic tags", () => {
  assert.equal(VERSION_RE.test("v1.2.3"), true);
  for (const value of ["1.2.3", "v01.2.3", "v1.2", "v1.2.3-beta", "v1.2.3/evil"]) assert.equal(VERSION_RE.test(value), false);
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
});

test("preset rewrite disables only release-time signing and notarization", () => {
  const source = `[preset.0]\nname="macOS"\nplatform="macOS"\n\n[preset.0.options]\ncodesign/codesign=1\ncodesign/identity="Local"\nnotarization/notarization=1\n\n[preset.1]\nname="Web"\nplatform="Web"\n`;
  const result = disablePresetSigning(source, "macOS");
  assert.match(result, /codesign\/codesign=0/);
  assert.match(result, /codesign\/identity=""/);
  assert.match(result, /notarization\/notarization=0/);
  assert.match(result, /name="Web"/);
});

test("temporary R2 credentials carry path and operation scope", () => {
  const creds = createScopedR2Credentials({
    accountId: "a".repeat(32), accessKeyId: "access", secretAccessKey: "secret", bucket: "games",
    prefixes: ["releases/astro-bro/v1.0.0/"], now: 100, ttlSeconds: 900
  });
  const jwt = Buffer.from(creds.sessionToken, "base64").toString().slice(4);
  const claims = JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString());
  assert.deepEqual(claims.actions, ["HeadObject", "GetObject", "PutObject"]);
  assert.deepEqual(claims.paths.prefixPaths, ["releases/astro-bro/v1.0.0/"]);
  assert.equal(claims.exp, 1000);
});

test("manifest only advertises successful targets", () => {
  const manifest = buildManifest({ slug: "astro-bro", version: "v1.0.0", sourceCommit: "a".repeat(40), publishedAt: "2026-01-01T00:00:00Z", webEntry: "index.html", files: [] });
  assert.deepEqual(manifest.web, { entry: "index.html" });
  assert.equal(manifest.mac, undefined);
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
