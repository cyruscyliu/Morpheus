#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/../../_shared/scripts/state.sh"

source_dir="${MORPHEUS_LIBVMM_SOURCE:?}"
patch_dir="${MORPHEUS_LIBVMM_PATCH_DIR:?}"
result_file="${MORPHEUS_LIBVMM_RESULT_FILE:-${MORPHEUS_SCRIPT_RESULT_FILE:?}}"
state_file="${source_dir}/.morpheus-patches.json"

detect_version() {
  if [ -f "${source_dir}/VERSION" ]; then
    tr -d '\n' < "${source_dir}/VERSION"
  elif [ -d "${source_dir}/.git" ]; then
    git -C "${source_dir}" rev-parse HEAD
  else
    printf '%s' ""
  fi
}

if [ ! -d "${source_dir}" ]; then
  echo "missing source directory: ${source_dir}" >&2
  exit 1
fi
if [ ! -d "${patch_dir}" ]; then
  echo "missing patch directory: ${patch_dir}" >&2
  exit 1
fi

patch_files="$(find "${patch_dir}" -type f \( -name '*.patch' -o -name '*.diff' \) | sort)"
fingerprint="$(printf '%s\n' "${patch_files}" | morpheus_hash_files_from_stdin)"

if morpheus_patch_state_matches "${state_file}" "${fingerprint}"; then
  cat > "${result_file}" <<EOF
{"details":{"reused":true,"applied":true,"fingerprint":"${fingerprint}","version":"$(detect_version)"}}
EOF
  exit 0
fi

while IFS= read -r patch_file; do
  [ -n "${patch_file}" ] || continue
  printf '>>> %s\n' "${patch_file#${patch_dir}/}"
  patch -d "${source_dir}" -p1 -N -i "${patch_file}"
done <<EOF
${patch_files}
EOF

morpheus_write_patch_state "${state_file}" "${patch_dir}" "${fingerprint}"

cat > "${result_file}" <<EOF
{"details":{"applied":true,"fingerprint":"${fingerprint}","version":"$(detect_version)"}}
EOF
