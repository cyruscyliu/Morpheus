#!/usr/bin/env bash
set -euo pipefail

result_file="${MORPHEUS_DRIVER_CALLGRAPH_RESULT_FILE:-${MORPHEUS_SCRIPT_RESULT_FILE:?}}"
output_dir="${MORPHEUS_DRIVER_CALLGRAPH_OUTPUT:?}"
llcg_dot="${MORPHEUS_DRIVER_CALLGRAPH_LLCG_DOT:?}"
groups_file="${MORPHEUS_DRIVER_CALLGRAPH_GROUPS_FILE:-}"
prefix_file="${MORPHEUS_DRIVER_CALLGRAPH_PREFIX_FILE:-}"
title="${MORPHEUS_DRIVER_CALLGRAPH_TITLE:-HyperArm Driver Init / Deinit Base Graph}"
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"

if [ ! -f "${llcg_dot}" ] && [[ "${llcg_dot}" != /* ]]; then
  llcg_dot="${repo_root}/${llcg_dot#./}"
fi

if [ ! -f "${llcg_dot}" ]; then
  echo "missing llcg dot: ${llcg_dot}" >&2
  exit 1
fi

if [ -n "${groups_file}" ] && [ ! -f "${groups_file}" ] && [[ "${groups_file}" != /* ]]; then
  groups_file="${repo_root}/${groups_file#./}"
fi

if [ -n "${groups_file}" ] && [ ! -f "${groups_file}" ]; then
  echo "missing groups file: ${groups_file}" >&2
  exit 1
fi

if [ -n "${prefix_file}" ] && [ ! -f "${prefix_file}" ] && [[ "${prefix_file}" != /* ]]; then
  prefix_file="${repo_root}/${prefix_file#./}"
fi

if [ -n "${prefix_file}" ] && [ ! -f "${prefix_file}" ]; then
  echo "missing prefix file: ${prefix_file}" >&2
  exit 1
fi

mkdir -p "${output_dir}"

cmd=(
  node "${repo_root}/tools/driver-callgraph/index.js" compose
  --llcg-dot "${llcg_dot}"
  --output-dir "${output_dir}"
  --title "${title}"
  --result-file "${result_file}"
)

if [ -n "${groups_file}" ]; then
  cmd+=(--groups-file "${groups_file}")
fi

if [ -n "${prefix_file}" ]; then
  cmd+=(--prefix-file "${prefix_file}")
fi

"${cmd[@]}"
