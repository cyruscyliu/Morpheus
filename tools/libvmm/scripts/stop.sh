#!/usr/bin/env bash
set -euo pipefail

run_dir="${MORPHEUS_LIBVMM_RUN_DIR:-${MORPHEUS_LIBVMM_SOURCE:-}}"
result_file="${MORPHEUS_LIBVMM_RESULT_FILE:-${MORPHEUS_SCRIPT_RESULT_FILE:?}}"
manifest_file="${run_dir}/manifest.json"

if [ ! -f "${manifest_file}" ]; then
  echo "missing libvmm manifest: ${manifest_file}" >&2
  exit 1
fi

pid="$(node -e "const fs=require('fs'); const m=JSON.parse(fs.readFileSync(process.argv[1],'utf8')); process.stdout.write(String(m.pid||''));" "${manifest_file}")"
if [ -n "${pid}" ]; then
  kill "${pid}" 2>/dev/null || true
fi

node -e "const fs=require('fs'); const file=process.argv[1]; const m=JSON.parse(fs.readFileSync(file,'utf8')); m.status='stopped'; m.signal='SIGTERM'; m.updatedAt=new Date().toISOString(); fs.writeFileSync(file, JSON.stringify(m,null,2)+'\n');" "${manifest_file}"

cat > "${result_file}" <<EOF
{"details":{"stopped":true,"pid":${pid:-null}}}
EOF
