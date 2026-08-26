#!/usr/bin/env bash
set -euo pipefail

readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
readonly RELEASE_TOOL_ROOT="${RELEASE_TOOL_ROOT:-${SCRIPT_DIR}/../release-tools}"

: "${GODOT_BIN:?GODOT_BIN is required}"
: "${PROJECT_PATH:?PROJECT_PATH is required}"
: "${WEB_PRESET:?WEB_PRESET is required}"
: "${WEB_ENTRY:?WEB_ENTRY is required}"
: "${WEB_BUILD_DIR:?WEB_BUILD_DIR is required}"

mkdir -p "${WEB_BUILD_DIR}"
"${GODOT_BIN}" --headless --path "${PROJECT_PATH}" --export-release "${WEB_PRESET}" "${WEB_BUILD_DIR}/${WEB_ENTRY}"
node "${RELEASE_TOOL_ROOT}/verify-web.mjs" "${WEB_BUILD_DIR}" "${WEB_ENTRY}"
