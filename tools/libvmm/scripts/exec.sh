#!/usr/bin/env bash
set -euo pipefail

run_dir="${MORPHEUS_LIBVMM_RUN_DIR:?}"
libvmm_dir="${MORPHEUS_LIBVMM_LIBVMM_DIR:?}"
microkit_sdk="${MORPHEUS_LIBVMM_MICROKIT_SDK:?}"
board="${MORPHEUS_LIBVMM_BOARD:?}"
kernel="${MORPHEUS_LIBVMM_KERNEL:?}"
initrd="${MORPHEUS_LIBVMM_INITRD:?}"
qemu="${MORPHEUS_LIBVMM_QEMU:?}"
toolchain_bin_dir="${MORPHEUS_LIBVMM_TOOLCHAIN_BIN_DIR:-}"
microkit_config="${MORPHEUS_LIBVMM_MICROKIT_CONFIG:-debug}"
qemu_arg_file="${MORPHEUS_LIBVMM_QEMU_ARG_FILE:-}"
detach="${MORPHEUS_LIBVMM_DETACH:-true}"
result_file="${MORPHEUS_LIBVMM_RESULT_FILE:-${MORPHEUS_SCRIPT_RESULT_FILE:?}}"
manifest_file="${run_dir}/manifest.json"
log_file="${run_dir}/stdout.log"

mkdir -p "${run_dir}"
: > "${log_file}"

args=(
  "-machine" "virt,virtualization=on,secure=off,gic-version=3"
  "-kernel" "${kernel}"
  "-initrd" "${initrd}"
)

if [ -n "${qemu_arg_file}" ] && [ -s "${qemu_arg_file}" ]; then
  mapfile -t extra_args < "${qemu_arg_file}"
  args+=("${extra_args[@]}")
fi

if [ "${detach}" = "true" ]; then
  "${qemu}" "${args[@]}" >> "${log_file}" 2>&1 &
  pid="$!"
  cat > "${manifest_file}" <<EOF
{"tool":"libvmm","status":"running","runDir":"${run_dir}","logFile":"${log_file}","manifest":"${manifest_file}","pid":${pid},"launcherPid":null,"runnerPid":null,"board":"${board}","microkitSdk":"${microkit_sdk}","microkitConfig":"${microkit_config}","libvmmDir":"${libvmm_dir}","toolchainBinDir":"${toolchain_bin_dir}","control":{"type":"monitor","endpoint":"${run_dir}/missing-monitor.sock","graceful_methods":["system_powerdown","quit"]}}
EOF
  cat > "${result_file}" <<EOF
{"details":{"pid":${pid},"detached":true}}
EOF
  exit 0
fi

"${qemu}" "${args[@]}" >> "${log_file}" 2>&1
cat > "${manifest_file}" <<EOF
{"tool":"libvmm","status":"success","runDir":"${run_dir}","logFile":"${log_file}","manifest":"${manifest_file}","pid":null,"launcherPid":null,"runnerPid":null,"board":"${board}","microkitSdk":"${microkit_sdk}","microkitConfig":"${microkit_config}","libvmmDir":"${libvmm_dir}","toolchainBinDir":"${toolchain_bin_dir}"}
EOF
cat > "${result_file}" <<EOF
{"details":{"pid":null,"detached":false}}
EOF
