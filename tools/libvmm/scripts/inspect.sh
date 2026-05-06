#!/usr/bin/env bash
set -euo pipefail

source_dir="${MORPHEUS_LIBVMM_SOURCE:?}"
result_file="${MORPHEUS_LIBVMM_RESULT_FILE:-${MORPHEUS_SCRIPT_RESULT_FILE:?}}"
version=""
if [ -f "${source_dir}/VERSION" ]; then
  version="$(tr -d '\n' < "${source_dir}/VERSION")"
fi
cat > "${result_file}" <<EOF
{"details":{"source":"${source_dir}","version":"${version}","artifact":{"path":"libvmm-dir","location":"${source_dir}"}}}
EOF
