#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/../../.." && pwd)"
state_dir="${MORPHEUS_NVIRSH_STATE_DIR:-${PWD}}"
result_file="${MORPHEUS_NVIRSH_RESULT_FILE:-${MORPHEUS_SCRIPT_RESULT_FILE:?}}"
manifest_file="${state_dir}/manifest.json"

if [ ! -f "${manifest_file}" ]; then
  echo "missing prepared state: ${manifest_file}" >&2
  exit 1
fi

provider_run_dir="$(node -e "const fs=require('fs'); const m=JSON.parse(fs.readFileSync(process.argv[1],'utf8')); process.stdout.write(String((m.runtime&&m.runtime.providerRun&&m.runtime.providerRun.run_dir)||''));" "${manifest_file}")"
if [ -n "${provider_run_dir}" ]; then
  node "${repo_root}/apps/morpheus/dist/cli.js" --json stop --tool libvmm --run-dir "${provider_run_dir}" >/dev/null
fi

node -e "const fs=require('fs'); const file=process.argv[1]; const m=JSON.parse(fs.readFileSync(file,'utf8')); m.status='stopped'; m.signal='SIGTERM'; m.updatedAt=new Date().toISOString(); fs.writeFileSync(file, JSON.stringify(m,null,2)+'\n');" "${manifest_file}"

cat > "${result_file}" <<EOF
{"details":{"state_dir":"${state_dir}","stopped":true}}
EOF
