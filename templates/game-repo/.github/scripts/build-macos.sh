#!/usr/bin/env bash
set -euo pipefail

: "${GODOT_BIN:?GODOT_BIN is required}"
: "${PROJECT_PATH:?PROJECT_PATH is required}"
: "${MAC_PRESET:?MAC_PRESET is required}"
: "${MAC_BUNDLE_NAME:?MAC_BUNDLE_NAME is required}"
: "${MAC_BUILD_DIR:?MAC_BUILD_DIR is required}"

readonly PRESET_FILE="${PROJECT_PATH}/export_presets.cfg"
readonly PRESET_BACKUP="${RUNNER_TEMP}/gregeland-export-presets-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}.cfg"
cp "${PRESET_FILE}" "${PRESET_BACKUP}"
restore_preset() {
  cp "${PRESET_BACKUP}" "${PRESET_FILE}"
}
trap restore_preset EXIT

node .github/release-tools/config.mjs disable-signing
mkdir -p "${MAC_BUILD_DIR}"
"${GODOT_BIN}" --headless --path "${PROJECT_PATH}" --export-release "${MAC_PRESET}" "${MAC_BUILD_DIR}/${MAC_BUNDLE_NAME}.app"

if [[ ! -d "${MAC_BUILD_DIR}/${MAC_BUNDLE_NAME}.app" ]]; then
  echo "Godot did not create the expected macOS app bundle" >&2
  exit 1
fi
