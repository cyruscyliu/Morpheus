#!/usr/bin/env bash
set -euo pipefail

build_dir="${MORPHEUS_NQC2_BUILD_DIR:-}"
trace_dir="${MORPHEUS_NQC2_TRACE_DIR:-}"
result_file="${MORPHEUS_NQC2_RESULT_FILE:-${MORPHEUS_SCRIPT_RESULT_FILE:?}}"

if [ -n "${build_dir}" ] && [ -f "${build_dir}/manifest.json" ]; then
  target="${build_dir}/manifest.json"
elif [ -n "${trace_dir}" ] && [ -d "${trace_dir}" ]; then
  target="${trace_dir}"
else
  echo "logs requires build-dir or trace-dir" >&2
  exit 1
fi

node -e "const fs=require('fs'); const p=process.argv[1]; const out=process.argv[2]; let text=''; try { text = fs.statSync(p).isDirectory() ? fs.readdirSync(p).sort().join('\n') : fs.readFileSync(p,'utf8'); } catch (err) { process.stderr.write(String(err)); process.exit(1); } fs.writeFileSync(out, JSON.stringify({details:{target:p,text}}));" "${target}" "${result_file}"
