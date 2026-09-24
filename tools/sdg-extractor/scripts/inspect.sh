#!/usr/bin/env bash
set -euo pipefail

target="${MORPHEUS_SDG_EXTRACTOR_TARGET:?}"
result_file="${MORPHEUS_SDG_EXTRACTOR_RESULT_FILE:-${MORPHEUS_SCRIPT_RESULT_FILE:?}}"

cat > "${result_file}" <<EOF
{
  "summary": "inspected sdg-extractor manifest: ${target}",
  "details": {}
}
EOF
