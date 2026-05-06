#!/usr/bin/env bash
set -euo pipefail

state_dir="${MORPHEUS_NVIRSH_STATE_DIR:-${PWD}}"
result_file="${MORPHEUS_NVIRSH_RESULT_FILE:-${MORPHEUS_SCRIPT_RESULT_FILE:?}}"
manifest_file="${state_dir}/manifest.json"

if [ ! -f "${manifest_file}" ]; then
  echo "missing prepared state: ${manifest_file}" >&2
  exit 1
fi

log_file="$(node -e "const fs=require('fs'); const m=JSON.parse(fs.readFileSync(process.argv[1],'utf8')); process.stdout.write(String((m.runtime&&m.runtime.providerRun&&m.runtime.providerRun.log_file)||m.logFile||''));" "${manifest_file}")"
if [ ! -f "${log_file}" ]; then
  echo "missing log file: ${log_file}" >&2
  exit 1
fi

node -e "const fs=require('fs'); const file=process.argv[1]; const out=process.argv[2]; const text=fs.readFileSync(file,'utf8'); fs.writeFileSync(out, JSON.stringify({details:{log_file:file,text}}));" "${log_file}" "${result_file}"
