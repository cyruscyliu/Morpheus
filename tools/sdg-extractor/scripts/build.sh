#!/usr/bin/env bash
set -euo pipefail

# Compile the sdg-extractor CodeQL query pack. Expects
# MORPHEUS_SDG_EXTRACTOR_BUILD_DIR from the managed runner.

tool_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "${tool_root}/../_shared/scripts/lock.sh"
build_dir="${MORPHEUS_SDG_EXTRACTOR_BUILD_DIR:-${tool_root}/builds/default/build}"
result_file="${MORPHEUS_SDG_EXTRACTOR_RESULT_FILE:-${MORPHEUS_SCRIPT_RESULT_FILE:?}}"
build_dir_key="${MORPHEUS_SDG_EXTRACTOR_BUILD_DIR_KEY:-default}"
morpheus_lock_acquire "${MORPHEUS_SDG_EXTRACTOR_SOURCE:-${tool_root}}.morpheus.lock"
morpheus_build_lock sdg-extractor "${build_dir_key}"
trap morpheus_lock_release EXIT INT TERM

CODEQL="${CODEQL:-codeql}"
codeql_bin="$(command -v "${CODEQL}")"
codeql_dist="$(cd "$(dirname "${codeql_bin}")/.." && pwd)"
queries_dir="${tool_root}/queries"
extract_query="${queries_dir}/sdg/SdgExtract.ql"

mkdir -p "${build_dir}"

log() {
  printf '%s\n' "$*" >&2
}

log "compiling sdg-extractor query pack"

if ! "${CODEQL}" query compile "${extract_query}" \
    --search-path="${codeql_dist}/qlpacks" >&2; then
  echo "error: sdg-extractor query compilation failed" >&2
  exit 1
fi

cat > "${build_dir}/manifest.json" <<EOF
{
  "command": "build",
  "status": "success",
  "summary": "compiled sdg-extractor query pack",
  "details": {
    "build_dir": "${build_dir}",
    "query": "sdg/SdgExtract.ql"
  },
  "paths": {
    "build-dir": {
      "portable": "build",
      "runtime_path": "${build_dir}",
      "resolved_path": "${build_dir}"
    },
    "query": {
      "portable": "sdg/SdgExtract.ql",
      "runtime_path": "${extract_query}",
      "resolved_path": "${extract_query}"
    }
  },
  "artifacts": {
    "build-dir": true,
    "query": true
  }
}
EOF

cat > "${result_file}" <<EOF
{
  "summary": "compiled sdg-extractor query pack",
  "details": {
    "build_dir": "${build_dir}",
    "query": "sdg/SdgExtract.ql"
  },
  "artifacts": [
    { "path": "build-dir", "location": "${build_dir}" },
    { "path": "query", "location": "${extract_query}" }
  ]
}
EOF
