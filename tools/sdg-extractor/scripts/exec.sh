#!/usr/bin/env bash
set -euo pipefail

tool_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
output_dir="${MORPHEUS_SDG_EXTRACTOR_OUTPUT:?}"
build_dir="${MORPHEUS_SDG_EXTRACTOR_BUILD_DIR:-${tool_root}/builds/default/build}"
result_file="${MORPHEUS_SDG_EXTRACTOR_RESULT_FILE:-${MORPHEUS_SCRIPT_RESULT_FILE:?}}"

bitcode_list="${MORPHEUS_SDG_EXTRACTOR_BITCODE_LIST:-}"
llcg_dot="${MORPHEUS_SDG_EXTRACTOR_LLCG_DOT:-}"
kallgraph_text="${MORPHEUS_SDG_EXTRACTOR_KALLGRAPH_TEXT:-}"
points_to_json="${MORPHEUS_SDG_EXTRACTOR_POINTS_TO_JSON:-}"
entry_list="${MORPHEUS_SDG_EXTRACTOR_ENTRY_LIST:-}"
sink_catalog="${MORPHEUS_SDG_EXTRACTOR_SINK_CATALOG:-}"
struct_catalog="${MORPHEUS_SDG_EXTRACTOR_STRUCT_CATALOG:-}"

mkdir -p "${output_dir}"

log_file="${output_dir}/sdg-extractor.log"
rules_file="${output_dir}/sdg-rules.json"
nodes_file="${output_dir}/sdg-nodes.json"
edges_file="${output_dir}/sdg-edges.json"
sdg_files_dir="${output_dir}/sdg"
manifest_file="${output_dir}/manifest.json"

: > "${log_file}"

log() {
  printf '%s\n' "$*" | tee -a "${log_file}"
}

log "sdg-extractor exec start"
log "output_dir=${output_dir}"

plugin="${build_dir}/src/llvm-pass/SDGExtractPass.so"
extapi_bc="${tool_root}/third_party/SVF/install/lib/extapi.bc"
if [ ! -f "${plugin}" ]; then
  log "error: pass plugin not found at ${plugin}; run build first"
  exit 1
fi
if [ ! -f "${extapi_bc}" ]; then
  log "error: SVF extapi.bc not found at ${extapi_bc}; run third_party/SVF/build-svf.sh"
  exit 1
fi

for f in "${bitcode_list}" "${llcg_dot}" "${kallgraph_text}" "${points_to_json}"; do
  if [ -n "${f}" ] && [ ! -e "${f}" ]; then
    log "error: required input not found: ${f}"
    exit 1
  fi
done

bitcode_count=0
if [ -n "${bitcode_list}" ] && [ -f "${bitcode_list}" ]; then
  bitcode_count=$(wc -l < "${bitcode_list}" | tr -d ' ')
fi

cg_nodes=0
if [ -n "${llcg_dot}" ] && [ -f "${llcg_dot}" ]; then
  cg_nodes=$(grep -cE '^\s*"[^"]+"\s*;' "${llcg_dot}" || true)
fi

log "plugin=${plugin}"
log "bitcode files=${bitcode_count} callgraph nodes=${cg_nodes}"

work_dir="${output_dir}/work"
mkdir -p "${work_dir}"

OPT="${OPT:-opt-15}"
LLVM_LINK="${LLVM_LINK:-llvm-link-15}"
entry_arg=""
if [ -n "${entry_list}" ] && [ -f "${entry_list}" ]; then
  entry_arg="-sdg-entry-list=${entry_list}"
fi
# No external hints are required; all schemas are embedded in SdgSvfCore.

# Resolve bitcode paths. llbic emits paths relative to a kbuild-* subdirectory
# of the directory containing the bitcode list.
bc_list_dir=""
bc_search_dir=""
if [ -n "${bitcode_list}" ] && [ -f "${bitcode_list}" ]; then
  bc_list_dir="$(cd "$(dirname "${bitcode_list}")" && pwd)"
  bc_search_dir="$(find "${bc_list_dir}" -maxdepth 1 -type d -name 'kbuild-*' | head -n 1)"
fi

