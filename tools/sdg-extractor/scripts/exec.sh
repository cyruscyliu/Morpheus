#!/usr/bin/env bash
set -euo pipefail

tool_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
output_dir="${MORPHEUS_SDG_EXTRACTOR_OUTPUT:?}"
build_dir="${MORPHEUS_SDG_EXTRACTOR_BUILD_DIR:-${tool_root}/build}"
result_file="${MORPHEUS_SDG_EXTRACTOR_RESULT_FILE:-${MORPHEUS_SCRIPT_RESULT_FILE:?}}"

bitcode_list="${MORPHEUS_SDG_EXTRACTOR_BITCODE_LIST:-}"
llcg_dot="${MORPHEUS_SDG_EXTRACTOR_LLCG_DOT:-}"
kallgraph_text="${MORPHEUS_SDG_EXTRACTOR_KALLGRAPH_TEXT:-}"
points_to_json="${MORPHEUS_SDG_EXTRACTOR_POINTS_TO_JSON:-}"
entry_list="${MORPHEUS_SDG_EXTRACTOR_ENTRY_LIST:-}"
sink_catalog="${MORPHEUS_SDG_EXTRACTOR_SINK_CATALOG:-}"
struct_catalog="${MORPHEUS_SDG_EXTRACTOR_STRUCT_CATALOG:-}"

mkdir -p "${output_dir}"
mkdir -p "${build_dir}"

log_file="${output_dir}/sdg-extractor.log"
rules_file="${output_dir}/sdg-rules.json"
nodes_file="${output_dir}/sdg-nodes.json"
edges_file="${output_dir}/sdg-edges.json"
manifest_file="${output_dir}/manifest.json"

: > "${log_file}"

log() {
  printf '%s\n' "$*" | tee -a "${log_file}"
}

log "sdg-extractor exec start"
log "output_dir=${output_dir}"

for f in "${bitcode_list}" "${llcg_dot}" "${kallgraph_text}" "${points_to_json}"; do
  if [ -n "${f}" ] && [ ! -f "${f}" ]; then
    log "error: required input not found: ${f}"
    exit 1
  fi
done

# Placeholder extraction: verify inputs and emit empty but valid artifacts.
# The real implementation will parse bitcode, apply the algorithm from
# docs/grammar-extraction.md, and emit populated nodes/edges/rules.

log "placeholder extraction: parsing inputs"

bitcode_count=0
if [ -n "${bitcode_list}" ] && [ -f "${bitcode_list}" ]; then
  bitcode_count=$(wc -l < "${bitcode_list}" | tr -d ' ')
fi

cg_nodes=0
if [ -n "${llcg_dot}" ] && [ -f "${llcg_dot}" ]; then
  cg_nodes=$(grep -cE '^\s*"[^"]+"\s*;' "${llcg_dot}" || true)
fi

log "bitcode files=${bitcode_count} callgraph nodes=${cg_nodes}"

cat > "${nodes_file}" <<EOF
{
  "version": "0.1.0",
  "count": 0,
  "nodes": []
}
EOF

cat > "${edges_file}" <<EOF
{
  "version": "0.1.0",
  "self_edges": [],
  "cross_edges": []
}
EOF

cat > "${rules_file}" <<EOF
{
  "version": "0.1.0",
  "count": 0,
  "rules": []
}
EOF

cat > "${manifest_file}" <<EOF
{
  "command": "exec",
  "status": "success",
  "summary": "extracted SDG rules from bitcode (placeholder)",
  "details": {
    "output": "${output_dir}",
    "bitcode_count": ${bitcode_count},
    "callgraph_nodes": ${cg_nodes}
  },
  "paths": {
    "manifest": {
      "portable": "sdg-extractor-manifest.json",
      "runtime_path": "${manifest_file}",
      "resolved_path": "${manifest_file}"
    },
    "sdg-rules": {
      "portable": "sdg-rules.json",
      "runtime_path": "${rules_file}",
      "resolved_path": "${rules_file}"
    },
    "sdg-nodes": {
      "portable": "sdg-nodes.json",
      "runtime_path": "${nodes_file}",
      "resolved_path": "${nodes_file}"
    },
    "sdg-edges": {
      "portable": "sdg-edges.json",
      "runtime_path": "${edges_file}",
      "resolved_path": "${edges_file}"
    },
    "log-file": {
      "portable": "sdg-extractor.log",
      "runtime_path": "${log_file}",
      "resolved_path": "${log_file}"
    }
  },
  "artifacts": {
    "manifest": true,
    "sdg-rules": true,
    "sdg-nodes": true,
    "sdg-edges": true,
    "log-file": true
  }
}
EOF

cat > "${result_file}" <<EOF
{
  "summary": "extracted SDG rules from bitcode (placeholder)",
  "details": {
    "output": "${output_dir}",
    "bitcode_count": ${bitcode_count},
    "callgraph_nodes": ${cg_nodes}
  },
  "artifacts": [
    { "path": "manifest", "location": "${manifest_file}" },
    { "path": "sdg-rules", "location": "${rules_file}" },
    { "path": "sdg-nodes", "location": "${nodes_file}" },
    { "path": "sdg-edges", "location": "${edges_file}" },
    { "path": "log-file", "location": "${log_file}" }
  ]
}
EOF

log "sdg-extractor exec done"
