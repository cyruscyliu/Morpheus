#!/usr/bin/env bash
set -euo pipefail

qemu_path="${MORPHEUS_QEMU_PATH:?}"
kernel_path="${MORPHEUS_QEMU_KERNEL:?}"
initrd_path="${MORPHEUS_QEMU_INITRD:?}"
run_dir="${MORPHEUS_QEMU_RUN_DIR:?}"
append="${MORPHEUS_QEMU_APPEND:-console=ttyAMA0 rdinit=/bin/sh}"
qemu_arg_file="${MORPHEUS_QEMU_QEMU_ARG_FILE:-}"
detach="${MORPHEUS_QEMU_DETACH:-}"
result_file="${MORPHEUS_QEMU_RESULT_FILE:-${MORPHEUS_SCRIPT_RESULT_FILE:?}}"
log_file="${run_dir}/stdout.log"
manifest_file="${run_dir}/manifest.json"

mkdir -p "${run_dir}"
: > "${log_file}"

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
  "${qemu_path}" "${args[@]}" >> "${log_file}" 2>&1 &
  pid="$!"
  cat > "${manifest_file}" <<EOF
{"schemaVersion":1,"tool":"qemu","command":"exec","status":"running","run_dir":"${run_dir}","log_file":"${log_file}","pid":${pid},"detached":true}
EOF
  cat > "${result_file}" <<EOF
{"details":{"pid":${pid},"detached":true}}
EOF
  exit 0
fi

"${qemu_path}" "${args[@]}" >> "${log_file}" 2>&1
cat > "${manifest_file}" <<EOF
{"schemaVersion":1,"tool":"qemu","command":"exec","status":"success","run_dir":"${run_dir}","log_file":"${log_file}","pid":null,"detached":false}
EOF
cat > "${result_file}" <<EOF
{"details":{"pid":null,"detached":false}}
EOF
