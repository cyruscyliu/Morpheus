#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/../../_shared/scripts/parallelism.sh"

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
l1_boot_dir="${run_dir}/l1-boot-fat"

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
const l2 = state.layeredState && state.layeredState.l2 ? state.layeredState.l2 : {};
const buildrootImages = l2.buildrootImages || {};
const values = [
  String(host.qemu || ""),
  String(host.firmwareA || host.firmware || ""),
  String(host.firmwareB || ""),
  String(host.kernel || ""),
  String(host.machine || "sbsa-ref"),
  String(host.cpu || "max,x-rme=on,sme=off,pauth-impdef=on,sve=off"),
  String(host.memory || "4096"),
  String(host.cpus || "1"),
  String(host.accel || ""),
  String(Boolean(host.enableKvm)),
  String(host.cmdline || "root=/dev/vda console=ttyAMA0"),
  String(l1.rootfs || ""),
  String(shareDir),
  String(l1.launchScriptHoststack || ""),
  String(runtimeShareDir),
  String(buildrootImages.launchMode || "direct-qemu"),
];
process.stdout.write(values.join("\0"));
process.stdout.write("\0");
NODE
)

host_qemu="${runtime_fields[0]}"
firmware_a="${runtime_fields[1]}"
firmware_b="${runtime_fields[2]}"
l1_kernel="${runtime_fields[3]}"
l1_machine="${runtime_fields[4]}"
l1_cpu="${runtime_fields[5]}"
l1_memory="${runtime_fields[6]}"
l1_cpus="${runtime_fields[7]}"
l1_accel="${runtime_fields[8]}"
l1_enable_kvm="${runtime_fields[9]}"
l1_cmdline="${runtime_fields[10]}"
hoststack_rootfs="${runtime_fields[11]}"
hoststack_share_dir="${runtime_fields[12]}"
hoststack_launch_script_local="${runtime_fields[13]}"
l2_runtime_share_dir="${runtime_fields[14]}"
l2_launch_mode="${runtime_fields[15]}"
if [ -z "${l1_cpus}" ]; then
  l1_cpus="$(morpheus_default_cvm_l1_qemu_cpus)"
fi
if [ -z "${l1_memory}" ]; then
  l1_memory="$(morpheus_default_cvm_l1_qemu_memory_mb)"
fi
l2_rsi_evidence_marker="MORPHEUS_RSI_EVIDENCE:"
l2_rsi_evidence_missing_marker="MORPHEUS_RSI_EVIDENCE_MISSING"

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
  local require_rsi_evidence="false"
  if [ "${l2_launch_mode}" = "linaro-gen-run-vmm" ]; then
    require_rsi_evidence="true"
  fi
  while [ "${SECONDS}" -lt "${deadline}" ]; do
    if [ -f "${console_log}" ]; then
      if [ "${require_rsi_evidence}" = "true" ] && LC_ALL=C grep -a -q -- "${l2_rsi_evidence_missing_marker}" "${console_log}" 2>/dev/null; then
        return 2
      fi
      if LC_ALL=C grep -a -q -- 'buildroot login:' "${console_log}" 2>/dev/null; then
        if [ "${require_rsi_evidence}" != "true" ] || LC_ALL=C grep -a -q -- "${l2_rsi_evidence_marker}" "${console_log}" 2>/dev/null; then
          return 0
        fi
      fi
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
  if [ "${l2_launch_mode}" = "linaro-gen-run-vmm" ] && [ -f "${l2_console_log}" ] && LC_ALL=C grep -a -q -- "${l2_rsi_evidence_missing_marker}" "${l2_console_log}" 2>/dev/null; then
    printf '%s' "guest RSI evidence missing from realm console"
    return 0
  fi
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
  local l1_pid="${4:-}"
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
const l2ConsoleText = fs.existsSync(l2ConsoleLog)
  ? fs.readFileSync(l2ConsoleLog, "utf8")
  : "";
