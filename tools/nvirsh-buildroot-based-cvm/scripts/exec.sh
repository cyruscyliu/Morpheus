#!/usr/bin/env bash
set -euo pipefail

install_dir="${MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_INSTALL_DIR:?}"
run_dir="${MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_RUN_DIR:?}"
phase="${MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_PHASE:?}"
detach="${MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_DETACH:-false}"
build_dir_key="${MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_BUILD_DIR_KEY:-default}"
result_file="${MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_RESULT_FILE:-${MORPHEUS_SCRIPT_RESULT_FILE:?}}"
state_file="${install_dir}/state.json"
manifest_file="${run_dir}/manifest.json"
stdout_log="${run_dir}/stdout.log"
stderr_log="${run_dir}/stderr.log"
l1_console_log="${run_dir}/l1-console.log"
l1_pid_file="${run_dir}/l1.pid"
l2_launch_marker_log="${run_dir}/launch-l2.marker"
l2_launcher_stdout_log="${run_dir}/l2-launcher.stdout.log"
l2_launcher_stderr_log="${run_dir}/l2-launcher.stderr.log"
l2_console_log="${run_dir}/l2-console.log"

if [ "${phase}" != "launch" ]; then
  echo "unsupported buildroot-based CVM exec phase: ${phase}" >&2
  exit 1
fi
if [ "${detach}" = "true" ]; then
  echo "detached buildroot-based CVM exec is not implemented" >&2
  exit 1
fi
if [ ! -f "${state_file}" ]; then
  echo "missing prepared state: ${state_file}" >&2
  exit 1
fi

mkdir -p "${run_dir}"

mapfile -d '' -t runtime_fields < <(
  node - "${state_file}" "${run_dir}" <<'NODE'
const fs = require("fs");
const path = require("path");
const [stateFile, runDir] = process.argv.slice(2);
const state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
const host = state.hostLaunch || {};
const l1 = state.layeredState && state.layeredState.l1 ? state.layeredState.l1 : {};
const shareDir = l1.shareDir || "";
const runtimeShareDir = path.join(shareDir, "morpheus-l2-runtime");
const values = [
  String(host.qemu || ""),
  String(host.firmware || ""),
  String(host.kernel || ""),
  String(host.machine || "virt,virtualization=on,gic-version=3,its=on"),
  String(host.cpu || "max,x-rme=on,sme=off,pauth-impdef=on,sve=off"),
  String(host.memory || "4096"),
  String(host.cpus || "1"),
  String(host.accel || "tcg"),
  String(Boolean(host.enableKvm)),
  String(l1.rootfs || ""),
  String(shareDir),
  String(l1.launchScriptHoststack || ""),
  String(runtimeShareDir),
];
process.stdout.write(values.join("\0"));
process.stdout.write("\0");
NODE
)

host_qemu="${runtime_fields[0]}"
firmware="${runtime_fields[1]}"
l1_kernel="${runtime_fields[2]}"
l1_machine="${runtime_fields[3]}"
l1_cpu="${runtime_fields[4]}"
l1_memory="${runtime_fields[5]}"
l1_cpus="${runtime_fields[6]}"
l1_accel="${runtime_fields[7]}"
l1_enable_kvm="${runtime_fields[8]}"
hoststack_rootfs="${runtime_fields[9]}"
hoststack_share_dir="${runtime_fields[10]}"
hoststack_launch_script_local="${runtime_fields[11]}"
l2_runtime_share_dir="${runtime_fields[12]}"

require_file() {
  local path="$1"
  local description="$2"
  if [ ! -f "${path}" ]; then
    echo "missing ${description}: ${path}" >&2
    exit 1
  fi
}

wait_for_cvm_l2_ready() {
  local console_log="$1"
  local pid="$2"
  local timeout_seconds="$3"
  local deadline=$((SECONDS + timeout_seconds))
  while [ "${SECONDS}" -lt "${deadline}" ]; do
    if [ -f "${console_log}" ] && LC_ALL=C grep -a -q -- 'buildroot login:' "${console_log}" 2>/dev/null; then
      return 0
    fi
    if [ -f "${l2_launch_marker_log}" ] && LC_ALL=C grep -a -q -- 'qemu-exit-status=' "${l2_launch_marker_log}" 2>/dev/null; then
      return 1
    fi
    if ! kill -0 "${pid}" 2>/dev/null; then
      return 1
    fi
    sleep 2
  done
  return 124
}

