#!/usr/bin/env bash
set -euo pipefail

tool_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
legacy="${tool_root}/llcg"
result_file="${MORPHEUS_LLCG_RESULT_FILE:-${MORPHEUS_SCRIPT_RESULT_FILE:?}}"
target="${MORPHEUS_LLCG_TARGET:?}"

"${legacy}" logs "${target}" --json > "${result_file}"
