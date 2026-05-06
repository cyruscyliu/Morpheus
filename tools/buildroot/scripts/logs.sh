#!/usr/bin/env bash
set -euo pipefail

output_dir="${MORPHEUS_BUILDROOT_OUTPUT:-}"
source_dir="${MORPHEUS_BUILDROOT_SOURCE:-}"
result_file="${MORPHEUS_BUILDROOT_RESULT_FILE:-${MORPHEUS_SCRIPT_RESULT_FILE:?}}"

if [ -n "${output_dir}" ]; then
  log_file="${output_dir}/build.log"
elif [ -n "${source_dir}" ]; then
  log_file="${source_dir}/.morpheus-patches.log"
else
  echo "logs requires output or source" >&2
  exit 1
fi

if [ ! -f "${log_file}" ]; then
  echo "missing log file: ${log_file}" >&2
  exit 1
fi

node -e "const fs=require('fs'); const file=process.argv[1]; const out=process.argv[2]; const text=fs.readFileSync(file,'utf8'); fs.writeFileSync(out, JSON.stringify({details:{log_file:file,text}}));" "${log_file}" "${result_file}"
