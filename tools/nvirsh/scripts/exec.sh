#!/usr/bin/env bash
set -euo pipefail

source_dir="${MORPHEUS_NVIRSH_SOURCE:?}"
run_dir="${MORPHEUS_NVIRSH_RUN_DIR:?}"
install_dir="${MORPHEUS_NVIRSH_INSTALL_DIR:?}"
profile_name="${MORPHEUS_NVIRSH_BUILD_VERSION:-default}"
build_dir_key="${MORPHEUS_NVIRSH_BUILD_DIR_KEY:-${profile_name}}"
phase="${MORPHEUS_NVIRSH_PHASE:?}"
detach="${MORPHEUS_NVIRSH_DETACH:-false}"
result_file="${MORPHEUS_NVIRSH_RESULT_FILE:-${MORPHEUS_SCRIPT_RESULT_FILE:?}}"
profile_file="${source_dir}/profile.json"
state_file="${install_dir}/state.json"
build_dir="${install_dir}/../build"
manifest_file="${run_dir}/manifest.json"
stdout_log="${run_dir}/stdout.log"
stderr_log="${run_dir}/stderr.log"
runtime_script="${run_dir}/runtime-supervisor.sh"

mkdir -p "${run_dir}"

if [ "${phase}" != "launch" ]; then
  echo "unsupported nvirsh exec phase: ${phase}" >&2
  exit 1
fi
if [ ! -f "${state_file}" ]; then
  echo "missing prepared nvirsh state: ${state_file}" >&2
  exit 1
fi

