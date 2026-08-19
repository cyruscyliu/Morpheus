#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/../../_shared/scripts/state.sh"
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"

source_dir="${MORPHEUS_LINUX_SOURCE:?}"
patch_dir="${MORPHEUS_LINUX_PATCH_DIR:?}"
result_file="${MORPHEUS_LINUX_RESULT_FILE:-${MORPHEUS_SCRIPT_RESULT_FILE:?}}"
state_file="${source_dir}/.morpheus-patches.json"

if [[ "${source_dir}" != /* ]]; then
  source_dir="${repo_root}/${source_dir#./}"
fi
if [[ "${patch_dir}" != /* ]]; then
  patch_dir="${repo_root}/${patch_dir#./}"
fi
if [[ "${result_file}" != /* ]]; then
  result_file="$(pwd)/${result_file#./}"
fi

if [ ! -d "${source_dir}" ]; then
  echo "missing source directory: ${source_dir}" >&2
  exit 1
fi
if [ ! -d "${patch_dir}" ]; then
  echo "missing patch directory: ${patch_dir}" >&2
  exit 1
fi

recreate_clean_source() {
  local seed_dir=""
  local archive_url=""
  local git_url=""
  local git_ref=""
  local fetch_submodules=""
  local build_version=""
  local downloads_dir=""

  [ -f "${source_dir}/.morpheus-fetch.json" ] || return 1

  seed_dir="$(node -e '
const fs = require("fs");
try {
  const data = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  process.stdout.write(String(data.seed_dir || ""));
} catch {}
' "${source_dir}/.morpheus-fetch.json")"
  archive_url="$(node -e '
const fs = require("fs");
try {
  const data = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  process.stdout.write(String(data.archive_url || ""));
} catch {}
' "${source_dir}/.morpheus-fetch.json")"
  git_url="$(node -e '
const fs = require("fs");
try {
  const data = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  process.stdout.write(String(data.git_url || ""));
} catch {}
' "${source_dir}/.morpheus-fetch.json")"
  git_ref="$(node -e '
const fs = require("fs");
try {
  const data = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  process.stdout.write(String(data.git_ref || ""));
} catch {}
' "${source_dir}/.morpheus-fetch.json")"
  fetch_submodules="$(node -e '
const fs = require("fs");
try {
  const data = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  process.stdout.write(String(data.fetch_submodules || ""));
} catch {}
' "${source_dir}/.morpheus-fetch.json")"
  build_version="$(node -e '
const fs = require("fs");
try {
  const data = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  process.stdout.write(String(data.build_version || ""));
} catch {}
' "${source_dir}/.morpheus-fetch.json")"

  downloads_dir="$(cd "$(dirname "${source_dir}")/.." && pwd)/downloads"
  rm -rf "${source_dir}"
  env \
    MORPHEUS_LINUX_SOURCE="${source_dir}" \
    MORPHEUS_LINUX_SEED_DIR="${seed_dir}" \
    MORPHEUS_LINUX_ARCHIVE_URL="${archive_url}" \
    MORPHEUS_LINUX_GIT_URL="${git_url}" \
    MORPHEUS_LINUX_GIT_REF="${git_ref}" \
    MORPHEUS_LINUX_FETCH_SUBMODULES="${fetch_submodules}" \
    MORPHEUS_LINUX_DOWNLOADS_DIR="${downloads_dir}" \
    MORPHEUS_LINUX_BUILD_VERSION="${build_version}" \
    "$(dirname "$0")/fetch.sh" >/dev/null
}

patch_files="$(find "${patch_dir}" -type f \( -name '*.patch' -o -name '*.diff' \) -print | LC_ALL=C sort)"
fingerprint="$(printf '%s\n' "${patch_files}" | morpheus_hash_files_from_stdin)"

if morpheus_patch_state_matches "${state_file}" "${fingerprint}"; then
  cat > "${result_file}" <<EOF
{"details":{"reused":true,"applied":true,"fingerprint":"${fingerprint}"}}
EOF
  exit 0
fi

recreate_clean_source || true

while IFS= read -r patch_file; do
  [ -n "${patch_file}" ] || continue
  patch -d "${source_dir}" -p1 -N -i "${patch_file}"
done <<EOF
${patch_files}
EOF

morpheus_write_patch_state "${state_file}" "${patch_dir}" "${fingerprint}"

cat > "${result_file}" <<EOF
{"details":{"applied":true,"fingerprint":"${fingerprint}"}}
EOF
