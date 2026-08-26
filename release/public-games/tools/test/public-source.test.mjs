import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { preparePublicStage, PUBLIC_REPOSITORIES, resolvePublicRelease, validatePublicRegistry } from "../public-source.mjs";

const portalRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const registryFile = path.join(portalRoot, "release/public-games/registry.json");

test("public releases use the exact three-repository allowlist", async () => {
  assert.deepEqual([...PUBLIC_REPOSITORIES], [
    ["astro-bro", "judaheland-dev/astrobro"],
    ["tower-defense", "judaheland-dev/tower-defense"],
    ["racing-maze", "judaheland-dev/race-maze"]
  ]);
  const release = await resolvePublicRelease({
    registryFile,
    gameId: "astro-bro",
    sourceSha: "a".repeat(40),
    version: "v1.2.3",
    resume: "false"
  });
  assert.equal(release.repository, "judaheland-dev/astrobro");
  assert.equal(release.bundleIdentifier, "com.gregeland.astrobro");
  assert.equal(release.webEnabled, true);
  await assert.rejects(resolvePublicRelease({
    registryFile, gameId: "other", sourceSha: "a".repeat(40), version: "v1.2.3", resume: "false"
  }), /allowlist/);
});

test("public release identity requires exact SHA, semantic version, and resume flag", async () => {
  const base = { registryFile, gameId: "astro-bro", sourceSha: "a".repeat(40), version: "v1.2.3", resume: "false" };
  await assert.rejects(resolvePublicRelease({ ...base, sourceSha: "a".repeat(39) }), /40 lowercase/);
  await assert.rejects(resolvePublicRelease({ ...base, sourceSha: "A".repeat(40) }), /40 lowercase/);
  await assert.rejects(resolvePublicRelease({ ...base, version: "v1.2.3-beta" }), /vMAJOR/);
  await assert.rejects(resolvePublicRelease({ ...base, resume: "yes" }), /true or false/);
});

test("registry cannot redirect an approved id to another repository or extra game", () => {
  const games = Object.fromEntries([...PUBLIC_REPOSITORIES].map(([id, repository]) => [id, {
    repository,
    config: `release/public-games/configs/${id}.json`,
    bundleIdentifier: `com.gregeland.${id.replaceAll("-", "")}`
  }]));
  assert.throws(() => validatePublicRegistry({ schemaVersion: 1, games: {
    ...games,
    "astro-bro": { ...games["astro-bro"], repository: "attacker/game" }
  } }), /not approved/);
  assert.throws(() => validatePublicRegistry({ schemaVersion: 1, games: { ...games, extra: games["astro-bro"] } }), /unknown/);
});

test("trusted Web staging replaces public presets and forces Compatibility", async () => {
  const project = await mkdtemp(path.join(os.tmpdir(), "gregeland-web-stage-"));
  await writeFile(path.join(project, "project.godot"), `[application]\nconfig/name="Astro"\n\n[rendering]\nrenderer/rendering_method="mobile"\n`);
  await writeFile(path.join(project, "export_presets.cfg"), `[preset.0]\nname="Untrusted Web"\nplatform="Web"\n[preset.0.options]\nvariant/thread_support=true\n`);
  await preparePublicStage({ registryFile, gameId: "astro-bro", target: "web", projectDirectory: project, version: "v1.0.0" });
  const projectText = await readFile(path.join(project, "project.godot"), "utf8");
  const presets = await readFile(path.join(project, "export_presets.cfg"), "utf8");
  assert.match(projectText, /renderer\/rendering_method="gl_compatibility"/);
  assert.match(projectText, /renderer\/rendering_method\.mobile="gl_compatibility"/);
  assert.match(presets, /name="Gregeland Web"/);
  assert.match(presets, /variant\/thread_support=false/);
  assert.doesNotMatch(presets, /Untrusted Web|thread_support=true/);
});

test("trusted Mac staging patches bundle and version metadata only in its preset", async () => {
  const project = await mkdtemp(path.join(os.tmpdir(), "gregeland-mac-stage-"));
  await mkdir(path.join(project, "assets"));
  await writeFile(path.join(project, "project.godot"), `[application]\nconfig/name="Astro"\n`);
  await writeFile(path.join(project, "export_presets.cfg"), `[preset.0]\nname="macOS"\nplatform="macOS"\n[preset.0.options]\napplication/bundle_identifier="com.local.astrobro"\napplication/short_version=""\napplication/version=""\n`);
  await preparePublicStage({ registryFile, gameId: "astro-bro", target: "mac", projectDirectory: project, version: "v2.3.4" });
  const presets = await readFile(path.join(project, "export_presets.cfg"), "utf8");
  assert.match(presets, /application\/bundle_identifier="com.gregeland.astrobro"/);
  assert.match(presets, /application\/short_version="2.3.4"/);
  assert.match(presets, /application\/version="2.3.4"/);
  assert.doesNotMatch(presets, /com\.local/);
});
