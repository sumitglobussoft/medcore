#!/usr/bin/env bash
#
# Runner for MedCore mobile E2E flows powered by Maestro.
#
# Responsibilities:
#   1. Verify `maestro` is on PATH and bail with an install hint if not.
#   2. Resolve the target device (first connected Android emulator or
#      iOS simulator; the user can override with MAESTRO_DEVICE).
#   3. Stop any previous instance of the app to guarantee clean state.
#   4. Execute every *.yaml flow under apps/mobile/e2e sequentially,
#      collecting per-flow screenshots + logs under e2e/artifacts/.
#   5. Exit non-zero if any flow fails.
#
# Usage:
#
#   # Run all flows against the default device.
#   apps/mobile/e2e/run.sh
#
#   # Run a single flow (pass the filename relative to e2e/).
#   apps/mobile/e2e/run.sh login.yaml
#
#   # Target a specific device.
#   MAESTRO_DEVICE=emulator-5554 apps/mobile/e2e/run.sh
#
#   # Override credentials for a staging run.
#   PATIENT_EMAIL=qa.patient@staging.medcore.local \
#   PATIENT_PASSWORD=stagingpw \
#   apps/mobile/e2e/run.sh
#
# Prerequisite: `apps/mobile` Expo dev server must already be running
# (npm --prefix apps/mobile run dev) AND the app must be installed on
# the target device (typically by opening the Expo Go QR or running
# `npm --prefix apps/mobile run android` once so the Metro bundler
# serves it).

set -eu -o pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ARTIFACT_DIR="${SCRIPT_DIR}/artifacts"
mkdir -p "${ARTIFACT_DIR}"

# --- Preflight ---------------------------------------------------------------

if ! command -v maestro >/dev/null 2>&1; then
  cat >&2 <<'EOF'
error: maestro is not installed or not on PATH.

Install it with:

    curl -Ls "https://get.maestro.mobile.dev" | bash

Then either restart your shell or `export PATH="$HOME/.maestro/bin:$PATH"`.
See apps/mobile/TESTING.md for the full setup + device prerequisites.
EOF
  exit 127
fi

MAESTRO_APP_ID="${MAESTRO_APP_ID:-com.medcore.app}"
PATIENT_EMAIL="${PATIENT_EMAIL:-patient1@medcore.local}"
PATIENT_PASSWORD="${PATIENT_PASSWORD:-patient123}"

export MAESTRO_APP_ID PATIENT_EMAIL PATIENT_PASSWORD

# --- Device resolution -------------------------------------------------------
#
# `maestro test` auto-selects a device if only one is online. When
# multiple are connected the caller must pass --device. We honour
# MAESTRO_DEVICE if set and let maestro's own resolver handle the
# default case — surfacing a clear error if no device is reachable.

if [[ -n "${MAESTRO_DEVICE:-}" ]]; then
  DEVICE_FLAG=(--device "${MAESTRO_DEVICE}")
else
  DEVICE_FLAG=()
fi

echo ">>> Using app id:  ${MAESTRO_APP_ID}"
echo ">>> Patient email: ${PATIENT_EMAIL}"
if [[ ${#DEVICE_FLAG[@]} -gt 0 ]]; then
  echo ">>> Device:        ${MAESTRO_DEVICE}"
else
  echo ">>> Device:        (maestro auto-select)"
fi
echo

# --- Flow list ---------------------------------------------------------------

# If an argument was passed, run just that one. Otherwise run every
# top-level flow in a fixed order so dependent flows (book-appointment
# relies on login.yaml via `runFlow:`, but the flow file itself must
# be reachable relative to the cwd) execute predictably.
FLOWS=(
  "login.yaml"
  "view-prescriptions.yaml"
  "view-bill.yaml"
  "view-lab-results.yaml"
  "book-appointment.yaml"
  "ai-triage-chat.yaml"
  "adherence-mark-dose.yaml"
)

if [[ $# -gt 0 ]]; then
  FLOWS=("$1")
fi

# --- Execution loop ----------------------------------------------------------

failed=()
for flow in "${FLOWS[@]}"; do
  flow_path="${SCRIPT_DIR}/${flow}"
  if [[ ! -f "${flow_path}" ]]; then
    echo "warning: flow not found: ${flow_path} — skipping" >&2
    continue
  fi

  stem="${flow%.yaml}"
  log_file="${ARTIFACT_DIR}/${stem}.log"
  report_file="${ARTIFACT_DIR}/${stem}.xml"

  echo "============================================================"
  echo ">>> Running flow: ${flow}"
  echo "============================================================"

  # Clear prior app state so flows don't contaminate each other.
  maestro "${DEVICE_FLAG[@]}" -a "${MAESTRO_APP_ID}" stop >/dev/null 2>&1 || true

  if maestro "${DEVICE_FLAG[@]}" test \
        --format junit \
        --output "${report_file}" \
        "${flow_path}" 2>&1 | tee "${log_file}"; then
    echo ">>> PASS: ${flow}"
  else
    echo ">>> FAIL: ${flow}" >&2
    failed+=("${flow}")
  fi
  echo
done

# --- Summary ----------------------------------------------------------------

echo "============================================================"
echo "Summary"
echo "============================================================"
echo "Total flows: ${#FLOWS[@]}"
echo "Failed:      ${#failed[@]}"
if [[ ${#failed[@]} -gt 0 ]]; then
  printf '  - %s\n' "${failed[@]}"
  echo
  echo "Artifacts (logs + JUnit XML) under: ${ARTIFACT_DIR}"
  exit 1
fi

echo
echo "All flows passed. Artifacts: ${ARTIFACT_DIR}"
