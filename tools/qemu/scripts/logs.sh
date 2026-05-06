#!/usr/bin/env bash
set -euo pipefail

build_dir="${MORPHEUS_QEMU_BUILD_DIR:-}"
run_dir="${MORPHEUS_QEMU_RUN_DIR:-}"
source_dir="${MORPHEUS_QEMU_SOURCE:-}"
result_file="${MORPHEUS_QEMU_RESULT_FILE:-${MORPHEUS_SCRIPT_RESULT_FILE:?}}"

if [ -n "${build_dir}" ]; then
  log_file="${build_dir}/build.log"
elif [ -n "${run_dir}" ]; then
  log_file="${run_dir}/stdout.log"
elif [ -n "${source_dir}" ] && [ -f "${source_dir}/.morpheus-tool.log" ]; then
  log_file="${source_dir}/.morpheus-tool.log"
elif [ -n "${source_dir}" ]; then
  log_file="${source_dir}/.morpheus-patches.log"
else
  echo "logs requires build-dir, run-dir, or source" >&2
  exit 1
fi

if [ ! -f "${log_file}" ]; then
  echo "missing log file: ${log_file}" >&2
  exit 1
fi

node -e "const fs=require('fs'); const file=process.argv[1]; const out=process.argv[2]; const text=fs.readFileSync(file,'utf8'); fs.writeFileSync(out, JSON.stringify({details:{log_file:file,text}}));" "${log_file}" "${result_file}"
