#!/usr/bin/env bash
set -euo pipefail

source_dir="${MORPHEUS_LIBAFL_SOURCE:?}"
build_dir="${MORPHEUS_LIBAFL_BUILD_DIR:-}"
install_dir="${MORPHEUS_LIBAFL_INSTALL_DIR:-}"
project_inspect_script="${MORPHEUS_LIBAFL_INSPECT_SCRIPT:-}"
result_file="${MORPHEUS_LIBAFL_RESULT_FILE:-${MORPHEUS_SCRIPT_RESULT_FILE:?}}"

[ -d "${source_dir}" ] || { echo "missing source directory: ${source_dir}" >&2; exit 1; }

if [ -n "${project_inspect_script}" ]; then
  [ -f "${project_inspect_script}" ] || {
    echo "missing libafl inspect script: ${project_inspect_script}" >&2
    exit 1
  }
  exec "${project_inspect_script}"
fi

mkdir -p "$(dirname "${result_file}")"
version=""
if [ -d "${source_dir}/.git" ]; then
  version="$(git -C "${source_dir}" rev-parse HEAD)"
fi

cat > "${result_file}" <<EOF
{"details":{"source":"${source_dir}","build_dir":"${build_dir}","install_dir":"${install_dir}","version":"${version}"},"artifacts":[{"path":"source-dir","location":"${source_dir}"}]}
EOF
