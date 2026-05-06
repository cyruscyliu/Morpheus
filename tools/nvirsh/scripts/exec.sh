#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/../../.." && pwd)"
state_dir="${MORPHEUS_NVIRSH_STATE_DIR:-${PWD}}"
result_file="${MORPHEUS_NVIRSH_RESULT_FILE:-${MORPHEUS_SCRIPT_RESULT_FILE:?}}"
manifest_file="${state_dir}/manifest.json"
log_file="${state_dir}/stdout.log"
provider_dir="${state_dir}/provider-libvmm"

if [ ! -f "${PWD}/step.json" ]; then
  echo "nvirsh exec is Morpheus-managed only; use morpheus workflow run/inspect/logs/stop/remove" >&2
  exit 1
fi

name="${MORPHEUS_NVIRSH_NAME:-$(basename "${state_dir}")}"
target="${MORPHEUS_NVIRSH_TARGET:-sel4}"
board="${MORPHEUS_NVIRSH_BOARD:-qemu_virt_aarch64}"
qemu="${MORPHEUS_NVIRSH_QEMU:?}"
microkit_sdk="${MORPHEUS_NVIRSH_MICROKIT_SDK:?}"
microkit_version="${MORPHEUS_NVIRSH_MICROKIT_VERSION:-}"
microkit_config="${MORPHEUS_NVIRSH_MICROKIT_CONFIG:-debug}"
toolchain="${MORPHEUS_NVIRSH_TOOLCHAIN:?}"
libvmm_dir="${MORPHEUS_NVIRSH_LIBVMM_DIR:?}"
runtime_contract="${MORPHEUS_NVIRSH_RUNTIME_CONTRACT:-${libvmm_dir}/runtime-contract.json}"
kernel="${MORPHEUS_NVIRSH_KERNEL:?}"
initrd="${MORPHEUS_NVIRSH_INITRD:?}"
detach="${MORPHEUS_NVIRSH_DETACH:-true}"
qemu_arg_file="${MORPHEUS_NVIRSH_QEMU_ARG_FILE:-}"
env_file="${MORPHEUS_NVIRSH_ENV_FILE:-}"

mkdir -p "${state_dir}"
: > "${log_file}"

args=(
  "${repo_root}/apps/morpheus/dist/cli.js"
  "--json"
  "exec"
  "--tool" "libvmm"
  "--runtime-contract" "${runtime_contract}"
  "--action" "qemu"
  "--run-dir" "${provider_dir}"
  "--libvmm-dir" "${libvmm_dir}"
  "--microkit-sdk" "${microkit_sdk}"
  "--board" "${board}"
  "--microkit-config" "${microkit_config}"
  "--kernel" "${kernel}"
  "--initrd" "${initrd}"
  "--qemu" "${qemu}"
  "--toolchain-bin-dir" "${toolchain}/bin"
)

if [ "${detach}" = "true" ]; then
  args+=("--detach")
fi

if [ -n "${qemu_arg_file}" ] && [ -s "${qemu_arg_file}" ]; then
  while IFS= read -r arg; do
    [ -n "${arg}" ] || continue
    args+=("--qemu-arg" "${arg}")
  done < "${qemu_arg_file}"
fi

provider_output="$(node "${args[@]}" 2>&1)" || {
  printf '%s\n' "${provider_output}" >> "${log_file}"
  printf '%s\n' "${provider_output}" >&2
  exit 1
}
printf '%s\n' "${provider_output}" >> "${log_file}"

provider_json="$(printf '%s\n' "${provider_output}" | tail -n 1)"
provider_manifest="$(node -e "const fs=require('fs'); const p=process.argv[1]; process.stdout.write(fs.existsSync(p)?p:'');" "${provider_dir}/manifest.json")"

cat > "${manifest_file}" <<EOF
{
  "schemaVersion": 1,
  "tool": "nvirsh",
  "status": "running",
  "stateDir": "${state_dir}",
  "logFile": "${log_file}",
  "manifest": "${manifest_file}",
  "name": "${name}",
  "target": "${target}",
  "pid": null,
  "prerequisites": {
    "qemu": "${qemu}",
    "microkitSdk": "${microkit_sdk}",
    "microkitVersion": "${microkit_version}",
    "microkitConfig": "${microkit_config}",
    "toolchain": "${toolchain}",
    "libvmmDir": "${libvmm_dir}",
    "runtimeContract": "${runtime_contract}",
    "board": "${board}",
    "kernel": "${kernel}",
    "initrd": "${initrd}",
    "qemuArgsFile": "${qemu_arg_file}",
    "env": {}
  },
  "runtime": {
    "provider": {
      "tool": "libvmm",
      "action": "qemu"
    },
    "providerRun": {
      "provider": "libvmm",
      "run_dir": "${provider_dir}",
      "manifest": "${provider_manifest}",
      "log_file": "${provider_dir}/stdout.log"
    }
  }
}
EOF

cat > "${result_file}" <<EOF
{"details":{"manifest":{"stateDir":"${state_dir}","status":"running"},"state_dir":"${state_dir}"}}
EOF
