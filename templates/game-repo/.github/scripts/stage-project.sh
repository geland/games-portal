#!/usr/bin/env bash
set -euo pipefail

readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
readonly RELEASE_TOOL_ROOT="${RELEASE_TOOL_ROOT:-${SCRIPT_DIR}/../release-tools}"

: "${PROJECT_PATH:?PROJECT_PATH is required}"
: "${RUNNER_TEMP:?RUNNER_TEMP is required}"
: "${RELEASE_TARGET:?RELEASE_TARGET is required}"
if [[ "${RELEASE_TARGET}" != "web" && "${RELEASE_TARGET}" != "mac" ]]; then
  echo "RELEASE_TARGET must be web or mac" >&2
  exit 1
fi

readonly SOURCE_PROJECT="$(cd "${PROJECT_PATH}" && pwd -P)"
readonly STAGE_PROJECT="${RUNNER_TEMP}/gregeland-stage-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}/${RELEASE_TARGET}/project"
mkdir -p "${STAGE_PROJECT}"
rsync -a \
  --exclude '/.git/' \
  --exclude '/.godot/' \
  --exclude '/.github/release-tools/node_modules/' \
  --exclude '/addons/godot_ai/' \
  --exclude '.DS_Store' \
  "${SOURCE_PROJECT}/" "${STAGE_PROJECT}/"

node "${RELEASE_TOOL_ROOT}/sanitize-stage.mjs" "${STAGE_PROJECT}"
if [[ -f "${SOURCE_PROJECT}/scripts/ci-sanitize-stage.sh" ]]; then
  (
    cd "${STAGE_PROJECT}"
    RELEASE_TARGET="${RELEASE_TARGET}" bash "./scripts/ci-sanitize-stage.sh" "${STAGE_PROJECT}" "${RELEASE_TARGET}"
  )
fi

echo "PROJECT_PATH=${STAGE_PROJECT}" >> "${GITHUB_ENV}"
echo "STAGED_PROJECT_PATH=${STAGE_PROJECT}" >> "${GITHUB_ENV}"
echo "RELEASE_TARGET=${RELEASE_TARGET}" >> "${GITHUB_ENV}"
