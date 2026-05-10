#!/usr/bin/env bash
set -euo pipefail

source_dir="${MORPHEUS_PKVM_AARCH64_SOURCE:?}"
result_file="${MORPHEUS_PKVM_AARCH64_RESULT_FILE:-${MORPHEUS_SCRIPT_RESULT_FILE:?}}"

version=""
if [ -d "${source_dir}/.git" ]; then
  version="$(git -C "${source_dir}" rev-parse HEAD)"
elif [ -f "${source_dir}/VERSION" ]; then
  version="$(tr -d '\n' < "${source_dir}/VERSION")"
fi

cat > "${result_file}" <<EOF
{"details":{"source":"${source_dir}","version":"${version}","artifact":{"path":"source-dir","location":"${source_dir}"}}}
EOF
