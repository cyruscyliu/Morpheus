#!/usr/bin/env bash
set -euo pipefail

source_dir="${MORPHEUS_MICROKIT_SDK_PATH:-${MORPHEUS_MICROKIT_SDK_SOURCE:?}}"
result_file="${MORPHEUS_MICROKIT_SDK_RESULT_FILE:-${MORPHEUS_SCRIPT_RESULT_FILE:?}}"

if [ -f "${source_dir}/.morpheus-patches.log" ]; then
  log_file="${source_dir}/.morpheus-patches.log"
elif [ -f "${source_dir}/VERSION" ]; then
  log_file="${source_dir}/VERSION"
else
  echo "missing source directory: ${source_dir}" >&2
  exit 1
fi

node -e "const fs=require('fs'); const file=process.argv[1]; const out=process.argv[2]; const text=fs.readFileSync(file,'utf8'); fs.writeFileSync(out, JSON.stringify({details:{log_file:file,text}}));" "${log_file}" "${result_file}"
