#!/usr/bin/env bash
set -euo pipefail

source_dir="${MORPHEUS_PKVM_AARCH64_SOURCE:?}"
run_dir="${MORPHEUS_PKVM_AARCH64_RUN_DIR:?}"
platform="${MORPHEUS_PKVM_AARCH64_PLATFORM:-virt}"
qemu="${MORPHEUS_PKVM_AARCH64_QEMU:-}"
make_arg_file="${MORPHEUS_PKVM_AARCH64_MAKE_ARG_FILE:-}"
timeout_seconds="${MORPHEUS_PKVM_AARCH64_TIMEOUT_SECONDS:-0}"
detach="${MORPHEUS_PKVM_AARCH64_DETACH:-false}"
result_file="${MORPHEUS_PKVM_AARCH64_RESULT_FILE:-${MORPHEUS_SCRIPT_RESULT_FILE:?}}"

mkdir -p "${run_dir}"

if [ ! -f "${source_dir}/Makefile" ]; then
  echo "missing pKVM source tree: ${source_dir}" >&2
  exit 1
fi

make_args=()
if [ -n "${make_arg_file}" ] && [ -s "${make_arg_file}" ]; then
  mapfile -t make_args < "${make_arg_file}"
else
  make_args=(-j4)
fi

log_file="${run_dir}/stdout.log"
manifest_file="${run_dir}/manifest.json"
work_dir="${PWD}"
make_cmd=(
  make
  "PLATFORM=${platform}"
)
if [ -n "${qemu}" ]; then
  make_cmd+=("QEMU=${qemu}")
  export PATH="$(dirname "${qemu}"):${PATH}"
fi
make_cmd+=("${make_args[@]}")
make_cmd+=(run)

: > "${log_file}"

if [ "${detach}" = "true" ]; then
  (
    cd "${source_dir}"
    "${make_cmd[@]}"
  ) >> "${log_file}" 2>&1 &
  pid="$!"
  timeout_pid=""
  if [ "${timeout_seconds}" != "0" ]; then
    (
      sleep "${timeout_seconds}"
      if kill -0 "${pid}" 2>/dev/null; then
        kill "${pid}" 2>/dev/null || true
        node -e "const fs=require('fs'); const file=process.argv[1]; const pid=Number(process.argv[2]); if (!fs.existsSync(file)) process.exit(0); const m=JSON.parse(fs.readFileSync(file,'utf8')); if (m.pid===pid && m.status==='running') { m.status='timeout'; m.signal='SIGTERM'; m.updatedAt=new Date().toISOString(); fs.writeFileSync(file, JSON.stringify(m,null,2)+'\n'); }" "${manifest_file}" "${pid}" >/dev/null 2>&1 || true
      fi
    ) >/dev/null 2>&1 &
    timeout_pid="$!"
  fi
  sleep 1
  if ! kill -0 "${pid}" 2>/dev/null; then
    cat > "${result_file}" <<EOF
{"command":"exec","status":"error","exit_code":1,"summary":"local pKVM run failed","error":{"code":"pkvm_aarch64_failed","message":"local pKVM run failed"}}
EOF
    exit 1
  fi
  cat > "${manifest_file}" <<EOF
{"schemaVersion":1,"tool":"pkvm-aarch64","command":"exec","status":"running","run_dir":"${run_dir}","log_file":"${log_file}","pid":${pid},"timeout_pid":${timeout_pid:-null},"timeout_seconds":${timeout_seconds},"platform":"${platform}","detached":true}
EOF
  cat > "${result_file}" <<EOF
{"details":{"pid":${pid},"detached":true,"run_dir":"${run_dir}","log_file":"${log_file}"}}
EOF
  printf 'detached runtime log: %s\n' "${log_file}"
  exit 0
fi

exit_code=0
cd "${source_dir}"
if [ "${timeout_seconds}" != "0" ]; then
  timeout --preserve-status "${timeout_seconds}s" "${make_cmd[@]}" >> "${log_file}" 2>&1 || exit_code="$?"
else
  "${make_cmd[@]}" >> "${log_file}" 2>&1 || exit_code="$?"
fi
cd "${work_dir}"

if [ "${exit_code}" = "124" ]; then
  cat > "${manifest_file}" <<EOF
{"schemaVersion":1,"tool":"pkvm-aarch64","command":"exec","status":"timeout","run_dir":"${run_dir}","log_file":"${log_file}","pid":null,"timeout_seconds":${timeout_seconds},"platform":"${platform}","detached":false}
EOF
  cat > "${result_file}" <<EOF
{"command":"exec","status":"error","exit_code":124,"summary":"local pKVM run timed out","error":{"code":"pkvm_aarch64_timeout","message":"local pKVM run timed out"}}
EOF
  exit 124
fi

if [ "${exit_code}" != "0" ]; then
  tail -n 80 "${log_file}" >&2 || true
  exit "${exit_code}"
fi

cat > "${manifest_file}" <<EOF
{"schemaVersion":1,"tool":"pkvm-aarch64","command":"exec","status":"success","run_dir":"${run_dir}","log_file":"${log_file}","pid":null,"platform":"${platform}","detached":false}
EOF
cat > "${result_file}" <<EOF
{"details":{"pid":null,"detached":false}}
EOF
