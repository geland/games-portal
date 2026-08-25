#!/usr/bin/env bash
set -euo pipefail

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
  --exclude '/addons/godot_ai/' \
  --exclude '.DS_Store' \
  "${SOURCE_PROJECT}/" "${STAGE_PROJECT}/"

node .github/release-tools/sanitize-stage.mjs "${STAGE_PROJECT}"
if [[ -f "${SOURCE_PROJECT}/scripts/ci-sanitize-stage.sh" ]]; then
  RELEASE_TARGET="${RELEASE_TARGET}" bash "${SOURCE_PROJECT}/scripts/ci-sanitize-stage.sh" "${STAGE_PROJECT}" "${RELEASE_TARGET}"
fi

echo "PROJECT_PATH=${STAGE_PROJECT}" >> "${GITHUB_ENV}"
echo "STAGED_PROJECT_PATH=${STAGE_PROJECT}" >> "${GITHUB_ENV}"
echo "RELEASE_TARGET=${RELEASE_TARGET}" >> "${GITHUB_ENV}"