mapfile -d '' -t runtime_fields < <(
  node - "${state_file}" "${profile_file}" "${install_dir}" "${build_dir}" "${build_dir_key}" "${run_dir}" <<'NODE'
const fs = require("fs");
const path = require("path");
const [stateFile, profileFile, installDir, buildDir, buildDirKey, runDir] =
  process.argv.slice(2);
const state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
const profile = JSON.parse(fs.readFileSync(profileFile, "utf8"));

function argValue(layer, key) {
  const args = Array.isArray(profile[layer] && profile[layer].launcherArgs)
    ? profile[layer].launcherArgs
    : [];
  for (let index = 0; index < args.length - 1; index += 1) {
    if (args[index] === key) {
      return String(args[index + 1]);
    }
  }
  return "";
}

function ensureCpuFlag(cpu, flag, value) {
  if (cpu.includes(`${flag}=`)) {
    return cpu;
  }
  return `${cpu},${flag}=${value}`;
}

const l2Cvm = Boolean(state.layeredState && state.layeredState.l2 && state.layeredState.l2.cvm);
let l1Cpu = argValue("l1", "-cpu") || "cortex-a57";
let l1Memory = argValue("l1", "-m") || "8192";
let l1Cpus = argValue("l1", "-smp") || "4";
const l1SshPort = String((profile.l1 && profile.l1.sshPort) || 2222);
const l1ReplaceKernel = Boolean(profile.l1 && profile.l1.replaceKernel);
let l1Machine = "virt,virtualization=on,gic-version=3";
let l1Accel = "";
let l1EnableKvm = "false";

if (l2Cvm) {
  l1Machine = "virt,acpi=off,virtualization=on,secure=on,gic-version=3,iommu=smmuv3";
  l1Accel = "tcg";
  l1Memory = "2048";
  l1Cpus = "1";
  if (!(l1Cpu === "max" || l1Cpu.startsWith("max,"))) {
    l1Cpu = "max";
  }
  l1Cpu = ensureCpuFlag(l1Cpu, "x-rme", "on");
  l1Cpu = ensureCpuFlag(l1Cpu, "sme", "off");
  l1Cpu = ensureCpuFlag(l1Cpu, "pauth-impdef", "on");
  l1Cpu = ensureCpuFlag(l1Cpu, "sve", "off");
}

const workspaceRoot = path.resolve(installDir, "..", "..", "..", "..", "..");
const stackFirmware = path.join(buildDir, "l1", "host-boot", "flash.bin");
const recordedQemu =
  state.hostLaunch && state.hostLaunch.qemu
    ? String(state.hostLaunch.qemu)
    : "";
const recordedFirmware =
  fs.existsSync(stackFirmware)
    ? stackFirmware
    : (
        state.hostLaunch && state.hostLaunch.firmware
          ? String(state.hostLaunch.firmware)
          : ""
      );
const derivedQemuFromFirmware = recordedFirmware
  ? path.join(
      path.dirname(path.dirname(path.dirname(recordedFirmware))),
      "bin",
      "qemu-system-aarch64",
    )
  : "";
const derivedQemu = path.join(
  workspaceRoot,
  "tools",
  "qemu",
  "builds",
  buildDirKey,
  "install",
  "bin",
  "qemu-system-aarch64",
);
const hostQemu =
  recordedQemu ||
  (derivedQemuFromFirmware && fs.existsSync(derivedQemuFromFirmware)
    ? derivedQemuFromFirmware
    : "") ||
  (fs.existsSync(derivedQemu)
    ? derivedQemu
    : String((profile.l1 && profile.l1.launcher) || "qemu-system-aarch64"));
const launchScript =
  state.layeredState && state.layeredState.l1 && state.layeredState.l1.launchScript
    ? String(state.layeredState.l1.launchScript)
    : path.join(buildDir, "l1", "launch-l2.sh");
const launchScriptHoststack =
  state.layeredState && state.layeredState.l1 && state.layeredState.l1.launchScriptHoststack
    ? String(state.layeredState.l1.launchScriptHoststack)
    : path.join(buildDir, "l1", "launch-l2-hoststack.sh");
const runtimeShareDir =
  state.layeredState && state.layeredState.l1 && state.layeredState.l1.runtimeShareDir
    ? String(state.layeredState.l1.runtimeShareDir)
    : path.join(buildDir, "l1");
const hostStackRootfs =
  state.layeredState
  && state.layeredState.l1
  && state.layeredState.l1.hostStack
  && state.layeredState.l1.hostStack.rootfs
    ? String(state.layeredState.l1.hostStack.rootfs)
    : path.join(buildDir, "l1", "cca-host-stack", "out", "host.ext4");

const values = [
  hostQemu,
  recordedFirmware,
  String(
    (state.hostLaunch && state.hostLaunch.provisionedOverlayImage) ||
      path.join(buildDir, "l0", "l1-provisioned.qcow2"),
  ),
  String(
    (state.hostLaunch && state.hostLaunch.overlayImage) ||
      path.join(buildDir, "l0", "overlay.qcow2"),
  ),
  String(
    (state.hostLaunch && state.hostLaunch.seedImage) ||
      path.join(buildDir, "l0", "seed.img"),
  ),
  path.join(buildDir, "l0", "id_ed25519"),
  String(l2Cvm),
  launchScript,
  launchScriptHoststack,
  l1SshPort,
  l1Machine,
  l1Cpu,
  l1Memory,
  l1Cpus,
  l1Accel,
  l1EnableKvm,
  path.join(buildDir, "l0", "l1.pid"),
  path.join(runDir, "l1-console.log"),
  String(l1ReplaceKernel),
  path.join(buildDir, "l1", "host-boot", "vmlinuz"),
  path.join(buildDir, "l1", "host-boot", "initrd.img"),
  path.join(buildDir, "l1", "host-boot", "cmdline.txt"),
  hostStackRootfs,
  runtimeShareDir,
];

process.stdout.write(values.join("\0"));
process.stdout.write("\0");
NODE
)

host_qemu="${runtime_fields[0]}"
firmware="${runtime_fields[1]}"
provisioned_overlay_image="${runtime_fields[2]}"
overlay_image_path="${runtime_fields[3]}"
seed_image_path="${runtime_fields[4]}"
ssh_key="${runtime_fields[5]}"
l2_cvm="${runtime_fields[6]}"
launch_script_local="${runtime_fields[7]}"
launch_script_hoststack_local="${runtime_fields[8]}"
l1_ssh_port="${runtime_fields[9]}"
l1_machine_effective="${runtime_fields[10]}"
l1_cpu_effective="${runtime_fields[11]}"
l1_memory="${runtime_fields[12]}"
l1_cpus="${runtime_fields[13]}"
l1_accel_effective="${runtime_fields[14]}"
l1_enable_kvm="${runtime_fields[15]}"
qemu_pid_file="${runtime_fields[16]}"
l1_console_log="${runtime_fields[17]}"
l1_replace_kernel="${runtime_fields[18]}"
l1_kernel_path="${runtime_fields[19]}"
l1_initrd_path="${runtime_fields[20]}"
l1_cmdline_path="${runtime_fields[21]}"
l1_hoststack_rootfs="${runtime_fields[22]}"
l1_hoststack_share_dir="${runtime_fields[23]}"

