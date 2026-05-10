#!/usr/bin/env bash
set -euo pipefail

source_dir="${MORPHEUS_PKVM_AARCH64_SOURCE:-}"
build_dir="${MORPHEUS_PKVM_AARCH64_BUILD_DIR:-}"
run_dir="${MORPHEUS_PKVM_AARCH64_RUN_DIR:-}"
result_file="${MORPHEUS_PKVM_AARCH64_RESULT_FILE:-${MORPHEUS_SCRIPT_RESULT_FILE:?}}"

log_file=""
if [ -n "${run_dir}" ] && [ -f "${run_dir}/stdout.log" ]; then
  log_file="${run_dir}/stdout.log"
elif [ -n "${build_dir}" ] && [ -f "${build_dir}/build.log" ]; then
  log_file="${build_dir}/build.log"
elif [ -n "${source_dir}" ] && [ -f "${source_dir}/.morpheus-build.log" ]; then
  log_file="${source_dir}/.morpheus-build.log"
else
  echo "missing pKVM log file" >&2
  exit 1
fi

node -e "const fs=require('fs'); const file=process.argv[1]; const out=process.argv[2]; const text=fs.readFileSync(file,'utf8'); fs.writeFileSync(out, JSON.stringify({details:{log_file:file,text}}));" "${log_file}" "${result_file}"
