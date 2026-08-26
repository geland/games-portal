#!/usr/bin/env bash
set -euo pipefail

readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
readonly RELEASE_TOOL_ROOT="${RELEASE_TOOL_ROOT:-${SCRIPT_DIR}/../release-tools}"

: "${GODOT_BIN:?GODOT_BIN is required}"
: "${PROJECT_PATH:?PROJECT_PATH is required}"
: "${RELEASE_TARGET:?RELEASE_TARGET is required}"

node "${RELEASE_TOOL_ROOT}/config.mjs" check-project
"${GODOT_BIN}" --headless --editor --path "${PROJECT_PATH}" --quit

if [[ -f "${PROJECT_PATH}/scripts/ci-test.sh" ]]; then
  (
    cd "${PROJECT_PATH}"
    GODOT_BIN="${GODOT_BIN}" bash "./scripts/ci-test.sh"
  )
fi

readonly SOURCE_GIT_ROOT="${SOURCE_GIT_ROOT:-.}"
SOURCE_STATUS="$(git -C "${SOURCE_GIT_ROOT}" status --porcelain=v1 --untracked-files=all)"
if [[ -n "${SOURCE_STATUS}" ]]; then
  printf '%s\n' "${SOURCE_STATUS}" >&2
  echo "Source provenance changed during validation; release source must remain fully clean" >&2
  exit 1
fi
