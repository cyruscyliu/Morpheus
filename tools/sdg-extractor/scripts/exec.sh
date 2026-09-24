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
manifest_file="${output_dir}/manifest.json"

: > "${log_file}"

log() {
  printf '%s\n' "$*" | tee -a "${log_file}"
}

log "sdg-extractor exec start"
log "output_dir=${output_dir}"

plugin="${build_dir}/SDGExtractPass.so"
if [ ! -f "${plugin}" ]; then
  log "error: pass plugin not found at ${plugin}; run build first"
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

work_dir="${output_dir}/per-module"
mkdir -p "${work_dir}"

OPT="${OPT:-opt-15}"
entry_arg=""
if [ -n "${entry_list}" ] && [ -f "${entry_list}" ]; then
  entry_arg="-sdg-entry-list=${entry_list}"
fi

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

idx=0
while IFS= read -r bc_entry; do
  [ -z "${bc_entry}" ] && continue
  bc_file="$(resolve_bc "${bc_entry}")"
  if [ -z "${bc_file}" ]; then
    log "warning: missing bitcode ${bc_entry}"
    continue
  fi
  tmp_out="${work_dir}/out_${idx}.json"
  log "extracting from ${bc_file}"
  "${OPT}" -load-pass-plugin "${plugin}" \
    -passes=sdg-extract \
    -sdg-output "${tmp_out}" \
    ${entry_arg} \
    "${bc_file}" \
    -o /dev/null
  idx=$((idx + 1))
done < "${bitcode_list}"

# Merge per-module JSON outputs into the final artifacts.
python3 - <<PYEOF
import json, os, glob

work_dir = "${work_dir}"
nodes = []
self_edges = []
cross_edges = []
rules = []
seen_node_ids = set()
seen_rule_ids = set()

def edge_key(e):
    return (e.get("src"), e.get("dst"), e.get("head"),
            str(e.get("predicate")), e.get("function"))
seen_edge_keys = set()

for path in sorted(glob.glob(os.path.join(work_dir, "out_*.json"))):
    with open(path) as f:
        data = json.load(f)
    for n in data.get("nodes", {}).get("nodes", []):
        if n["id"] not in seen_node_ids:
            seen_node_ids.add(n["id"])
            nodes.append(n)
    for e in data.get("edges", {}).get("self_edges", []):
        k = edge_key(e)
        if k not in seen_edge_keys:
            seen_edge_keys.add(k)
            self_edges.append(e)
    for e in data.get("edges", {}).get("cross_edges", []):
        k = edge_key(e)
        if k not in seen_edge_keys:
            seen_edge_keys.add(k)
            cross_edges.append(e)
    for r in data.get("rules", {}).get("rules", []):
        if r["id"] not in seen_rule_ids:
            seen_rule_ids.add(r["id"])
            rules.append(r)

version = "0.2.0"
with open("${nodes_file}", "w") as f:
    json.dump({"version": version, "count": len(nodes), "nodes": nodes}, f, indent=2)
with open("${edges_file}", "w") as f:
    json.dump({"version": version, "self_count": len(self_edges), "cross_count": len(cross_edges),
               "self_edges": self_edges, "cross_edges": cross_edges}, f, indent=2)
with open("${rules_file}", "w") as f:
    json.dump({"version": version, "count": len(rules), "rules": rules}, f, indent=2)

print(f"merged: {len(nodes)} nodes, {len(self_edges)} self edges, {len(cross_edges)} cross edges, {len(rules)} rules")
PYEOF

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
    { "path": "log-file", "location": "${log_file}" }
  ]
}
EOF

log "sdg-extractor exec done"
