#!/usr/bin/env node
import { appendFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

export function sourceCommitDate(value, expectedSha) {
  if (!/^[0-9a-f]{40}$/.test(expectedSha) || value?.sha !== expectedSha) {
    throw new Error("GitHub commit does not match the approved source SHA");
  }
  const date = value?.committer?.date;
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(date)
    || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString() !== date.replace("Z", ".000Z")) {
    throw new Error("GitHub source commit date is invalid");
  }
  return new Date(date).toISOString();
}

export async function fetchSourceCommitDate(repository, sha, token, fetchImpl = fetch) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository) || !/^[0-9a-f]{40}$/.test(sha)) {
    throw new Error("Invalid exact source commit identity");
  }
  if (!token) throw new Error("SOURCE_READ_TOKEN is required");
  const response = await fetchImpl(`https://api.github.com/repos/${repository}/git/commits/${sha}`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2026-03-10",
      "User-Agent": "geland-games-release-metadata"
    },
    redirect: "error",
    signal: AbortSignal.timeout(30_000)
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`Source commit metadata request failed with HTTP ${response.status}`);
  }
  // The Git database endpoint omits file patches. Still bound the response size.
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 2 * 1024 * 1024) throw new Error("Source commit metadata is too large");
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  return sourceCommitDate(JSON.parse(Buffer.concat(chunks).toString("utf8")), sha);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!process.env.GITHUB_OUTPUT) throw new Error("GITHUB_OUTPUT is required");
  const date = await fetchSourceCommitDate(
    process.env.SOURCE_REPOSITORY, process.env.SOURCE_COMMIT, process.env.SOURCE_READ_TOKEN
  );
  await appendFile(process.env.GITHUB_OUTPUT, `source_committed_at=${date}\n`);
}
