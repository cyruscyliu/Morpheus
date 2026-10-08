#!/usr/bin/env bash
set -euo pipefail

# CodeQL is an internal implementation detail. Evaluation runs must enter
# through the Morpheus tool/workflow so stage state, locks, manifests,
# artifacts, and provenance are recorded.

tool_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
output_dir="${MORPHEUS_SDG_EXTRACTOR_OUTPUT:?}"
build_dir="${MORPHEUS_SDG_EXTRACTOR_BUILD_DIR:-${tool_root}/builds/default/build}"
result_file="${MORPHEUS_SDG_EXTRACTOR_RESULT_FILE:-${MORPHEUS_SCRIPT_RESULT_FILE:?}}"

# The analysis input list: source files to analyze, one path per line. The
# flag name is retained from the replaced LLVM implementation.
input_list="${MORPHEUS_SDG_EXTRACTOR_BITCODE_LIST:-}"

mkdir -p "${output_dir}"

log_file="${output_dir}/sdg-extractor.log"
rules_file="${output_dir}/sdg-rules.json"
nodes_file="${output_dir}/sdg-nodes.json"
edges_file="${output_dir}/sdg-edges.json"
sdg_files_dir="${output_dir}/sdg"
manifest_file="${output_dir}/manifest.json"

rm -rf "${sdg_files_dir}"

: > "${log_file}"

log() {
  printf '%s\n' "$*" | tee -a "${log_file}"
}

log "sdg-extractor exec start"
log "output_dir=${output_dir}"

CODEQL="${CODEQL:-codeql}"
codeql_bin="$(command -v "${CODEQL}")"
codeql_dist="$(cd "$(dirname "${codeql_bin}")/.." && pwd)"
queries_dir="${tool_root}/queries"
extract_query="${queries_dir}/sdg/SdgExtract.ql"
if [ ! -f "${extract_query}" ]; then
  log "error: extract query not found at ${extract_query}"
  exit 1
fi

if [ -n "${input_list}" ] && [ ! -e "${input_list}" ]; then
  log "error: required input not found: ${input_list}"
  exit 1
fi

if [ -n "${input_list}" ] && [ ! -f "${input_list}" ]; then
  log "error: input list is not a file: ${input_list}"
  exit 1
fi

input_count=0
if [ -n "${input_list}" ] && [ -f "${input_list}" ]; then
  input_count=$(wc -l < "${input_list}" | tr -d ' ')
fi

log "input files=${input_count}"

work_dir="${output_dir}/work"
mkdir -p "${work_dir}"

# Collect existing source files.
src_files=()
while IFS= read -r entry; do
  [ -z "${entry}" ] && continue
  if [ ! -f "${entry}" ]; then
    log "warning: missing source ${entry}"
    continue
  fi
  src_files+=("${entry}")
done < "${input_list}"

if [ ${#src_files[@]} -eq 0 ]; then
  log "error: no source files to analyze"
  exit 1
fi

# One CodeQL database per input file. Functions with the same name across
# translation units collapse IR extraction, so each file gets its own
# database and its results carry the input's provenance.
bqrs_list="${work_dir}/bqrs.list"
: > "${bqrs_list}"
db_root="${work_dir}/databases"
mkdir -p "${db_root}"

for src_file in "${src_files[@]}"; do
  base="$(basename "${src_file}")"
  base="${base%.*}"
  db_dir="${db_root}/${base}"
  rm -rf "${db_dir}"
  mkdir -p "${db_dir}"

  build_sh="${db_dir}/build.sh"
  {
    printf '#!/bin/sh\n'
    printf 'gcc -c -O1 "%s" -o /dev/null\n' "${src_file}"
  } > "${build_sh}"
  chmod +x "${build_sh}"

  log "creating database for ${src_file}"
  if ! "${CODEQL}" database create "${db_dir}/db" \
      --language=cpp --overwrite \
      --command="sh ${build_sh}" >> "${log_file}" 2>&1; then
    log "error: database creation failed for ${src_file}"
    exit 1
  fi

  log "extracting rules from ${src_file}"
  bqrs="${db_dir}/extract.bqrs"
  if ! "${CODEQL}" query run "${extract_query}" \
      --search-path="${codeql_dist}/qlpacks:${queries_dir}" \
      --database="${db_dir}/db" \
      --output="${bqrs}" >> "${log_file}" 2>&1; then
    log "error: rule extraction failed for ${src_file}"
    exit 1
  fi

  printf '%s\n' "${bqrs}" >> "${bqrs_list}"
done

export PATH="$(dirname "${codeql_bin}"):$PATH"

# Merge the per-input BQRS results into one combined JSON. Items sharing a
# canonical (section, key) identity collapse to the first instance (the
# type-keyed cross-file join of the replaced LLVM implementation); the
# coverage sections (heads/predicates) are per-database counts and are
# skipped.
python3 - "${output_dir}" "${bqrs_list}" <<'PYEOF'
import csv
import io
import json
import os
import subprocess
import sys

output_dir = sys.argv[1]
bqrs_files = []
with open(sys.argv[2]) as f:
    for line in f:
        line = line.strip()
        if line:
            bqrs_files.append(line)

SKIP_SECTIONS = {"heads", "predicates"}
sections = {}

for bqrs in bqrs_files:
    out = subprocess.run(
        ["codeql", "bqrs", "decode", bqrs, "--format=csv"],
        capture_output=True, text=True,
    ).stdout
    rows = list(csv.reader(io.StringIO(out)))
    for row in rows[1:]:
        if len(row) < 3:
            continue
        section, key, json_text = row[0], row[1], row[2]
        if section in SKIP_SECTIONS:
            continue
        if section not in sections:
            sections[section] = {}
        sections[section].setdefault(key, json_text)

def items(section):
    return [
        {"section": section, "key": key, "json": json.loads(text)}
        for key, text in sorted(sections.get(section, {}).items())
    ]

src = [it["json"] for it in items("sources")]
se = [it["json"] for it in items("self_edges")]
ce = [it["json"] for it in items("cross_edges")]
rl = [it["json"] for it in items("rules")]

with open(os.path.join(output_dir, "sdg-nodes.json"), "w") as f:
    json.dump({"version": "0.4.0",
               "count": len(src),
               "nodes": src}, f, indent=2)
with open(os.path.join(output_dir, "sdg-edges.json"), "w") as f:
    json.dump({"version": "0.4.0",
               "self_count": len(se),
               "cross_count": len(ce),
               "self_edges": se,
               "cross_edges": ce}, f, indent=2)
with open(os.path.join(output_dir, "sdg-rules.json"), "w") as f:
    json.dump({"version": "0.4.0",
               "count": len(rl),
               "rules": rl}, f, indent=2)

print(f"merged: {len(src)} sources, {len(se)} self edges, "
      f"{len(ce)} cross edges, {len(rl)} rules")
PYEOF

# The pass wrote a single combined JSON; convert the JSON rules into the
# line-oriented .sdg files used by libafl.
python3 "${tool_root}/scripts/convert_to_sdg.py" \
  --rules "${rules_file}" \
  --output "${sdg_files_dir}"

cat > "${manifest_file}" <<EOF
{
  "command": "exec",
  "status": "success",
  "summary": "extracted SDG rules from source",
  "details": {
    "output": "${output_dir}",
    "input_count": ${input_count}
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
  "summary": "extracted SDG rules from source",
  "details": {
    "output": "${output_dir}",
    "input_count": ${input_count}
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
