#!/usr/bin/env bash
set -euo pipefail

: "${MAC_APP:?MAC_APP is required}"
: "${MAC_ARCHIVE:?MAC_ARCHIVE is required}"
: "${APPLE_DEVELOPER_ID_P12_BASE64:?APPLE_DEVELOPER_ID_P12_BASE64 is required}"
: "${APPLE_DEVELOPER_ID_P12_PASSWORD:?APPLE_DEVELOPER_ID_P12_PASSWORD is required}"
: "${APPLE_TEAM_ID:?APPLE_TEAM_ID is required}"
: "${APPLE_NOTARY_KEY_P8_BASE64:?APPLE_NOTARY_KEY_P8_BASE64 is required}"
: "${APPLE_NOTARY_KEY_ID:?APPLE_NOTARY_KEY_ID is required}"
: "${APPLE_NOTARY_ISSUER_ID:?APPLE_NOTARY_ISSUER_ID is required}"

if [[ ! "${APPLE_TEAM_ID}" =~ ^[A-Z0-9]{10}$ ]]; then
  echo "APPLE_TEAM_ID must be a 10-character team identifier" >&2
  exit 1
fi
if [[ ! -d "${MAC_APP}" ]]; then
  echo "Missing macOS app bundle: ${MAC_APP}" >&2
  exit 1
fi

readonly KEYCHAIN="${RUNNER_TEMP}/gregeland-signing-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}.keychain-db"
readonly P12_FILE="${RUNNER_TEMP}/gregeland-developer-id-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}.p12"
readonly P8_FILE="${RUNNER_TEMP}/AuthKey_${APPLE_NOTARY_KEY_ID}.p8"
readonly NOTARY_ZIP="${RUNNER_TEMP}/gregeland-notary-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}.zip"
readonly NOTARY_RESULT="${RUNNER_TEMP}/gregeland-notary-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}.json"
readonly KEYCHAIN_PASSWORD="$(openssl rand -hex 32)"
readonly DEFAULT_KEYCHAIN="$(security default-keychain -d user | tr -d '"')"

cleanup() {
  set +e
  security list-keychains -d user -s "${DEFAULT_KEYCHAIN}"
  security delete-keychain "${KEYCHAIN}"
  rm -f "${P12_FILE}" "${P8_FILE}" "${NOTARY_ZIP}" "${NOTARY_RESULT}"
}
trap cleanup EXIT

printf '%s' "${APPLE_DEVELOPER_ID_P12_BASE64}" | base64 -D > "${P12_FILE}"
printf '%s' "${APPLE_NOTARY_KEY_P8_BASE64}" | base64 -D > "${P8_FILE}"
chmod 600 "${P12_FILE}" "${P8_FILE}"
if ! grep -q '^-----BEGIN PRIVATE KEY-----' "${P8_FILE}"; then
  echo "APPLE_NOTARY_KEY_P8_BASE64 did not decode to an App Store Connect private key" >&2
  exit 1
fi

security create-keychain -p "${KEYCHAIN_PASSWORD}" "${KEYCHAIN}"
security set-keychain-settings -lut 21600 "${KEYCHAIN}"
security unlock-keychain -p "${KEYCHAIN_PASSWORD}" "${KEYCHAIN}"
security list-keychains -d user -s "${KEYCHAIN}" "${DEFAULT_KEYCHAIN}"
security import "${P12_FILE}" -k "${KEYCHAIN}" -P "${APPLE_DEVELOPER_ID_P12_PASSWORD}" -T /usr/bin/codesign -T /usr/bin/security
security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "${KEYCHAIN_PASSWORD}" "${KEYCHAIN}" >/dev/null

IDENTITIES="$(security find-identity -v -p codesigning "${KEYCHAIN}")"
IDENTITY="$(printf '%s\n' "${IDENTITIES}" | sed -nE "s/^[^\"]*\"(Developer ID Application: .* \\(${APPLE_TEAM_ID}\\))\".*/\\1/p")"
if [[ -z "${IDENTITY}" || "$(printf '%s\n' "${IDENTITY}" | wc -l | tr -d ' ')" != "1" ]]; then
  echo "Expected exactly one Developer ID Application identity for team ${APPLE_TEAM_ID}" >&2
  exit 1
