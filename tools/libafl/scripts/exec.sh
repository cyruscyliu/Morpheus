#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/../../_shared/scripts/project-hook.sh"

source_dir="${MORPHEUS_LIBAFL_SOURCE:?}"
run_dir="${MORPHEUS_LIBAFL_RUN_DIR:?}"
install_dir="${MORPHEUS_LIBAFL_INSTALL_DIR:?}"
harness_script="${MORPHEUS_LIBAFL_HARNESS_SCRIPT:?}"
harness_arg_file="${MORPHEUS_LIBAFL_HARNESS_ARG_FILE:-}"

[ -d "${source_dir}" ] || { echo "missing source directory: ${source_dir}" >&2; exit 1; }
[ -d "${run_dir}" ] || mkdir -p "${run_dir}"
[ -d "${install_dir}" ] || { echo "missing install directory: ${install_dir}" >&2; exit 1; }
harness_args=()
if [ -n "${harness_arg_file}" ] && [ -s "${harness_arg_file}" ]; then
  mapfile -t harness_args < "${harness_arg_file}"
fi

if ! morpheus_delegate_project_hook "${BASH_SOURCE[0]}" "${harness_script}" "libafl harness"; then
  echo "missing libafl harness script: ${harness_script}" >&2
  exit 1
fi