failure_detail() {
  local detail=""
  if [ -f "${l2_launcher_stderr_log}" ]; then
    detail="$(tail -n 1 "${l2_launcher_stderr_log}" | tr -d '\r')"
  fi
  if [ -z "${detail}" ] && [ -f "${l2_launch_marker_log}" ]; then
    detail="$(
      LC_ALL=C grep -a -- 'qemu-exit-status=' "${l2_launch_marker_log}" 2>/dev/null | \
        tail -n 1 | tr -d '\r'
    )"
  fi
  printf '%s' "${detail}"
}

normalize_console_log() {
  local logfile="$1"
  if [ ! -f "${logfile}" ]; then
    return 0
  fi
  perl -0pi -e 's/\r\r\n/\n/g; s/\r\n/\n/g; s/\r/\n/g;' "${logfile}"
}

write_manifest() {
  local status="$1"
  local exit_code="$2"
  local error_message="$3"
  local l1_pid="$4"
  node - "${state_file}" "${manifest_file}" "${run_dir}" "${status}" "${exit_code}" "${error_message}" "${l1_pid}" "${stdout_log}" "${stderr_log}" "${l1_console_log}" "${l2_console_log}" "${l2_launcher_stdout_log}" "${l2_launcher_stderr_log}" "${l2_launch_marker_log}" "${l2_runtime_share_dir}" <<'NODE'
const fs = require("fs");
const [
  stateFile,
  manifestFile,
  runDir,
  status,
  exitCodeRaw,
  errorMessage,
  l1PidRaw,
  stdoutLog,
  stderrLog,
  l1ConsoleLog,
  l2ConsoleLog,
  l2LauncherStdoutLog,
  l2LauncherStderrLog,
  l2LaunchMarkerLog,
  l2RuntimeShareDir,
] = process.argv.slice(2);
const state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
const now = new Date().toISOString();
const exitCode = exitCodeRaw === "" ? null : Number(exitCodeRaw);
const l1Pid = l1PidRaw === "" ? null : Number(l1PidRaw);
const manifest = {
  schemaVersion: 1,
  tool: "nvirsh-buildroot-based-cvm",
  buildDirKey: state.buildDirKey,
  buildDir: state.buildDir,
  installDir: state.installDir,
  runDir,
  status,
  currentPhase: status === "running" ? "launch" : "done",
  hostLaunch: state.hostLaunch || null,
  layeredState: state.layeredState || null,
  phases: {
    ...(state.phases || {}),
    launch: status === "running" ? "running" : status,
  },
  runtime: {
    l1: {
      pid: Number.isInteger(l1Pid) ? l1Pid : null,
      consoleLog: l1ConsoleLog,
    },
    l2: {
      runtimeDir: l2RuntimeShareDir,
      consoleLog: l2ConsoleLog,
      launcherLogs: {
        stdout: l2LauncherStdoutLog,
        stderr: l2LauncherStderrLog,
      },
      launchMarker: l2LaunchMarkerLog,
    },
  },
  logs: {
    stdout: stdoutLog,
    stderr: stderrLog,
    l1Console: l1ConsoleLog,
    l2Console: l2ConsoleLog,
    l2LauncherStdout: l2LauncherStdoutLog,
    l2LauncherStderr: l2LauncherStderrLog,
    l2LaunchMarker: l2LaunchMarkerLog,
  },
  createdAt: now,
  updatedAt: now,
};
if (status !== "running") {
  manifest.completedAt = now;
}
if (status === "error") {
  manifest.errorMessage = errorMessage || "buildroot-based CVM launch failed";
}
if (Number.isInteger(exitCode)) {
  manifest.exitCode = exitCode;
}
fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
NODE
}

require_file "${host_qemu}" "host qemu"
require_file "${firmware}" "l1 firmware"
require_file "${l1_kernel}" "l1 kernel"
require_file "${hoststack_rootfs}" "l1 host stack rootfs"
require_file "${hoststack_launch_script_local}" "host-stack launch script"
if [ ! -d "${hoststack_share_dir}" ]; then
  echo "missing host share directory: ${hoststack_share_dir}" >&2
  exit 1
fi