fi

sign_item() {
  codesign --force --timestamp --options runtime --sign "${IDENTITY}" "$1"
}

while IFS= read -r -d '' item; do
  if file -b "${item}" | grep -q 'Mach-O'; then
    sign_item "${item}"
  fi
done < <(find "${MAC_APP}/Contents" -depth -type f -print0)

while IFS= read -r -d '' bundle; do
  sign_item "${bundle}"
done < <(find "${MAC_APP}/Contents" -depth -type d \( -name '*.framework' -o -name '*.xpc' -o -name '*.appex' -o -name '*.plugin' -o -name '*.bundle' -o -name '*.app' \) -print0)

if [[ -n "${MAC_ENTITLEMENTS:-}" ]]; then
  plutil -lint "${MAC_ENTITLEMENTS}"
  if [[ "$(plutil -extract com.apple.security.get-task-allow raw -o - "${MAC_ENTITLEMENTS}" 2>/dev/null || true)" == "true" ]]; then
    echo "Release entitlements must not enable com.apple.security.get-task-allow" >&2
    exit 1
  fi
  codesign --force --timestamp --options runtime --entitlements "${MAC_ENTITLEMENTS}" --sign "${IDENTITY}" "${MAC_APP}"
else
  sign_item "${MAC_APP}"
fi

codesign --verify --deep --strict --verbose=4 "${MAC_APP}"
SIGNING_DETAILS="$(codesign --display --verbose=4 "${MAC_APP}" 2>&1)"
printf '%s\n' "${SIGNING_DETAILS}" | grep -F "TeamIdentifier=${APPLE_TEAM_ID}" >/dev/null
printf '%s\n' "${SIGNING_DETAILS}" | grep -F 'Authority=Developer ID Application:' >/dev/null
printf '%s\n' "${SIGNING_DETAILS}" | grep -E 'flags=.*\(runtime\)' >/dev/null

EXECUTABLE="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "${MAC_APP}/Contents/Info.plist")"
ARCHITECTURES="$(lipo -archs "${MAC_APP}/Contents/MacOS/${EXECUTABLE}")"
printf '%s\n' "${ARCHITECTURES}" | grep -w arm64 >/dev/null
printf '%s\n' "${ARCHITECTURES}" | grep -w x86_64 >/dev/null

ditto -c -k --keepParent "${MAC_APP}" "${NOTARY_ZIP}"
set +e
xcrun notarytool submit "${NOTARY_ZIP}" \
  --key "${P8_FILE}" \
  --key-id "${APPLE_NOTARY_KEY_ID}" \
  --issuer "${APPLE_NOTARY_ISSUER_ID}" \
  --wait --timeout 45m --output-format json > "${NOTARY_RESULT}"
NOTARY_EXIT=$?
set -e
if [[ "${NOTARY_EXIT}" != "0" || "$(plutil -extract status raw -o - "${NOTARY_RESULT}" 2>/dev/null || true)" != "Accepted" ]]; then
  cat "${NOTARY_RESULT}" >&2
  SUBMISSION_ID="$(plutil -extract id raw -o - "${NOTARY_RESULT}" 2>/dev/null || true)"
  if [[ -n "${SUBMISSION_ID}" ]]; then
    xcrun notarytool log "${SUBMISSION_ID}" --key "${P8_FILE}" --key-id "${APPLE_NOTARY_KEY_ID}" --issuer "${APPLE_NOTARY_ISSUER_ID}" >&2 || true
  fi
  exit 1
fi

xcrun stapler staple -v "${MAC_APP}"
xcrun stapler validate -v "${MAC_APP}"
codesign --verify --deep --strict --verbose=4 "${MAC_APP}"
spctl --assess --type execute --verbose=4 "${MAC_APP}"

mkdir -p "$(dirname "${MAC_ARCHIVE}")"
ditto -c -k --sequesterRsrc --keepParent "${MAC_APP}" "${MAC_ARCHIVE}"
unzip -tq "${MAC_ARCHIVE}" >/dev/null
shasum -a 256 "${MAC_ARCHIVE}"
