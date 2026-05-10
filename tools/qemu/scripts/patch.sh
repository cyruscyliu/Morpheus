#!/usr/bin/env bash
set -euo pipefail

source_dir="${MORPHEUS_QEMU_SOURCE:?}"
patch_dir="${MORPHEUS_QEMU_PATCH_DIR:?}"
result_file="${MORPHEUS_QEMU_RESULT_FILE:-${MORPHEUS_SCRIPT_RESULT_FILE:?}}"
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
fingerprint="$(
  {
    printf '%s\n' "${patch_files}"
    while IFS= read -r file; do
      [ -n "${file}" ] || continue
      cat "${file}"
    done <<EOF
${patch_files}
EOF
  } | sha256sum | awk '{print $1}'
)"

if [ -f "${state_file}" ] && grep -q "\"fingerprint\": \"${fingerprint}\"" "${state_file}"; then
  cat > "${result_file}" <<EOF
{"details":{"reused":true,"applied":true,"fingerprint":"${fingerprint}"}}
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

cat > "${state_file}" <<EOF
{
  "appliedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "dir": "${patch_dir}",
  "fingerprint": "${fingerprint}"
}
EOF

cat > "${result_file}" <<EOF
{"details":{"applied":true,"fingerprint":"${fingerprint}"}}
EOF