if [ "${l2_cvm}" != "true" ] && [ ! -f "${ssh_key}" ]; then
  echo "missing ssh key for l1 access: ${ssh_key}" >&2
  exit 1
fi
if [ "${l2_cvm}" != "true" ] && [ ! -f "${launch_script_local}" ]; then
  echo "missing prepared l2 launch script: ${launch_script_local}" >&2
  exit 1
fi
if [ "${l2_cvm}" = "true" ] && [ ! -f "${launch_script_hoststack_local}" ]; then
  echo "missing prepared l2 host-stack launch script: ${launch_script_hoststack_local}" >&2
  exit 1
fi
if [ "${l2_cvm}" != "true" ] && [ ! -f "${provisioned_overlay_image}" ]; then
  echo "missing provisioned l1 snapshot: ${provisioned_overlay_image}" >&2
  exit 1
fi
if [ "${l2_cvm}" != "true" ] && [ ! -f "${seed_image_path}" ]; then
  echo "missing l1 seed image: ${seed_image_path}" >&2
  exit 1
fi
if [ -z "${firmware}" ] || [ ! -f "${firmware}" ]; then
  echo "missing firmware for prepared l1 launch: ${firmware}" >&2
  exit 1
fi
if [ "${l2_cvm}" = "true" ] && [ ! -f "${l1_hoststack_rootfs}" ]; then
  echo "missing prepared l1 host stack rootfs: ${l1_hoststack_rootfs}" >&2
  exit 1
fi
if [ "${l2_cvm}" = "true" ] && [ ! -d "${l1_hoststack_share_dir}" ]; then
  echo "missing prepared l1 host stack share dir: ${l1_hoststack_share_dir}" >&2
  exit 1
fi

