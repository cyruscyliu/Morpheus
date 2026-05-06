#!/usr/bin/env bash
set -euo pipefail

state_dir="${MORPHEUS_NVIRSH_STATE_DIR:-${PWD}}"
result_file="${MORPHEUS_NVIRSH_RESULT_FILE:-${MORPHEUS_SCRIPT_RESULT_FILE:?}}"
manifest_file="${state_dir}/manifest.json"

if [ ! -f "${manifest_file}" ]; then
  echo "missing prepared state: ${manifest_file}" >&2
  exit 1
fi

node -e "const fs=require('fs'); const file=process.argv[1]; const out=process.argv[2]; const manifest=JSON.parse(fs.readFileSync(file,'utf8')); fs.writeFileSync(out, JSON.stringify({details:{manifest}}));" "${manifest_file}" "${result_file}"
