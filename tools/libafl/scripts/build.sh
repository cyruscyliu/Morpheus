#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/../../_shared/scripts/project-hook.sh"

source_dir="${MORPHEUS_LIBAFL_SOURCE:?}"
build_dir="${MORPHEUS_LIBAFL_BUILD_DIR:?}"
install_dir="${MORPHEUS_LIBAFL_INSTALL_DIR:?}"
project_build_script="${MORPHEUS_LIBAFL_BUILD_SCRIPT:-}"
result_file="${MORPHEUS_LIBAFL_RESULT_FILE:-${MORPHEUS_SCRIPT_RESULT_FILE:?}}"

[ -d "${source_dir}" ] || { echo "missing source directory: ${source_dir}" >&2; exit 1; }
[ -d "${build_dir}" ] || mkdir -p "${build_dir}"
[ -d "${install_dir}" ] || mkdir -p "${install_dir}"

if ! morpheus_delegate_project_hook "${BASH_SOURCE[0]}" "${project_build_script}" "libafl build"; then
  cat > "${result_file}" <<EOF
{"details":{"built":true,"reused":false,"source":"${source_dir}","build_dir":"${build_dir}","install_dir":"${install_dir}"},"artifacts":[{"path":"source-dir","location":"${source_dir}"}]}
EOF
  exit 0
fi