if [[ "${host_qemu}" = */* ]]; then
  if [ ! -x "${host_qemu}" ]; then
    echo "missing host qemu for nvirsh exec: ${host_qemu}" >&2
    exit 1
  fi
else
  resolved_host_qemu="$(command -v "${host_qemu}" || true)"
  if [ -z "${resolved_host_qemu}" ]; then
    echo "missing host qemu launcher for nvirsh exec: ${host_qemu}" >&2
    exit 1
  fi
  host_qemu="${resolved_host_qemu}"
fi

rm -f "${manifest_file}" "${stdout_log}" "${stderr_log}" "${runtime_script}"

export MORPHEUS_NVIRSH_RUNTIME_QEMU="${host_qemu}"
export MORPHEUS_NVIRSH_RUNTIME_FIRMWARE="${firmware}"
export MORPHEUS_NVIRSH_RUNTIME_PROVISIONED_OVERLAY="${provisioned_overlay_image}"
export MORPHEUS_NVIRSH_RUNTIME_OVERLAY="${overlay_image_path}"
export MORPHEUS_NVIRSH_RUNTIME_SEED_IMAGE="${seed_image_path}"
export MORPHEUS_NVIRSH_RUNTIME_SSH_KEY="${ssh_key}"
export MORPHEUS_NVIRSH_RUNTIME_SSH_PORT="${l1_ssh_port}"
export MORPHEUS_NVIRSH_RUNTIME_L2_CVM="${l2_cvm}"
export MORPHEUS_NVIRSH_RUNTIME_REMOTE_LAUNCH_SCRIPT="/root/launch-l2.sh"
export MORPHEUS_NVIRSH_RUNTIME_HOSTSTACK_LAUNCH_SCRIPT="/host/launch-l2-hoststack.sh"
export MORPHEUS_NVIRSH_RUNTIME_HOSTSTACK_LAUNCH_SCRIPT_LOCAL="${launch_script_hoststack_local}"
export MORPHEUS_NVIRSH_RUNTIME_HOSTSTACK_ROOTFS="${l1_hoststack_rootfs}"
export MORPHEUS_NVIRSH_RUNTIME_HOSTSTACK_SHARE_DIR="${l1_hoststack_share_dir}"
export MORPHEUS_NVIRSH_RUNTIME_L1_MACHINE="${l1_machine_effective}"
export MORPHEUS_NVIRSH_RUNTIME_L1_CPU="${l1_cpu_effective}"
export MORPHEUS_NVIRSH_RUNTIME_L1_MEMORY="${l1_memory}"
export MORPHEUS_NVIRSH_RUNTIME_L1_CPUS="${l1_cpus}"
export MORPHEUS_NVIRSH_RUNTIME_L1_ACCEL="${l1_accel_effective}"
export MORPHEUS_NVIRSH_RUNTIME_L1_ENABLE_KVM="${l1_enable_kvm}"
export MORPHEUS_NVIRSH_RUNTIME_L1_REPLACE_KERNEL="${l1_replace_kernel}"
export MORPHEUS_NVIRSH_RUNTIME_L1_KERNEL="${l1_kernel_path}"
export MORPHEUS_NVIRSH_RUNTIME_L1_INITRD="${l1_initrd_path}"
export MORPHEUS_NVIRSH_RUNTIME_L1_CMDLINE_FILE="${l1_cmdline_path}"
export MORPHEUS_NVIRSH_RUNTIME_MANIFEST="${manifest_file}"
export MORPHEUS_NVIRSH_RUNTIME_STDOUT_LOG="${stdout_log}"
export MORPHEUS_NVIRSH_RUNTIME_STDERR_LOG="${stderr_log}"
export MORPHEUS_NVIRSH_RUNTIME_L1_CONSOLE_LOG="${l1_console_log}"
export MORPHEUS_NVIRSH_RUNTIME_QEMU_PID_FILE="${qemu_pid_file}"
export MORPHEUS_NVIRSH_RUNTIME_SOURCE_DIR="${source_dir}"
export MORPHEUS_NVIRSH_RUNTIME_RUN_DIR="${run_dir}"
export MORPHEUS_NVIRSH_RUNTIME_INSTALL_DIR="${install_dir}"
export MORPHEUS_NVIRSH_RUNTIME_STATE_FILE="${state_file}"
export MORPHEUS_NVIRSH_RUNTIME_PROFILE_FILE="${profile_file}"
export MORPHEUS_NVIRSH_RUNTIME_PROFILE_NAME="${profile_name}"
export MORPHEUS_NVIRSH_RUNTIME_BUILD_DIR_KEY="${build_dir_key}"
export MORPHEUS_NVIRSH_RUNTIME_DETACHED="${detach}"

cat > "${runtime_script}" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

manifest_file="${MORPHEUS_NVIRSH_RUNTIME_MANIFEST:?}"
stdout_log="${MORPHEUS_NVIRSH_RUNTIME_STDOUT_LOG:?}"
stderr_log="${MORPHEUS_NVIRSH_RUNTIME_STDERR_LOG:?}"
l1_console_log="${MORPHEUS_NVIRSH_RUNTIME_L1_CONSOLE_LOG:?}"
qemu_pid_file="${MORPHEUS_NVIRSH_RUNTIME_QEMU_PID_FILE:?}"
qemu_binary="${MORPHEUS_NVIRSH_RUNTIME_QEMU:?}"
firmware="${MORPHEUS_NVIRSH_RUNTIME_FIRMWARE:?}"
provisioned_overlay_image="${MORPHEUS_NVIRSH_RUNTIME_PROVISIONED_OVERLAY:?}"
overlay_image_path="${MORPHEUS_NVIRSH_RUNTIME_OVERLAY:?}"
seed_image_path="${MORPHEUS_NVIRSH_RUNTIME_SEED_IMAGE:?}"
ssh_key="${MORPHEUS_NVIRSH_RUNTIME_SSH_KEY:?}"
ssh_port="${MORPHEUS_NVIRSH_RUNTIME_SSH_PORT:?}"
l2_cvm="${MORPHEUS_NVIRSH_RUNTIME_L2_CVM:-false}"
launch_script="${MORPHEUS_NVIRSH_RUNTIME_REMOTE_LAUNCH_SCRIPT:?}"
hoststack_launch_script="${MORPHEUS_NVIRSH_RUNTIME_HOSTSTACK_LAUNCH_SCRIPT:-/host/launch-l2-hoststack.sh}"
hoststack_launch_script_local="${MORPHEUS_NVIRSH_RUNTIME_HOSTSTACK_LAUNCH_SCRIPT_LOCAL:-}"
hoststack_rootfs="${MORPHEUS_NVIRSH_RUNTIME_HOSTSTACK_ROOTFS:-}"
hoststack_share_dir="${MORPHEUS_NVIRSH_RUNTIME_HOSTSTACK_SHARE_DIR:-}"
l1_machine="${MORPHEUS_NVIRSH_RUNTIME_L1_MACHINE:?}"
l1_cpu="${MORPHEUS_NVIRSH_RUNTIME_L1_CPU:?}"
l1_memory="${MORPHEUS_NVIRSH_RUNTIME_L1_MEMORY:?}"
l1_cpus="${MORPHEUS_NVIRSH_RUNTIME_L1_CPUS:?}"
l1_accel="${MORPHEUS_NVIRSH_RUNTIME_L1_ACCEL:-}"
l1_enable_kvm="${MORPHEUS_NVIRSH_RUNTIME_L1_ENABLE_KVM:-false}"
l1_replace_kernel="${MORPHEUS_NVIRSH_RUNTIME_L1_REPLACE_KERNEL:-false}"
l1_kernel="${MORPHEUS_NVIRSH_RUNTIME_L1_KERNEL:-}"
l1_initrd="${MORPHEUS_NVIRSH_RUNTIME_L1_INITRD:-}"
l1_cmdline_file="${MORPHEUS_NVIRSH_RUNTIME_L1_CMDLINE_FILE:-}"
source_dir="${MORPHEUS_NVIRSH_RUNTIME_SOURCE_DIR:?}"
run_dir="${MORPHEUS_NVIRSH_RUNTIME_RUN_DIR:?}"
install_dir="${MORPHEUS_NVIRSH_RUNTIME_INSTALL_DIR:?}"
state_file="${MORPHEUS_NVIRSH_RUNTIME_STATE_FILE:?}"
profile_file="${MORPHEUS_NVIRSH_RUNTIME_PROFILE_FILE:?}"
profile_name="${MORPHEUS_NVIRSH_RUNTIME_PROFILE_NAME:?}"
build_dir_key="${MORPHEUS_NVIRSH_RUNTIME_BUILD_DIR_KEY:?}"
detached="${MORPHEUS_NVIRSH_RUNTIME_DETACHED:-false}"

qemu_pid=""
qemu_stdin_fifo=""
qemu_stdin_writer_pid=""

wait_for_ssh() {
  local keyfile="$1"
  local port="$2"
  local pid="$3"
  local deadline=$((SECONDS + 600))
  while [ "${SECONDS}" -lt "${deadline}" ]; do
    if [ -n "${pid}" ] && ! kill -0 "${pid}" 2>/dev/null; then
      echo "l1 qemu exited before SSH became available" >&2
      return 1
    fi
    if ssh \
      -i "${keyfile}" \
      -o BatchMode=yes \
      -o StrictHostKeyChecking=no \
      -o UserKnownHostsFile=/dev/null \
      -o ConnectTimeout=5 \
      -p "${port}" \
      root@127.0.0.1 true >/dev/null 2>&1; then
      return 0
    fi
    sleep 2
  done
  echo "timed out waiting for l1 SSH" >&2
  return 1
}

wait_for_log_pattern() {
  local logfile="$1"
  local pattern="$2"
  local pid="$3"
  local timeout_seconds="$4"
  local description="$5"
  local deadline=$((SECONDS + timeout_seconds))
  while [ "${SECONDS}" -lt "${deadline}" ]; do
    if [ -f "${logfile}" ] && LC_ALL=C grep -a -q -- "${pattern}" "${logfile}" 2>/dev/null; then
      return 0
    fi
    if [ -n "${pid}" ] && ! kill -0 "${pid}" 2>/dev/null; then
      echo "${description} not observed before l1 qemu exited" >&2
      return 1
    fi
    sleep 2
  done
  echo "timed out waiting for ${description}" >&2
  return 124
}

normalize_console_log() {
  local logfile="$1"
  if [ ! -f "${logfile}" ]; then
    return 0
  fi
  perl -0pi -e 's/\r\r\n/\n/g; s/\r\n/\n/g; s/\r/\n/g;' "${logfile}"
}

normalize_runtime_logs() {
  normalize_console_log "${stdout_log}"
  normalize_console_log "${l1_console_log}"
}

write_manifest() {
  local status="$1"
  local exit_code="$2"
  local error_message="$3"
  node - "${state_file}" "${profile_file}" "${manifest_file}" "${source_dir}" "${run_dir}" "${install_dir}" "${profile_name}" "${build_dir_key}" "${status}" "${exit_code}" "${error_message}" "${qemu_pid:-}" "${ssh_port}" "${stdout_log}" "${stderr_log}" "${l1_console_log}" "${detached}" "${l2_cvm}" "$$" <<'NODE'
const fs = require("fs");
const [
  stateFile,
  profileFile,
  manifestFile,
  sourceDir,
  runDir,
  installDir,
  profileName,
  buildDirKey,
  status,
  exitCodeRaw,
  errorMessage,
  qemuPidRaw,
  sshPortRaw,
  stdoutLog,
  stderrLog,
  l1ConsoleLog,
  detachedRaw,
  l2CvmRaw,
  supervisorPidRaw,
] = process.argv.slice(2);
const state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
const profile = JSON.parse(fs.readFileSync(profileFile, "utf8"));
const qemuPid = qemuPidRaw ? Number(qemuPidRaw) : null;
const supervisorPid = supervisorPidRaw ? Number(supervisorPidRaw) : null;
const exitCode = exitCodeRaw === "" ? null : Number(exitCodeRaw);
const l1Reachable = status === "running" && l2CvmRaw !== "true";
const now = new Date().toISOString();
const manifest = {
  schemaVersion: 1,
  tool: "nvirsh",
  profile: profileName,
  buildVersion: profileName,
  buildDirKey,
  source: sourceDir,
  buildDir: state.buildDir,
  installDir,
  runDir,
  currentPhase: status === "running" ? "launch" : "stopped",
  status,
  runtime: {
    pid: status === "running" ? supervisorPid : null,
    detached: detachedRaw === "true",
    supervisorPid: status === "running" ? supervisorPid : null,
    l1: {
      pid: status === "running" ? qemuPid : null,
      host: l1Reachable ? "127.0.0.1" : null,
      port: l1Reachable ? Number(sshPortRaw) : null,
      user: l1Reachable ? "root" : null,
      consoleLog: l1ConsoleLog,
    },
  },
  layeredState: {
    ...state.layeredState,
    l2: {
      ...(state.layeredState && state.layeredState.l2 ? state.layeredState.l2 : {}),
      status: status === "running" ? "running" : (status === "success" ? "stopped" : status),
      launcher: profile.l2 && profile.l2.launcher ? profile.l2.launcher : null,
      launcherArgs: profile.l2 && Array.isArray(profile.l2.launcherArgs) ? profile.l2.launcherArgs : [],
      bootLog: stdoutLog,
    },
  },
  phases: {
    ...state.phases,
    launch: status === "running" ? "running" : status,
  },
  phaseHistory: [{ phase: "launch", at: now, status }],
  createdAt: now,
  updatedAt: now,
  logs: {
    stdout: stdoutLog,
    stderr: stderrLog,
    l1Console: l1ConsoleLog,
  },
};
if (status !== "running") {
  manifest.completedAt = now;
}
if (status === "error") {
  manifest.errorMessage = errorMessage || "nvirsh exec failed";
}
if (Number.isInteger(exitCode)) {
  manifest.exitCode = exitCode;
}
fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
NODE
}

cleanup() {
  set +e
  if [ -n "${qemu_stdin_writer_pid}" ] && kill -0 "${qemu_stdin_writer_pid}" 2>/dev/null; then
    kill "${qemu_stdin_writer_pid}" 2>/dev/null || true
    wait "${qemu_stdin_writer_pid}" 2>/dev/null || true
  fi
  if [ -n "${qemu_pid}" ] && kill -0 "${qemu_pid}" 2>/dev/null; then
    kill "${qemu_pid}" 2>/dev/null || true
    wait "${qemu_pid}" 2>/dev/null || true
  fi
  if [ -n "${qemu_stdin_fifo}" ]; then
    rm -f "${qemu_stdin_fifo}"
  fi
  rm -f "${qemu_pid_file}"
  set -e
}

trap cleanup EXIT INT TERM

mkdir -p "$(dirname "${overlay_image_path}")" "$(dirname "${l1_console_log}")"

: > "${stdout_log}"
: > "${stderr_log}"
: > "${l1_console_log}"

launch_status=0
if [ "${l2_cvm}" = "true" ]; then
  if [ ! -f "${l1_kernel}" ]; then
    echo "missing l1 host stack kernel image: ${l1_kernel}" >&2
    exit 1
  fi
  l1_qemu_cmd=(
    "${qemu_binary}"
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
    -append "nokaslr root=/dev/vda rw init=/init -- ${hoststack_launch_script}"
    -virtfs "local,path=${hoststack_share_dir},mount_tag=host,security_model=mapped,readonly=off"
  )
  if [ -n "${l1_accel}" ]; then
    l1_qemu_cmd+=(-accel "${l1_accel}")
  fi
  if [ "${l1_enable_kvm}" = "true" ]; then
    l1_qemu_cmd+=(-enable-kvm)
  fi

  printf '[nvirsh] exec launching l2 through pinned l1 host stack\n' | tee -a "${stdout_log}"
  if [ "${detached}" = "true" ]; then
    qemu_stdin_fifo="${run_dir}/l1-qemu.stdin"
    rm -f "${qemu_stdin_fifo}" "${l1_console_log}"
    mkfifo "${qemu_stdin_fifo}"
    ln -sf "$(basename "${stdout_log}")" "${l1_console_log}"
    nohup tail -f /dev/null > "${qemu_stdin_fifo}" 2>/dev/null &
    qemu_stdin_writer_pid="$!"
    setsid "${l1_qemu_cmd[@]}" >> "${stdout_log}" 2>&1 < "${qemu_stdin_fifo}" &
  else
    "${l1_qemu_cmd[@]}" > >(tee -a "${l1_console_log}" "${stdout_log}") 2>&1 < /dev/null &
  fi
  qemu_pid="$!"
  printf '%s\n' "${qemu_pid}" > "${qemu_pid_file}"
  write_manifest "running" "" ""

  if wait_for_log_pattern "${stdout_log}" "buildroot login:" "${qemu_pid}" 900 "l2 buildroot login prompt"; then
    printf '[nvirsh] exec observed l2 buildroot login prompt\n' | tee -a "${stdout_log}"
    if [ "${detached}" = "true" ]; then
      normalize_runtime_logs
      while kill -0 "${qemu_pid}" 2>/dev/null; do
        sleep 5
      done
      set +e
      wait "${qemu_pid}" 2>/dev/null || true
      set -e
      qemu_pid=""
      exit 0
    fi
    if kill -0 "${qemu_pid}" 2>/dev/null; then
      kill "${qemu_pid}" 2>/dev/null || true
      set +e
      wait "${qemu_pid}"
      set -e
    fi
    qemu_pid=""
    launch_status=0
  else
    if [ -n "${qemu_pid}" ] && kill -0 "${qemu_pid}" 2>/dev/null; then
      kill "${qemu_pid}" 2>/dev/null || true
    fi
    set +e
    wait "${qemu_pid}"
    launch_status="$?"
    set -e
    qemu_pid=""
    if [ "${launch_status}" -eq 143 ] || [ "${launch_status}" -eq 137 ]; then
      launch_status=1
    fi
  fi
else
  rm -f "${overlay_image_path}"
  qemu-img create \
    -f qcow2 \
    -F qcow2 \
    -b "${provisioned_overlay_image}" \
    "${overlay_image_path}" >/dev/null

  l1_qemu_cmd=(
    "${qemu_binary}"
    -machine "${l1_machine}"
    -cpu "${l1_cpu}"
    -m "${l1_memory}"
    -smp "${l1_cpus}"
    -nographic
    -drive file="${overlay_image_path}",if=virtio,format=qcow2
    -drive file="${seed_image_path}",if=virtio,format=raw
    -netdev user,id=net0,hostfwd=tcp::${ssh_port}-:22
    -device virtio-net-pci,netdev=net0
  )
  if [ "${l1_replace_kernel}" = "true" ]; then
    if [ ! -f "${l1_kernel}" ] || [ ! -f "${l1_initrd}" ] || [ ! -f "${l1_cmdline_file}" ]; then
      echo "replaceKernel requested but l1 host boot artifacts are missing" >&2
      exit 1
    fi
    l1_qemu_cmd+=(-bios "${firmware}")
    l1_qemu_cmd+=(
      -kernel "${l1_kernel}"
      -initrd "${l1_initrd}"
      -append "$(cat "${l1_cmdline_file}")"
    )
  else
    l1_qemu_cmd+=(-bios "${firmware}")
  fi
  if [ -n "${l1_accel}" ]; then
    l1_qemu_cmd+=(-accel "${l1_accel}")
  fi
  if [ "${l1_enable_kvm}" = "true" ]; then
    l1_qemu_cmd+=(-enable-kvm)
  fi

  "${l1_qemu_cmd[@]}" >> "${l1_console_log}" 2>&1 < /dev/null &
  qemu_pid="$!"
  printf '%s\n' "${qemu_pid}" > "${qemu_pid_file}"

  if ! wait_for_ssh "${ssh_key}" "${ssh_port}" "${qemu_pid}"; then
    write_manifest "error" "1" "l1 did not become reachable over SSH"
    exit 1
  fi

  write_manifest "running" "" ""
  printf '[nvirsh] exec launching l2 from l1\n' | tee -a "${stdout_log}"

  set +e
  ssh \
    -i "${ssh_key}" \
    -o BatchMode=yes \
    -o StrictHostKeyChecking=no \
    -o UserKnownHostsFile=/dev/null \
    -o ConnectTimeout=5 \
    -p "${ssh_port}" \
    root@127.0.0.1 \
    "bash -lc $(printf '%q' "${launch_script}")" \
    2> >(tee -a "${stderr_log}" >&2) \
    | tee -a "${stdout_log}"
  launch_status="${PIPESTATUS[0]}"
  set -e
fi

if [ "${launch_status}" -eq 0 ]; then
  normalize_runtime_logs
  write_manifest "success" "${launch_status}" ""
  exit 0
fi

normalize_runtime_logs
if [ "${l2_cvm}" = "true" ]; then
  write_manifest "error" "${launch_status}" "launch-l2-hoststack.sh failed"
else
  write_manifest "error" "${launch_status}" "launch-l2.sh failed"
fi
exit "${launch_status}"
EOF
chmod +x "${runtime_script}"

if [ "${detach}" = "true" ]; then
  nohup "${runtime_script}" > /dev/null 2>&1 &
  supervisor_pid="$!"
  deadline=$((SECONDS + 120))
  while [ "${SECONDS}" -lt "${deadline}" ]; do
    if [ -f "${manifest_file}" ]; then
      manifest_status="$(
        node -e 'const fs=require("fs"); const manifest=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(String(manifest.status||""));' "${manifest_file}"
      )"
      if [ "${manifest_status}" = "running" ]; then
        if [ "${l2_cvm}" = "true" ]; then
          if LC_ALL=C grep -a -q -- '\[nvirsh\] exec observed l2 buildroot login prompt' "${stdout_log}" 2>/dev/null; then
            :
          elif LC_ALL=C grep -a -q -- 'Assigned terminal 0 to pty ' "${stdout_log}" 2>/dev/null; then
            :
          else
            sleep 2
            continue
          fi
        fi
        ready_pid="${supervisor_pid}"
        if [ "${l2_cvm}" = "true" ]; then
          ready_pid="$(
            node -e 'const fs=require("fs"); const manifest=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); const raw=manifest.runtime && manifest.runtime.l1 ? manifest.runtime.l1.pid : null; const pid=Number(raw); process.stdout.write(Number.isInteger(pid) && pid > 0 ? String(pid) : "null");' "${manifest_file}"
          )"
          if [ "${ready_pid}" = "null" ] || ! kill -0 "${ready_pid}" 2>/dev/null; then
            sleep 2
            continue
          fi
        fi
        cat > "${result_file}" <<EOF
{"details":{"run_dir":"${run_dir}","manifest":"${manifest_file}","phase":"${phase}","profile":"${profile_name}","pid":${ready_pid},"detached":true}}
EOF
        printf '[nvirsh] exec launched l2 from l1 pid=%s\n' "${ready_pid}"
        exit 0
      fi
      if [ "${manifest_status}" = "error" ]; then
        break
      fi
    fi
    if ! kill -0 "${supervisor_pid}" 2>/dev/null; then
      break
    fi
    sleep 2
  done

  if [ -f "${manifest_file}" ]; then
    node - "${manifest_file}" <<'NODE'
const fs = require("fs");
const manifest = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
if (manifest.errorMessage) {
  console.error(manifest.errorMessage);
} else {
  console.error("nvirsh detached launch failed");
}
NODE
  else
    echo "nvirsh detached launch failed before writing a manifest" >&2
  fi
  exit 1
fi

set +e
"${runtime_script}"
launch_status="$?"
set -e

if [ "${launch_status}" -ne 0 ]; then
  exit "${launch_status}"
fi

cat > "${result_file}" <<EOF
{"details":{"run_dir":"${run_dir}","manifest":"${manifest_file}","phase":"${phase}","profile":"${profile_name}","pid":null,"detached":false}}
EOF
printf '[nvirsh] exec completed l2 launch for profile=%s\n' "${profile_name}"
