#!/usr/bin/env bash
set -euo pipefail

: "${GODOT_BIN:?GODOT_BIN is required}"
: "${PROJECT_PATH:?PROJECT_PATH is required}"
: "${WEB_PRESET:?WEB_PRESET is required}"
: "${WEB_ENTRY:?WEB_ENTRY is required}"
: "${WEB_BUILD_DIR:?WEB_BUILD_DIR is required}"

mkdir -p "${WEB_BUILD_DIR}"
"${GODOT_BIN}" --headless --path "${PROJECT_PATH}" --export-release "${WEB_PRESET}" "${WEB_BUILD_DIR}/${WEB_ENTRY}"
node .github/release-tools/verify-web.mjs "${WEB_BUILD_DIR}" "${WEB_ENTRY}"
