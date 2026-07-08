#!/usr/bin/env bash
set -euo pipefail

qemu_path="${MORPHEUS_QEMU_PATH:?}"
kernel_path="${MORPHEUS_QEMU_KERNEL:?}"
initrd_path="${MORPHEUS_QEMU_INITRD:?}"
run_dir="${MORPHEUS_QEMU_RUN_DIR:?}"
append="${MORPHEUS_QEMU_APPEND:-console=ttyAMA0 rdinit=/bin/sh}"
qemu_arg_file="${MORPHEUS_QEMU_QEMU_ARG_FILE:-}"
trace_event_file="${MORPHEUS_QEMU_TRACE_EVENTS_FILE:-${MORPHEUS_QEMU_TRACE_EVENT_FILE:-}}"
workload_script="${MORPHEUS_QEMU_WORKLOAD_SCRIPT:-}"
ssh_port="${MORPHEUS_QEMU_SSH_PORT:-22022}"
boot_timeout="${MORPHEUS_QEMU_BOOT_TIMEOUT_SECONDS:-180}"
shutdown_timeout="${MORPHEUS_QEMU_SHUTDOWN_TIMEOUT_SECONDS:-60}"
detach="${MORPHEUS_QEMU_DETACH:-}"
result_file="${MORPHEUS_QEMU_RESULT_FILE:-${MORPHEUS_SCRIPT_RESULT_FILE:?}}"
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
manifest_file="${run_dir}/manifest.json"
stdout_log="${run_dir}/stdout.log"
stderr_log="${run_dir}/stderr.log"
command_file="${run_dir}/qemu-command.txt"
trace_log="${run_dir}/trace.log"
modified_initrd="${run_dir}/rootfs.ssh.cpio.gz"
ssh_key="${run_dir}/id_ed25519"
ssh_pub="${ssh_key}.pub"
overlay_tree="${run_dir}/initrd-overlay"
overlay_initrd="${run_dir}/rootfs.overlay.cpio.gz"
upload_file="${run_dir}/upload.txt"
download_file="${run_dir}/download.txt"
workload_log="${run_dir}/guest-workload.log"

mkdir -p "${run_dir}"

