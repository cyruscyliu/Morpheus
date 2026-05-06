#!/usr/bin/env bash
set -euo pipefail

source_dir="${MORPHEUS_MICROKIT_SDK_PATH:-${MORPHEUS_MICROKIT_SDK_SOURCE:?}}"
result_file="${MORPHEUS_MICROKIT_SDK_RESULT_FILE:-${MORPHEUS_SCRIPT_RESULT_FILE:?}}"
version=""
if [ -f "${source_dir}/VERSION" ]; then
  version="$(tr -d '\n' < "${source_dir}/VERSION")"
fi
cat > "${result_file}" <<EOF
{"details":{"source":"${source_dir}","version":"${version}"}}
EOF
