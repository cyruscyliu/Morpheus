#!/usr/bin/env bash
set -euo pipefail

run_dir="${MORPHEUS_NVIRSH_RUN_DIR:-}"
build_dir="${MORPHEUS_NVIRSH_BUILD_DIR:-}"
install_dir="${MORPHEUS_NVIRSH_INSTALL_DIR:-}"
result_file="${MORPHEUS_NVIRSH_RESULT_FILE:-${MORPHEUS_SCRIPT_RESULT_FILE:?}}"

log_file=""
if [ -n "${run_dir}" ] && [ -f "${run_dir}/stdout.log" ]; then
  log_file="${run_dir}/stdout.log"
elif [ -n "${build_dir}" ] && [ -f "${build_dir}/build.log" ]; then
  log_file="${build_dir}/build.log"
else
  log_file="${install_dir}/state.json"
fi

text=""
if [ -f "${log_file}" ]; then
  text="$(cat "${log_file}")"
fi

cat > "${result_file}" <<EOF
{"details":{"log_file":"${log_file}","text":$(node -e 'process.stdout.write(JSON.stringify(process.argv[1]))' "${text}")}}
EOF