rm -rf "${l2_runtime_share_dir}"
mkdir -p "${l2_runtime_share_dir}"
rm -f \
  "${manifest_file}" \
  "${stdout_log}" \
  "${stderr_log}" \
  "${l1_console_log}" \
  "${l1_pid_file}" \
  "${l2_launch_marker_log}" \
  "${l2_launcher_stdout_log}" \
  "${l2_launcher_stderr_log}" \
  "${l2_console_log}"

ln -sfn "${l2_runtime_share_dir}/launch-l2.marker" "${l2_launch_marker_log}"
ln -sfn "${l2_runtime_share_dir}/qemu.stdout.log" "${l2_launcher_stdout_log}"
ln -sfn "${l2_runtime_share_dir}/qemu.stderr.log" "${l2_launcher_stderr_log}"
ln -sfn "${l2_runtime_share_dir}/qemu.stdout.log" "${l2_console_log}"

l1_qemu_cmd=(
  "${host_qemu}"
  -nodefaults
  -display none
  -serial mon:stdio
  -action panic=exit-failure
  -netdev user,id=net0
  -device virtio-net-pci,netdev=net0
  -machine "${l1_machine}"
  -cpu "${l1_cpu}"
  -m "${l1_memory}"
  -smp "${l1_cpus}"
  -bios "${firmware}"
  -kernel "${l1_kernel}"
  -drive "format=raw,file=${hoststack_rootfs},if=virtio"
  -append "nokaslr root=/dev/vda rw init=/init -- /host/launch-l2-hoststack.sh"
  -virtfs "local,path=${hoststack_share_dir},mount_tag=host,security_model=mapped,readonly=off"
)
if [ -n "${l1_accel}" ]; then
  l1_qemu_cmd+=(-accel "${l1_accel}")
fi
if [ "${l1_enable_kvm}" = "true" ]; then
  l1_qemu_cmd+=(-enable-kvm)
fi

printf '[nvirsh-buildroot-based-cvm] launching l1 host stack\n' | tee -a "${stdout_log}"
"${l1_qemu_cmd[@]}" >> "${l1_console_log}" 2>&1 < /dev/null &
l1_pid="$!"
printf '%s\n' "${l1_pid}" > "${l1_pid_file}"
write_manifest "running" "" "" "${l1_pid}"

set +e
wait_for_cvm_l2_ready "${l2_console_log}" "${l1_pid}" 2100
launch_wait_status="$?"
set -e

if [ "${launch_wait_status}" -eq 0 ]; then
  printf '[nvirsh-buildroot-based-cvm] observed l2 buildroot login prompt\n' | tee -a "${stdout_log}"
  if kill -0 "${l1_pid}" 2>/dev/null; then
    kill "${l1_pid}" 2>/dev/null || true
    set +e
    wait "${l1_pid}"
    set -e
  fi
  normalize_console_log "${stdout_log}"
  normalize_console_log "${stderr_log}"
  normalize_console_log "${l1_console_log}"
  normalize_console_log "${l2_launcher_stdout_log}"
  normalize_console_log "${l2_launcher_stderr_log}"
  normalize_console_log "${l2_console_log}"
  write_manifest "success" "0" "" ""
  cat > "${result_file}" <<EOF
{"details":{"run_dir":"${run_dir}","manifest":"${manifest_file}","phase":"${phase}","build_dir_key":"${build_dir_key}","detached":false,"l1_console_log":"${l1_console_log}","l2_console_log":"${l2_console_log}","l2_launcher_stdout_log":"${l2_launcher_stdout_log}","l2_launcher_stderr_log":"${l2_launcher_stderr_log}","l2_launch_marker":"${l2_launch_marker_log}"}}
EOF
  exit 0
fi

if kill -0 "${l1_pid}" 2>/dev/null; then
  kill "${l1_pid}" 2>/dev/null || true
  set +e
  wait "${l1_pid}"
  l1_exit_status="$?"
  set -e
else
  l1_exit_status=1
fi
if [ "${l1_exit_status}" -eq 143 ] || [ "${l1_exit_status}" -eq 137 ]; then
  l1_exit_status=1
fi

normalize_console_log "${stdout_log}"
normalize_console_log "${stderr_log}"
normalize_console_log "${l1_console_log}"
normalize_console_log "${l2_launcher_stdout_log}"
normalize_console_log "${l2_launcher_stderr_log}"
normalize_console_log "${l2_console_log}"
write_manifest "error" "${l1_exit_status}" "$(failure_detail)"
exit "${l1_exit_status}"
