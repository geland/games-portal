import { writeFile } from "node:fs/promises";

const deploymentId = process.env.GITHUB_SHA;

if (!deploymentId || !/^[0-9a-f]{40}$/.test(deploymentId)) {
  throw new Error("GITHUB_SHA must be a full lowercase commit SHA.");
}

const markerUrl = new URL("../public/deploy-id.txt", import.meta.url);
await writeFile(markerUrl, `${deploymentId}\n`, "utf8");

console.log(`Stamped static assets for deployment ${deploymentId}.`);
