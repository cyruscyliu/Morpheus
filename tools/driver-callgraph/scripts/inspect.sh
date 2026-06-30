#!/usr/bin/env bash
set -euo pipefail

result_file="${MORPHEUS_DRIVER_CALLGRAPH_RESULT_FILE:-${MORPHEUS_SCRIPT_RESULT_FILE:?}}"
output_dir="${MORPHEUS_DRIVER_CALLGRAPH_OUTPUT:?}"
manifest_path="${output_dir}/driver-callgraph-manifest.json"
dot_path="${output_dir}/driver-callgraph-display.dot"
llcg_input_dot_path="${output_dir}/driver-callgraph-llcg-input.dot"
slice_dot_path="${output_dir}/driver-callgraph-slice.dot"
collapsed_dot_path="${output_dir}/driver-callgraph-collapsed.dot"
debug_json_path="${output_dir}/driver-callgraph-debug.json"
roots_json_path="${output_dir}/driver-callgraph-roots.json"
groups_json_path="${output_dir}/driver-callgraph-groups.json"
node_dot_path="${output_dir}/driver-callgraph-raw.dot"
svg_path="${output_dir}/driver-callgraph-display.svg"
node_svg_path="${output_dir}/driver-callgraph-raw.svg"
pdf_path="${output_dir}/driver-callgraph-display.pdf"
node_pdf_path="${output_dir}/driver-callgraph-raw.pdf"
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
    { "path": "graph-llcg-input-dot", "location": "${llcg_input_dot_path}" },
    { "path": "graph-slice-dot", "location": "${slice_dot_path}" },
    { "path": "graph-collapsed-dot", "location": "${collapsed_dot_path}" },
    { "path": "debug-json", "location": "${debug_json_path}" },
    { "path": "roots-json", "location": "${roots_json_path}" },
    { "path": "groups-json", "location": "${groups_json_path}" },
    { "path": "graph-display-dot", "location": "${dot_path}" },
    { "path": "graph-raw-dot", "location": "${node_dot_path}" },
    { "path": "graph-display-svg", "location": "${svg_path}" },
    { "path": "graph-raw-svg", "location": "${node_svg_path}" },
    { "path": "graph-display-pdf", "location": "${pdf_path}" },
    { "path": "graph-raw-pdf", "location": "${node_pdf_path}" },
    { "path": "build-log", "location": "${log_path}" }
  ]
}
EOF
