#!/usr/bin/env bash
set -euo pipefail

result_file="${MORPHEUS_DRIVER_CALLGRAPH_RESULT_FILE:-${MORPHEUS_SCRIPT_RESULT_FILE:?}}"
output_dir="${MORPHEUS_DRIVER_CALLGRAPH_OUTPUT:?}"
manifest_path="${output_dir}/driver-callgraph-manifest.json"
dot_path="${output_dir}/driver-callgraph.dot"
svg_path="${output_dir}/driver-callgraph.svg"
pdf_path="${output_dir}/driver-callgraph.pdf"
log_path="${output_dir}/build.log"

if [ ! -f "${manifest_path}" ]; then
  echo "missing driver callgraph manifest: ${manifest_path}" >&2
  exit 1
fi

cat > "${result_file}" <<EOF
{
  "summary": "inspected driver lifecycle base graph",
  "details": {
    "output": "${output_dir}",
    "manifest": "${manifest_path}"
  },
  "artifacts": [
    { "path": "manifest", "location": "${manifest_path}" },
    { "path": "graph-dot", "location": "${dot_path}" },
    { "path": "graph-svg", "location": "${svg_path}" },
    { "path": "graph-pdf", "location": "${pdf_path}" },
    { "path": "build-log", "location": "${log_path}" }
  ]
}
EOF
