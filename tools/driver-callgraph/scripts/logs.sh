#!/usr/bin/env bash
set -euo pipefail

result_file="${MORPHEUS_DRIVER_CALLGRAPH_RESULT_FILE:-${MORPHEUS_SCRIPT_RESULT_FILE:?}}"
output_dir="${MORPHEUS_DRIVER_CALLGRAPH_OUTPUT:?}"
log_path="${output_dir}/build.log"

if [ -f "${log_path}" ]; then
  cat "${log_path}"
fi

cat > "${result_file}" <<EOF
{
  "summary": "reported driver lifecycle base graph logs",
  "details": {
    "output": "${output_dir}",
    "log": "${log_path}"
  },
  "artifacts": [
    { "path": "build-log", "location": "${log_path}" }
  ]
}
EOF
