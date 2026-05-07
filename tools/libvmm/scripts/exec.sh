#!/usr/bin/env bash
set -euo pipefail

run_dir="${MORPHEUS_LIBVMM_RUN_DIR:?}"
runtime_contract="${MORPHEUS_LIBVMM_RUNTIME_CONTRACT:?}"
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
example_dir="$(node -e "const fs=require('fs'); const m=JSON.parse(fs.readFileSync(process.argv[1],'utf8')); process.stdout.write(String(m.exampleDir||m.actions?.qemu?.cwd||''));" "${runtime_contract}")"

mkdir -p "${run_dir}"
: > "${log_file}"

if [ -z "${example_dir}" ] || [ ! -d "${example_dir}" ]; then
  echo "missing libvmm example directory from runtime contract: ${runtime_contract}" >&2
  exit 1
fi

qemu_trace_args=""
if [ -n "${qemu_arg_file}" ] && [ -s "${qemu_arg_file}" ]; then
  mapfile -t extra_args < "${qemu_arg_file}"
  qemu_trace_args="${extra_args[*]}"
fi

if [ -n "${toolchain_bin_dir}" ]; then
  export PATH="${PATH}:${toolchain_bin_dir}"
fi

make_cmd=(
  make
  -C "${example_dir}"
  "MICROKIT_BOARD=${board}"
  "MICROKIT_SDK=${microkit_sdk}"
  "MICROKIT_CONFIG=${microkit_config}"
  "LINUX=${kernel}"
  "INITRD=${initrd}"
  "QEMU=${qemu}"
)

if [ -n "${qemu_trace_args}" ]; then
  make_cmd+=("QEMU_TRACE_ARGS=${qemu_trace_args}")
fi

make_cmd+=(qemu)

if [ "${detach}" = "true" ]; then
  "${make_cmd[@]}" >> "${log_file}" 2>&1 &
  pid="$!"
  cat > "${manifest_file}" <<EOF
{"tool":"libvmm","status":"running","runDir":"${run_dir}","logFile":"${log_file}","manifest":"${manifest_file}","pid":${pid},"launcherPid":null,"runnerPid":null,"board":"${board}","microkitSdk":"${microkit_sdk}","microkitConfig":"${microkit_config}","libvmmDir":"${libvmm_dir}","toolchainBinDir":"${toolchain_bin_dir}","exampleDir":"${example_dir}","control":{"type":"process","graceful_methods":["SIGTERM"]}}
EOF
  cat > "${result_file}" <<EOF
{"details":{"pid":${pid},"detached":true}}
EOF
  exit 0
fi

"${make_cmd[@]}" >> "${log_file}" 2>&1
cat > "${manifest_file}" <<EOF
{"tool":"libvmm","status":"success","runDir":"${run_dir}","logFile":"${log_file}","manifest":"${manifest_file}","pid":null,"launcherPid":null,"runnerPid":null,"board":"${board}","microkitSdk":"${microkit_sdk}","microkitConfig":"${microkit_config}","libvmmDir":"${libvmm_dir}","toolchainBinDir":"${toolchain_bin_dir}","exampleDir":"${example_dir}"}
EOF
cat > "${result_file}" <<EOF
{"details":{"pid":null,"detached":false}}
EOF