resolve_bc() {
  local ent="$1"
  if [ -z "${ent}" ]; then
    return
  fi
  if [ -f "${ent}" ]; then
    printf '%s' "${ent}"
    return
  fi
  if [ -n "${bc_list_dir}" ] && [ -f "${bc_list_dir}/${ent}" ]; then
    printf '%s' "${bc_list_dir}/${ent}"
    return
  fi
  if [ -n "${bc_search_dir}" ] && [ -f "${bc_search_dir}/${ent}" ]; then
    printf '%s' "${bc_search_dir}/${ent}"
    return
  fi
}

# Collect existing bitcode files. If there is more than one, link them into a
# single module so the pass can reason about cross-function dataflow.
bc_files=()
while IFS= read -r bc_entry; do
  [ -z "${bc_entry}" ] && continue
  bc_file="$(resolve_bc "${bc_entry}")"
  if [ -z "${bc_file}" ]; then
    log "warning: missing bitcode ${bc_entry}"
    continue
  fi
  bc_files+=("${bc_file}")
done < "${bitcode_list}"

if [ ${#bc_files[@]} -eq 0 ]; then
  log "error: no bitcode files to process"
  exit 1
fi

merged_bc="${work_dir}/merged.bc"
if [ ${#bc_files[@]} -eq 1 ]; then
  merged_bc="${bc_files[0]}"
else
  log "linking ${#bc_files[@]} bitcode modules into ${merged_bc}"
  "${LLVM_LINK}" -o "${merged_bc}" "${bc_files[@]}"
fi

log "extracting from ${merged_bc}"
"${OPT}" -load-pass-plugin "${plugin}" \
  -passes=sdg-extract \
  -sdg-output "${rules_file}" \
  -sdg-extapi "${extapi_bc}" \
  ${entry_arg} \
  "${merged_bc}" \
  -o /dev/null

# The pass writes a single combined JSON; split it into the three artifact files.
python3 - <<PYEOF
import json

with open("${rules_file}") as f:
    data = json.load(f)

version = data.get("version", "0.2.0")
with open("${nodes_file}", "w") as f:
    json.dump({"version": version,
               "count": data.get("nodes", {}).get("count", 0),
               "nodes": data.get("nodes", {}).get("nodes", [])}, f, indent=2)
with open("${edges_file}", "w") as f:
    edges = data.get("edges", {})
    json.dump({"version": version,
               "self_count": edges.get("self_count", 0),
               "cross_count": edges.get("cross_count", 0),
               "self_edges": edges.get("self_edges", []),
               "cross_edges": edges.get("cross_edges", [])}, f, indent=2)
with open("${rules_file}", "w") as f:
    json.dump({"version": version,
               "count": data.get("rules", {}).get("count", 0),
               "rules": data.get("rules", {}).get("rules", [])}, f, indent=2)

print(f"merged: {data.get('nodes',{}).get('count',0)} nodes, "
      f"{data.get('edges',{}).get('self_count',0)} self edges, "
      f"{data.get('edges',{}).get('cross_count',0)} cross edges, "
      f"{data.get('rules',{}).get('count',0)} rules")
PYEOF

# Convert the JSON rules into the line-oriented .sdg files used by libafl.
"${tool_root}/scripts/convert_to_sdg.py" \
  --rules "${rules_file}" \
  --output "${sdg_files_dir}"

cat > "${manifest_file}" <<EOF
{
  "command": "exec",
  "status": "success",
  "summary": "extracted SDG rules from bitcode",
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
    },
    "sdg-files": {
      "portable": "sdg",
      "runtime_path": "${sdg_files_dir}",
      "resolved_path": "${sdg_files_dir}"
    }
  },
  "artifacts": {
    "manifest": true,
    "sdg-rules": true,
    "sdg-nodes": true,
    "sdg-edges": true,
    "log-file": true,
    "sdg-files": true
  }
}
EOF

cat > "${result_file}" <<EOF
{
  "summary": "extracted SDG rules from bitcode",
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
    { "path": "log-file", "location": "${log_file}" },
    { "path": "sdg-files", "location": "${sdg_files_dir}" }
  ]
}
EOF

log "sdg-extractor exec done"
