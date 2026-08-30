import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { resolvePrivateRelease, validatePrivateRegistry, writeEffectiveConfig } from "../private-source.mjs";

const toolRoot = path.dirname(fileURLToPath(import.meta.url));
const registryFile = path.resolve(toolRoot, "../../registry.json");
const sha = "a".repeat(40);

test("private releases resolve only fixed repositories and profiles", async () => {
  const release = await resolvePrivateRelease({
    registryFile,
    gameId: "butts",
    sourceSha: sha,
    version: "v1.2.3",
    profile: "web",
    buildRunId: "32920663099",
    resume: "false"
  });
  assert.equal(release.repository, "geland/butts");
  assert.equal(release.webEnabled, true);
  assert.equal(release.macEnabled, false);
  assert.equal(release.candidateMacEnabled, true);
  assert.equal(release.webArtifactName, "butts-v1.2.3-web-gpkg");
  assert.equal(release.webPackageFilename, "butts-v1.2.3-web.gpkg");
  assert.deepEqual(release.candidateArtifactNames, ["butts-v1.2.3-web-gpkg", "butts-v1.2.3-mac-gpkg"]);
});

test("Commanders resolves exact Web and Mac candidate identities", async () => {
  const release = await resolvePrivateRelease({
    registryFile,
    gameId: "commanders",
    sourceSha: sha,
    version: "v1.0.0",
    profile: "web+mac",
    buildRunId: "32920663100",
    resume: "false"
  });
  assert.equal(release.repository, "geland/commanders");
  assert.equal(release.sourceWorkflow, ".github/workflows/release.yml");
  assert.equal(release.sourceWorkflowName, "Build game release candidate");
  assert.equal(release.bundleIdentifier, "com.gregeland.commanders");
  assert.equal(release.webArtifactName, "commanders-v1.0.0-web-gpkg");
  assert.equal(release.webPackageFilename, "commanders-v1.0.0-web.gpkg");
  assert.equal(release.macArtifactName, "commanders-v1.0.0-mac-gpkg");
  assert.equal(release.macPackageFilename, "commanders-v1.0.0-mac.gpkg");
  assert.deepEqual(release.candidateArtifactNames, [
    "commanders-v1.0.0-web-gpkg",
    "commanders-v1.0.0-mac-gpkg"
  ]);
});

test("Motion targets resolve one package from their shared exact-tag run", async () => {
  const release = await resolvePrivateRelease({
    registryFile,
    gameId: "motion-tracker",
    sourceSha: sha,
    version: "v2.3.4",
    profile: "web",
    buildRunId: "32922696256",
    resume: "false"
  });
  assert.equal(release.repository, "geland/motion-games");
  assert.equal(release.sourceWorkflow, ".github/workflows/static-release-candidates.yml");
  assert.equal(release.sourceWorkflowName, "Static candidates from v2.3.4 (push)");
  assert.equal(release.webArtifactName, `motion-tracker-v2.3.4-${sha.slice(0, 12)}-web`);
  assert.equal(release.webPackageFilename, `${release.webArtifactName}.gpkg`);
  assert.deepEqual(release.candidateArtifactNames, [
    `web-dodge-v2.3.4-${sha.slice(0, 12)}-web`,
    `motion-tracker-v2.3.4-${sha.slice(0, 12)}-web`
  ]);
});

test("native Motion targets resolve one Mac package from their shared exact-tag run", async () => {
  const sourceSha = "56947de9ea16e9e4884295488101e9bb11f0e08e";
  const release = await resolvePrivateRelease({
    registryFile,
    gameId: "balloon",
    sourceSha,
    version: "v1.0.0",
    profile: "mac",
    buildRunId: "32930000000",
    resume: "false"
  });
  assert.equal(release.repository, "geland/motion-games");
  assert.equal(release.sourceWorkflow, ".github/workflows/native-release-candidates.yml");
  assert.equal(release.sourceWorkflowName, "Native candidates from v1.0.0 (push)");
  assert.equal(release.webEnabled, false);
  assert.equal(release.macEnabled, true);
  assert.equal(release.candidateWebEnabled, false);
  assert.equal(release.candidateMacEnabled, true);
  assert.equal(release.macBundleName, "Motion Balloon");
  assert.equal(release.bundleIdentifier, "com.gregeland.motionballoon");
  assert.equal(release.macArtifactName, "balloon-v1.0.0-56947de9ea16-mac");
  assert.equal(release.macPackageFilename, "balloon-v1.0.0-56947de9ea16-mac.gpkg");
  assert.deepEqual(release.candidateArtifactNames, [
    "balloon-v1.0.0-56947de9ea16-mac",
    "labyrinth-v1.0.0-56947de9ea16-mac"
  ]);

  const labyrinth = await resolvePrivateRelease({
    registryFile,
    gameId: "labyrinth",
    sourceSha,
    version: "v1.0.0",
    profile: "mac",
    buildRunId: "32930000000",
    resume: "false"
  });
  assert.equal(labyrinth.macBundleName, "Motion Labyrinth");
  assert.equal(labyrinth.bundleIdentifier, "com.gregeland.motionlabyrinth");
  assert.equal(labyrinth.macArtifactName, "labyrinth-v1.0.0-56947de9ea16-mac");
  assert.deepEqual(labyrinth.candidateArtifactNames, release.candidateArtifactNames);
});

test("private release identities are strict", async () => {
  const base = {
    registryFile,
    gameId: "blend-in",
    sourceSha: sha,
    version: "v1.0.0",
    profile: "mac",
    buildRunId: "1",
    resume: "false"
  };
  await assert.rejects(resolvePrivateRelease({ ...base, sourceSha: "A".repeat(40) }), /source SHA/);
  await assert.rejects(resolvePrivateRelease({ ...base, version: "1.0.0" }), /version/);
  await assert.rejects(resolvePrivateRelease({ ...base, buildRunId: "0" }), /run ID/);
  await assert.rejects(resolvePrivateRelease({ ...base, profile: "web" }), /profile/);
  await assert.rejects(resolvePrivateRelease({ ...base, resume: "yes" }), /resume/);
});

test("private registry cannot redirect an approved game", async () => {
  const registry = JSON.parse(await readFile(registryFile, "utf8"));
  registry.games.butts.repository = "attacker/example";
  assert.throws(() => validatePrivateRegistry(registry), /not approved/);
});

test("effective configuration freezes the selected target profile", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "gregeland-private-config-"));
  const outputFile = path.join(directory, "effective.json");
  try {
    await writeEffectiveConfig({
      registryFile,
      gameId: "butts",
      sourceSha: sha,
      version: "v9.8.7",
      profile: "web",
      buildRunId: "42",
      resume: "false",
      outputFile
    });
    const config = JSON.parse(await readFile(outputFile, "utf8"));
    assert.equal(config.web.enabled, true);
    assert.equal(config.mac.enabled, false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
