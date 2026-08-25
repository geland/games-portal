#!/usr/bin/env bash
set -euo pipefail

readonly GODOT_VERSION="4.6.2"
readonly GODOT_TAG="4.6.2-stable"
readonly RELEASE_BASE="https://github.com/godotengine/godot-builds/releases/download/${GODOT_TAG}"
readonly TEMPLATE_NAME="Godot_v4.6.2-stable_export_templates.tpz"
readonly TEMPLATE_SHA256="942366dc4e27e7686a99da4d3cfb1b8ae8d3eb9444f6d8217eef16245b599ef2"

case "${RUNNER_OS:-}" in
  Linux)
    readonly EDITOR_NAME="Godot_v4.6.2-stable_linux.x86_64.zip"
    readonly EDITOR_SHA256="30e6b6d141f0cd5bebd629ad1d0ef1324e60091bb20662d026b402ba58c59937"
    readonly TEMPLATE_ROOT="${XDG_DATA_HOME:-${HOME}/.local/share}/godot/export_templates/4.6.2.stable"
    ;;
  macOS)
    readonly EDITOR_NAME="Godot_v4.6.2-stable_macos.universal.zip"
    readonly EDITOR_SHA256="666b2a64e4b5c59db0e4974605b888eb72eb7d4e60e870d2be6cc19727b50807"
    readonly TEMPLATE_ROOT="${HOME}/Library/Application Support/Godot/export_templates/4.6.2.stable"
    ;;
  *)
    echo "Unsupported runner OS: ${RUNNER_OS:-unset}" >&2
    exit 1
    ;;
esac

readonly INSTALL_ROOT="${RUNNER_TEMP}/gregeland-godot-${GODOT_VERSION}"
readonly EDITOR_ARCHIVE="${INSTALL_ROOT}/${EDITOR_NAME}"
readonly TEMPLATE_ARCHIVE="${INSTALL_ROOT}/${TEMPLATE_NAME}"
mkdir -p "${INSTALL_ROOT}" "${TEMPLATE_ROOT}"

curl --fail --silent --show-error --location --retry 4 --retry-all-errors \
  "${RELEASE_BASE}/${EDITOR_NAME}" --output "${EDITOR_ARCHIVE}"
curl --fail --silent --show-error --location --retry 4 --retry-all-errors \
  "${RELEASE_BASE}/${TEMPLATE_NAME}" --output "${TEMPLATE_ARCHIVE}"

verify_sha256() {
  local expected="$1"
  local filename="$2"
  local actual
  actual="$(shasum -a 256 "${filename}" | awk '{print $1}')"
  if [[ "${actual}" != "${expected}" ]]; then
    echo "SHA-256 mismatch for ${filename}" >&2
    exit 1
  fi
}

verify_sha256 "${EDITOR_SHA256}" "${EDITOR_ARCHIVE}"
verify_sha256 "${TEMPLATE_SHA256}" "${TEMPLATE_ARCHIVE}"

unzip -q "${EDITOR_ARCHIVE}" -d "${INSTALL_ROOT}/editor"
unzip -q "${TEMPLATE_ARCHIVE}" -d "${INSTALL_ROOT}/templates"
cp -R "${INSTALL_ROOT}/templates/templates/." "${TEMPLATE_ROOT}/"

if [[ "${RUNNER_OS}" == "Linux" ]]; then
  GODOT_BIN="${INSTALL_ROOT}/editor/Godot_v4.6.2-stable_linux.x86_64"
  chmod +x "${GODOT_BIN}"
else
  GODOT_BIN="${INSTALL_ROOT}/editor/Godot.app/Contents/MacOS/Godot"
fi

if [[ "$("${GODOT_BIN}" --version)" != 4.6.2.stable.* ]]; then
  echo "Installed Godot did not report version 4.6.2 stable" >&2
  exit 1
fi

echo "GODOT_BIN=${GODOT_BIN}" >> "${GITHUB_ENV}"
