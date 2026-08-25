#!/usr/bin/env bash
set -euo pipefail

: "${GODOT_BIN:?GODOT_BIN is required}"
: "${PROJECT_PATH:?PROJECT_PATH is required}"
: "${RELEASE_TARGET:?RELEASE_TARGET is required}"

node .github/release-tools/config.mjs check-project
"${GODOT_BIN}" --headless --editor --path "${PROJECT_PATH}" --quit

if [[ -f "${PROJECT_PATH}/scripts/ci-test.sh" ]]; then
  GODOT_BIN="${GODOT_BIN}" bash "${PROJECT_PATH}/scripts/ci-test.sh"
fi

if ! git diff --exit-code -- .; then
  echo "Godot validation changed tracked files; commit migrations and keep generated caches ignored" >&2
  exit 1
fi
