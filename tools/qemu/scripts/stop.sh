#!/usr/bin/env bash
set -euo pipefail

run_dir="${MORPHEUS_QEMU_RUN_DIR:?}"
result_file="${MORPHEUS_QEMU_RESULT_FILE:-${MORPHEUS_SCRIPT_RESULT_FILE:?}}"
manifest_file="${run_dir}/manifest.json"

if [ ! -f "${manifest_file}" ]; then
  echo "missing qemu manifest: ${manifest_file}" >&2
  exit 1
fi

pid="$(node -e "const fs=require('fs'); const m=JSON.parse(fs.readFileSync(process.argv[1],'utf8')); process.stdout.write(String(m.pid||''));" "${manifest_file}")"
timeout_pid="$(node -e "const fs=require('fs'); const m=JSON.parse(fs.readFileSync(process.argv[1],'utf8')); process.stdout.write(String(m.timeout_pid||''));" "${manifest_file}")"
if [ -n "${pid}" ]; then
  kill "${pid}" 2>/dev/null || true
fi
if [ -n "${timeout_pid}" ]; then
  kill "${timeout_pid}" 2>/dev/null || true
fi

node -e "const fs=require('fs'); const file=process.argv[1]; const m=JSON.parse(fs.readFileSync(file,'utf8')); m.status='stopped'; m.signal='SIGTERM'; m.updatedAt=new Date().toISOString(); fs.writeFileSync(file, JSON.stringify(m,null,2)+'\n');" "${manifest_file}"

cat > "${result_file}" <<EOF
{"details":{"stopped":true,"pid":${pid:-null}}}
EOF
