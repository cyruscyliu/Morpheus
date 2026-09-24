#!/usr/bin/env bash
set -euo pipefail

target="${MORPHEUS_SDG_EXTRACTOR_TARGET:?}"
result_file="${MORPHEUS_SDG_EXTRACTOR_RESULT_FILE:-${MORPHEUS_SCRIPT_RESULT_FILE:?}}"

log_file="${target}"
if [ -d "${target}" ]; then
  log_file="${target}/sdg-extractor.log"
fi

if [ -f "${log_file}" ]; then
  cat "${log_file}"
fi

cat > "${result_file}" <<EOF
{
  "summary": "read sdg-extractor log: ${log_file}",
  "details": {}
}
EOF
