#!/usr/bin/env bash
set -euo pipefail

: "${GODOT_BIN:?GODOT_BIN is required}"
: "${PROJECT_PATH:?PROJECT_PATH is required}"
: "${RUNNER_TEMP:?RUNNER_TEMP is required}"

# This runs only in the credential-free public-source build job.
for suite in title_load saves menu_navigation; do
  log="${RUNNER_TEMP}/rising-to-ultima-${suite}.log"
  "${GODOT_BIN}" --headless --max-fps 60 --path "${PROJECT_PATH}" --script "tests/${suite}.gd" --log-file "${log}" > "${log}.output" 2>&1 || {
    cat "${log}.output"
    exit 1
  }
  cat "${log}.output"
  if ! grep -q '^PASS ' "${log}.output" || grep -Eq '^FAIL |SCRIPT ERROR:|^ERROR:' "${log}.output"; then
    echo "Rising to Ultima ${suite} validation failed" >&2
    exit 1
  fi
done