if [ -n "${workload_script}" ] && [[ "${workload_script}" != /* ]]; then
  workload_script="${repo_root}/${workload_script#./}"
fi

if [ -n "${trace_event_file}" ] && [[ "${trace_event_file}" != /* ]]; then
  trace_event_file="${repo_root}/${trace_event_file#./}"
fi

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "missing host command: $1" >&2
    exit 1
  }
}

use_guest_workload=false
if [ -n "${workload_script}" ]; then
  use_guest_workload=true
fi

args=(
  "-machine" "virt,virtualization=on,gic-version=3"
  "-cpu" "cortex-a57"
  "-m" "1024"
  "-nographic"
  "-kernel" "${kernel_path}"
  "-initrd" "${initrd_path}"
  "-append" "${append}"
)

if [ -n "${trace_event_file}" ] && [ -s "${trace_event_file}" ]; then
  args+=("-trace" "events=${trace_event_file},file=${trace_log}")
fi

if [ -n "${qemu_arg_file}" ] && [ -s "${qemu_arg_file}" ]; then
  mapfile -t extra_args < "${qemu_arg_file}"
  args+=("${extra_args[@]}")
fi

if [ "${use_guest_workload}" = false ] && [ "${detach}" = "true" ]; then
  "${qemu_path}" "${args[@]}" < /dev/null &
  pid="$!"
  cat > "${manifest_file}" <<EOF
{"schemaVersion":1,"tool":"qemu","command":"exec","status":"running","run_dir":"${run_dir}","pid":${pid},"detached":true}
EOF
  cat > "${result_file}" <<EOF
{"details":{"pid":${pid},"detached":true}}
EOF
  exit 0
fi

if [ "${use_guest_workload}" = false ] && [ -z "${trace_event_file}" ]; then
  exit_code=0
  "${qemu_path}" "${args[@]}" || exit_code="$?"

  if [ "${exit_code}" != "0" ]; then
    exit "${exit_code}"
  fi

  cat > "${manifest_file}" <<EOF
{"schemaVersion":1,"tool":"qemu","command":"exec","status":"success","run_dir":"${run_dir}","pid":null,"detached":false}
EOF
  cat > "${result_file}" <<EOF
{"details":{"pid":null,"detached":false}}
EOF
  exit 0
fi

if [ "${use_guest_workload}" = false ]; then
  printf '%q ' "${qemu_path}" "${args[@]}" > "${command_file}"
  printf '\n' >> "${command_file}"

  exit_code=0
  "${qemu_path}" "${args[@]}" >"${stdout_log}" 2>"${stderr_log}" || exit_code="$?"

  if [ "${exit_code}" != "0" ]; then
    exit "${exit_code}"
  fi

  cat > "${manifest_file}" <<EOF
{"schemaVersion":1,"tool":"qemu","command":"exec","status":"success","run_dir":"${run_dir}","pid":null,"detached":false}
EOF

  node - "${result_file}" "${run_dir}" "${stdout_log}" "${stderr_log}" "${manifest_file}" "${command_file}" "${trace_log}" <<'EOF'
const fs = require("fs");
const path = require("path");

const [resultFileArg, runDirArg, stdoutArg, stderrArg, manifestArg, commandArg, traceArg] =
  process.argv.slice(2);
const payload = {
  details: {
    pid: null,
    detached: false,
    run_dir: path.resolve(runDirArg),
    log_file: path.resolve(stdoutArg),
    stderr_log: path.resolve(stderrArg),
    manifest: path.resolve(manifestArg),
    command_file: path.resolve(commandArg)
  },
  artifacts: [
    { path: "qemu-stdout-log", location: path.resolve(stdoutArg) },
    { path: "qemu-stderr-log", location: path.resolve(stderrArg) },
    { path: "command-file", location: path.resolve(commandArg) }
  ]
};

if (fs.existsSync(traceArg)) {
  payload.details.trace_log = path.resolve(traceArg);
  payload.artifacts.push({
    path: "trace-log",
    location: path.resolve(traceArg)
  });
}

fs.writeFileSync(path.resolve(resultFileArg), JSON.stringify(payload, null, 2) + "\n");
EOF
  exit 0
fi

if [ "${detach}" = "true" ]; then
  echo "detach=true is not supported with workload-script" >&2
  exit 1
fi

require_cmd ssh
require_cmd scp
require_cmd ssh-keygen
require_cmd cpio
require_cmd gzip
require_cmd sshpass

if [ ! -f "${ssh_key}" ]; then
  ssh-keygen -q -t ed25519 -N "" -f "${ssh_key}" >/dev/null
fi

rm -rf "${overlay_tree}"
mkdir -p "${overlay_tree}/root/.ssh"
chmod 700 "${overlay_tree}/root/.ssh"
cp "${ssh_pub}" "${overlay_tree}/root/.ssh/authorized_keys"
chmod 600 "${overlay_tree}/root/.ssh/authorized_keys"
(
  cd "${overlay_tree}"
  find . -print0 | cpio --null -o -H newc --quiet | gzip -9 > "${overlay_initrd}"
)
cat "${initrd_path}" "${overlay_initrd}" > "${modified_initrd}"

for idx in "${!args[@]}"; do
  if [ "${args[$idx]}" = "${initrd_path}" ]; then
    args[$idx]="${modified_initrd}"
  fi
done

ssh_key_base=(
  ssh
  -i "${ssh_key}"
  -o BatchMode=yes
  -o StrictHostKeyChecking=no
  -o UserKnownHostsFile=/dev/null
  -o ConnectTimeout=5
  -p "${ssh_port}"
  root@127.0.0.1
)
ssh_pass_base=(
  sshpass -p root
  ssh
  -o PreferredAuthentications=password
  -o PubkeyAuthentication=no
  -o StrictHostKeyChecking=no
  -o UserKnownHostsFile=/dev/null
  -o ConnectTimeout=5
  -p "${ssh_port}"
  root@127.0.0.1
)
scp_key_base=(
  scp
  -O
  -i "${ssh_key}"
  -o BatchMode=yes
  -o StrictHostKeyChecking=no
  -o UserKnownHostsFile=/dev/null
  -o ConnectTimeout=5
  -P "${ssh_port}"
)
scp_pass_base=(
  sshpass -p root
  scp
  -O
  -o PreferredAuthentications=password
  -o PubkeyAuthentication=no
  -o StrictHostKeyChecking=no
  -o UserKnownHostsFile=/dev/null
  -o ConnectTimeout=5
  -P "${ssh_port}"
)
ssh_auth_mode=""

printf '%q ' "${qemu_path}" "${args[@]}" > "${command_file}"
printf '\n' >> "${command_file}"

cleanup() {
  local status="$?"
  if [ -f "${run_dir}/qemu.pid" ]; then
    local pid
    pid="$(cat "${run_dir}/qemu.pid" 2>/dev/null || true)"
    if [ -n "${pid}" ] && kill -0 "${pid}" >/dev/null 2>&1; then
      kill "${pid}" >/dev/null 2>&1 || true
      sleep 2
      kill -9 "${pid}" >/dev/null 2>&1 || true
    fi
  fi
  exit "${status}"
}
trap cleanup EXIT

: > "${stdout_log}"
: > "${stderr_log}"
: > "${workload_log}"
"${qemu_path}" "${args[@]}" >"${stdout_log}" 2>"${stderr_log}" &
qemu_pid="$!"
echo "${qemu_pid}" > "${run_dir}/qemu.pid"

wait_for_ssh() {
  local deadline=$((SECONDS + boot_timeout))
  while [ "${SECONDS}" -lt "${deadline}" ]; do
    if ! kill -0 "${qemu_pid}" >/dev/null 2>&1; then
      echo "qemu exited before ssh became available" >&2
      return 1
    fi
    if "${ssh_key_base[@]}" true >/dev/null 2>&1; then
      ssh_auth_mode="key"
      return 0
    fi
    if "${ssh_pass_base[@]}" true >/dev/null 2>&1; then
      ssh_auth_mode="password"
      return 0
    fi
    sleep 2
  done
  echo "timed out waiting for guest ssh" >&2
  return 1
}

ssh_guest() {
  if [ "${ssh_auth_mode}" = "key" ]; then
    "${ssh_key_base[@]}" "$@"
    return
  fi
  "${ssh_pass_base[@]}" "$@"
}

scp_to_guest() {
  if [ "${ssh_auth_mode}" = "key" ]; then
    "${scp_key_base[@]}" "$1" "$2"
    return
  fi
  "${scp_pass_base[@]}" "$1" "$2"
}

scp_from_guest() {
  if [ "${ssh_auth_mode}" = "key" ]; then
    "${scp_key_base[@]}" "$1" "$2"
    return
  fi
  "${scp_pass_base[@]}" "$1" "$2"
}

wait_for_exit() {
  local deadline=$((SECONDS + shutdown_timeout))
  while [ "${SECONDS}" -lt "${deadline}" ]; do
    if ! kill -0 "${qemu_pid}" >/dev/null 2>&1; then
      return 0
    fi
    sleep 2
  done
  return 1
}

wait_for_ssh

printf 'qemu guest workload upload\n' > "${upload_file}"
scp_to_guest "${upload_file}" root@127.0.0.1:/root/mmio-upload.txt >>"${workload_log}" 2>&1

ssh_guest "sh -s" < "${workload_script}" >>"${workload_log}" 2>&1

scp_from_guest root@127.0.0.1:/root/mmio-upload.copy "${download_file}" >>"${workload_log}" 2>&1 || true
ssh_guest "sync; poweroff -f" >>"${workload_log}" 2>&1 || true

if ! wait_for_exit; then
  echo "guest did not shut down cleanly; killing qemu" >>"${workload_log}"
  kill "${qemu_pid}" >/dev/null 2>&1 || true
  sleep 2
  kill -9 "${qemu_pid}" >/dev/null 2>&1 || true
fi

cat > "${manifest_file}" <<EOF
{
  "schemaVersion": 1,
  "tool": "qemu",
  "command": "exec",
  "status": "success",
  "run_dir": "${run_dir}",
  "pid": null,
  "detached": false
}
EOF

node - "${result_file}" "${run_dir}" "${stdout_log}" "${stderr_log}" "${manifest_file}" "${workload_log}" "${modified_initrd}" "${command_file}" "${trace_log}" <<'EOF'
const fs = require("fs");
const path = require("path");

const [resultFileArg, runDirArg, stdoutArg, stderrArg, manifestArg, workloadArg,
  initrdArg, commandArg, traceArg] = process.argv.slice(2);
const payload = {
  details: {
    pid: null,
    detached: false,
    run_dir: path.resolve(runDirArg),
    log_file: path.resolve(stdoutArg),
    stderr_log: path.resolve(stderrArg),
    manifest: path.resolve(manifestArg),
    workload_log: path.resolve(workloadArg),
    modified_initrd: path.resolve(initrdArg),
    command_file: path.resolve(commandArg)
  },
  artifacts: [
    { path: "qemu-stdout-log", location: path.resolve(stdoutArg) },
    { path: "qemu-stderr-log", location: path.resolve(stderrArg) },
    { path: "guest-workload-log", location: path.resolve(workloadArg) },
    { path: "modified-initrd", location: path.resolve(initrdArg) },
    { path: "command-file", location: path.resolve(commandArg) }
  ]
};

if (fs.existsSync(traceArg)) {
  payload.details.trace_log = path.resolve(traceArg);
  payload.artifacts.push({
    path: "trace-log",
    location: path.resolve(traceArg)
  });
}

fs.writeFileSync(path.resolve(resultFileArg), JSON.stringify(payload, null, 2) + "\n");
EOF

trap - EXIT