const guestRsiEvidence = l2ConsoleText
  .split(/\r?\n/)
  .find((line) => line.includes("MORPHEUS_RSI_EVIDENCE:")) || null;
const guestRsiEvidenceMissing = l2ConsoleText.includes("MORPHEUS_RSI_EVIDENCE_MISSING");
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
      rsiEvidence: guestRsiEvidence,
      rsiEvidenceMissing: guestRsiEvidenceMissing,
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
require_file "${firmware_a}" "l1 firmware a"
if [ -n "${firmware_b}" ]; then
  require_file "${firmware_b}" "l1 firmware b"
fi
require_file "${l1_kernel}" "l1 kernel"
require_file "${hoststack_rootfs}" "l1 host stack rootfs"
require_file "${hoststack_launch_script_local}" "host-stack launch script"
if [ ! -d "${hoststack_share_dir}" ]; then
  echo "missing host share directory: ${hoststack_share_dir}" >&2
  exit 1
fi

rm -rf "${l2_runtime_share_dir}"
mkdir -p "${l2_runtime_share_dir}"
rm -rf "${l1_boot_dir}"
mkdir -p "${l1_boot_dir}"
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

l1_launch_cmd="mount -t 9p -o trans=virtio,version=9p2000.L host /mnt && exec /mnt/launch-l2-hoststack.sh"
l1_boot_cmdline="${l1_cmdline} init=/bin/sh -- -c \"${l1_launch_cmd}\""

cp -f "${l1_kernel}" "${l1_boot_dir}/Image"
cat > "${l1_boot_dir}/startup.nsh" <<EOF
mode 100 31
pci
fs0:\Image ${l1_boot_cmdline}
reset -c
EOF

l1_qemu_cmd=(
  "${host_qemu}"
  -display none
  -nographic
  -nodefaults
  -serial mon:stdio
  -action panic=exit-failure
  -machine "${l1_machine}"
  -cpu "${l1_cpu}"
  -m "${l1_memory}"
  -smp "${l1_cpus}"
  -drive "format=raw,id=hd0,if=none,file=${hoststack_rootfs}"
  -device virtio-blk-pci,drive=hd0
  -device virtio-9p-pci,fsdev=hostshare,mount_tag=host
  -fsdev "local,security_model=none,path=${hoststack_share_dir},id=hostshare"
  -device virtio-net-pci,netdev=net0
  -netdev user,id=net0
)
if [ -n "${firmware_b}" ]; then
  l1_qemu_cmd+=(
    -drive "file=${firmware_a},format=raw,if=pflash"
    -drive "file=${firmware_b},format=raw,if=pflash"
    -drive "file=fat:rw:${l1_boot_dir},format=raw"
  )
else
  l1_qemu_cmd+=(
    -bios "${firmware_a}"
    -kernel "${l1_kernel}"
    -append "${l1_boot_cmdline}"
  )
fi
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
  if [ "${l2_launch_mode}" = "linaro-gen-run-vmm" ]; then
    printf '[nvirsh-buildroot-based-cvm] observed l2 guest RSI evidence and buildroot login prompt\n' | tee -a "${stdout_log}"
  else
    printf '[nvirsh-buildroot-based-cvm] observed l2 buildroot login prompt\n' | tee -a "${stdout_log}"
  fi
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
if [ "${l1_exit_status}" -eq 0 ]; then
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
failure_message="$(failure_detail)"
if [ -z "${failure_message}" ]; then
  if [ "${launch_wait_status}" -eq 124 ]; then
    if [ "${l2_launch_mode}" = "linaro-gen-run-vmm" ]; then
      failure_message="timed out waiting for guest RSI evidence and realm login prompt"
    else
      failure_message="timed out waiting for l2 buildroot login prompt"
    fi
  elif [ "${launch_wait_status}" -eq 2 ]; then
    failure_message="guest RSI evidence missing from realm console"
  fi
fi
write_manifest "error" "${l1_exit_status}" "${failure_message}"
exit "${l1_exit_status}"
