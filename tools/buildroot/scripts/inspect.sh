#!/usr/bin/env bash
set -euo pipefail

output_dir="${MORPHEUS_BUILDROOT_OUTPUT:-}"
result_file="${MORPHEUS_BUILDROOT_RESULT_FILE:-${MORPHEUS_SCRIPT_RESULT_FILE:?}}"

if [ -z "${output_dir}" ]; then
  echo "inspect requires MORPHEUS_BUILDROOT_OUTPUT" >&2
  exit 1
fi

manifest_path="${output_dir}/manifest.json"
if [ ! -f "${manifest_path}" ]; then
  cat > "${result_file}" <<EOF
{"details":{"output":"${output_dir}"}}
EOF
  exit 0
fi

cp "${manifest_path}" "${result_file}"
