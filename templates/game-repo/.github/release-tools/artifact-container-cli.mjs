#!/usr/bin/env node
import process from "node:process";
import { packArtifact, unpackArtifact } from "./artifact-container.mjs";

const command = process.argv[2];
const kind = required("ARTIFACT_KIND");
const identity = {
  kind,
  slug: required("GAME_SLUG"),
  version: required("RELEASE_VERSION"),
  sourceCommit: required("SOURCE_COMMIT"),
  bundleName: kind === "mac" ? required("MAC_BUNDLE_NAME") : null,
  entry: kind === "web" ? required("WEB_ENTRY") : null
};

if (command === "pack") {
  const result = await packArtifact({
    ...identity,
    input: required("ARTIFACT_INPUT"),
    output: required("ARTIFACT_PACKAGE")
  });
  console.log(JSON.stringify({ message: "artifact packaged", kind: result.kind, files: result.files.length, bytes: result.totalBytes }));
} else if (command === "unpack") {
  const result = await unpackArtifact({
    packageFile: required("ARTIFACT_PACKAGE"),
    output: required("ARTIFACT_OUTPUT"),
    expected: identity
  });
  console.log(JSON.stringify({ message: "artifact verified and unpacked", kind: result.kind, files: result.files.length, bytes: result.totalBytes }));
} else {
  throw new Error("usage: artifact-container-cli.mjs pack|unpack");
}

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}
