#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/../../_shared/scripts/state.sh"

source_dir="${MORPHEUS_QEMU_SOURCE:?}"
patch_dir="${MORPHEUS_QEMU_PATCH_DIR:?}"
result_file="${MORPHEUS_QEMU_RESULT_FILE:-${MORPHEUS_SCRIPT_RESULT_FILE:?}}"
state_file="${source_dir}/.morpheus-patches.json"

if [[ "${source_dir}" != /* ]]; then
  source_dir="$(pwd)/${source_dir#./}"
fi
if [[ "${patch_dir}" != /* ]]; then
  patch_dir="$(pwd)/${patch_dir#./}"
fi
if [[ "${result_file}" != /* ]]; then
  result_file="$(pwd)/${result_file#./}"
fi
state_file="${source_dir}/.morpheus-patches.json"

if [ ! -d "${source_dir}" ]; then
  echo "missing source directory: ${source_dir}" >&2
  exit 1
fi
if [ ! -d "${patch_dir}" ]; then
  echo "missing patch directory: ${patch_dir}" >&2
  exit 1
fi

patch_files="$(find "${patch_dir}" -type f \( -name '*.patch' -o -name '*.diff' \) -print | LC_ALL=C awk 'BEGIN{ORS="\n"}{print}' | LC_ALL=C sort)"
fingerprint="$(printf '%s\n' "${patch_files}" | morpheus_hash_files_from_stdin)"

if morpheus_patch_state_matches "${state_file}" "${fingerprint}"; then
  printf '[qemu] reuse patch state %s fingerprint=%s\n' "${patch_dir}" "${fingerprint}"
  cat > "${result_file}" <<EOF
{"details":{"reused":true,"applied":true,"fingerprint":"${fingerprint}"}}
EOF
  exit 0
fi

printf '[qemu] patch fingerprint changed, refetching clean source before apply\n'
fetch_seed_dir="$(node -e '
const fs = require("fs");
const file = process.argv[1];
try {
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  process.stdout.write(String(data.seed_dir || ""));
} catch {}
' "${source_dir}/.morpheus-fetch.json")"
fetch_archive_url="$(node -e '
const fs = require("fs");
const file = process.argv[1];
try {
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  process.stdout.write(String(data.archive_url || ""));
} catch {}
' "${source_dir}/.morpheus-fetch.json")"
fetch_build_version="$(node -e '
const fs = require("fs");
const file = process.argv[1];
try {
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  process.stdout.write(String(data.build_version || ""));
} catch {}
' "${source_dir}/.morpheus-fetch.json")"
rm -rf "${source_dir}"
env \
  MORPHEUS_QEMU_SEED_DIR="${fetch_seed_dir}" \
  MORPHEUS_QEMU_ARCHIVE_URL="${fetch_archive_url}" \
  MORPHEUS_QEMU_BUILD_VERSION="${fetch_build_version}" \
  "$(dirname "$0")/fetch.sh"

while IFS= read -r patch_file; do
  [ -n "${patch_file}" ] || continue
  printf '>>> %s\n' "${patch_file#${patch_dir}/}"
  patch -d "${source_dir}" -p1 -N -i "${patch_file}"
done <<EOF
${patch_files}
EOF

morpheus_write_patch_state "${state_file}" "${patch_dir}" "${fingerprint}"

printf '[qemu] applied patches from %s fingerprint=%s\n' "${patch_dir}" "${fingerprint}"
cat > "${result_file}" <<EOF
{"details":{"applied":true,"fingerprint":"${fingerprint}"}}
EOF
