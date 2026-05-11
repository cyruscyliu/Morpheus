#!/usr/bin/env bash
set -euo pipefail

qemu_path="${MORPHEUS_QEMU_PATH:?}"
kernel_path="${MORPHEUS_QEMU_KERNEL:?}"
initrd_path="${MORPHEUS_QEMU_INITRD:?}"
run_dir="${MORPHEUS_QEMU_RUN_DIR:?}"
append="${MORPHEUS_QEMU_APPEND:-console=ttyAMA0 rdinit=/bin/sh}"
qemu_arg_file="${MORPHEUS_QEMU_QEMU_ARG_FILE:-}"
timeout_seconds="${MORPHEUS_QEMU_TIMEOUT_SECONDS:-0}"
detach="${MORPHEUS_QEMU_DETACH:-}"
result_file="${MORPHEUS_QEMU_RESULT_FILE:-${MORPHEUS_SCRIPT_RESULT_FILE:?}}"
manifest_file="${run_dir}/manifest.json"

mkdir -p "${run_dir}"

args=(
  "-machine" "virt,virtualization=on,gic-version=3"
  "-cpu" "cortex-a57"
  "-m" "1024"
  "-nographic"
  "-kernel" "${kernel_path}"
  "-initrd" "${initrd_path}"
  "-append" "${append}"
)

if [ -n "${qemu_arg_file}" ] && [ -s "${qemu_arg_file}" ]; then
  mapfile -t extra_args < "${qemu_arg_file}"
  args+=("${extra_args[@]}")
fi

if [ "${detach}" = "true" ]; then
  "${qemu_path}" "${args[@]}" < /dev/null &
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
  cat > "${manifest_file}" <<EOF
{"schemaVersion":1,"tool":"qemu","command":"exec","status":"running","run_dir":"${run_dir}","log_file":"${run_dir}/stdout.log","pid":${pid},"timeout_pid":${timeout_pid:-null},"timeout_seconds":${timeout_seconds},"detached":true}
EOF
  cat > "${result_file}" <<EOF
{"details":{"pid":${pid},"detached":true}}
EOF
  exit 0
fi

exit_code=0
if [ "${timeout_seconds}" != "0" ]; then
  timeout --preserve-status "${timeout_seconds}s" "${qemu_path}" "${args[@]}" || exit_code="$?"
else
  "${qemu_path}" "${args[@]}" || exit_code="$?"
fi

if [ "${exit_code}" = "124" ]; then
  cat > "${manifest_file}" <<EOF
{"schemaVersion":1,"tool":"qemu","command":"exec","status":"timeout","run_dir":"${run_dir}","log_file":"${run_dir}/stdout.log","pid":null,"timeout_seconds":${timeout_seconds},"detached":false}
EOF
  cat > "${result_file}" <<EOF
{"command":"exec","status":"error","exit_code":124,"summary":"local QEMU run timed out","error":{"code":"qemu_timeout","message":"local QEMU run timed out"}}
EOF
  exit 124
fi

if [ "${exit_code}" != "0" ]; then
  exit "${exit_code}"
fi

cat > "${manifest_file}" <<EOF
{"schemaVersion":1,"tool":"qemu","command":"exec","status":"success","run_dir":"${run_dir}","log_file":"${run_dir}/stdout.log","pid":null,"detached":false}
EOF
cat > "${result_file}" <<EOF
{"details":{"pid":null,"detached":false}}
EOF
