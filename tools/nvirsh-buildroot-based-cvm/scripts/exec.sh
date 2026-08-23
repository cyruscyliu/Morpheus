#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

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
stop_request_file="${run_dir}/stop-requested"
l1_pid=""
l1_process_group_id=""
l2_console_stream_pid=""

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
  node - "${state_file}" <<'NODE'
const fs = require("fs");
const path = require("path");
const [stateFile] = process.argv.slice(2);
const state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
const l1 = state.layeredState && state.layeredState.l1 ? state.layeredState.l1 : {};
const l2 = state.layeredState && state.layeredState.l2 ? state.layeredState.l2 : {};
const shareDir = String(l1.shareDir || "");
const buildrootImages = l2.buildrootImages || {};
const values = [
  shareDir,
  String(l1.launchScriptHoststack || ""),
  shareDir ? path.join(shareDir, "morpheus-l2-runtime") : "",
  String(buildrootImages.launchMode || "direct-qemu"),
];
process.stdout.write(values.join("\0"));
process.stdout.write("\0");
NODE
)

hoststack_share_dir="${runtime_fields[0]:-}"
hoststack_launch_script_local="${runtime_fields[1]:-}"
l2_runtime_share_dir="${runtime_fields[2]:-}"
l2_launch_mode="${runtime_fields[3]:-direct-qemu}"
l2_rsi_evidence_marker="MORPHEUS_RSI_EVIDENCE:"
l2_rsi_evidence_missing_marker="MORPHEUS_RSI_EVIDENCE_MISSING"

wait_for_cvm_l2_ready() {
  local console_log="$1"
  local pid="$2"
  local timeout_seconds="$3"
  local deadline=$((SECONDS + timeout_seconds))
  local started_at="${SECONDS}"
  local next_progress_at="${SECONDS}"
  local require_rsi_evidence="false"
  local wait_target="l2 buildroot login prompt"
  if [ "${l2_launch_mode}" = "linaro-gen-run-vmm" ]; then
    require_rsi_evidence="true"
    wait_target="guest RSI evidence and l2 buildroot login prompt"
  fi
  while [ "${SECONDS}" -lt "${deadline}" ]; do
    if [ "${SECONDS}" -ge "${next_progress_at}" ]; then
      local elapsed=$((SECONDS - started_at))
      printf '[nvirsh-buildroot-based-cvm] waiting for %s (%ss elapsed, %ss timeout)\n' \
        "${wait_target}" "${elapsed}" "${timeout_seconds}" \
        | tee -a "${stdout_log}" >&2
      next_progress_at=$((SECONDS + 15))
    fi
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

stop_l2_console_stream() {
  local stream_pid="${l2_console_stream_pid}"
  if [ -z "${stream_pid}" ]; then
    return 0
  fi
  l2_console_stream_pid=""
  kill "${stream_pid}" 2>/dev/null || true
  wait "${stream_pid}" 2>/dev/null || true
}

trap 'stop_l2_console_stream' EXIT

terminate_l1_process() {
  local pid="$1"
  local process_group_id="${2:-}"
  local use_process_group="false"
  if [ -z "${pid}" ]; then
    return 0
  fi
  if [[ "${process_group_id}" =~ ^[1-9][0-9]*$ ]] \
    && kill -0 -- "-${process_group_id}" 2>/dev/null; then
    use_process_group="true"
    kill -TERM -- "-${process_group_id}" 2>/dev/null || true
  elif kill -0 "${pid}" 2>/dev/null; then
    kill -TERM "${pid}" 2>/dev/null || true
  else
    wait "${pid}" 2>/dev/null || true
    return 0
  fi

  for _ in $(seq 1 30); do
    if [ "${use_process_group}" = "true" ]; then
      if ! kill -0 -- "-${process_group_id}" 2>/dev/null; then
        break
      fi
    elif ! kill -0 "${pid}" 2>/dev/null; then
      break
    fi
    sleep 0.1
  done

  if [ "${use_process_group}" = "true" ]; then
    kill -KILL -- "-${process_group_id}" 2>/dev/null || true
  elif kill -0 "${pid}" 2>/dev/null; then
    kill -KILL "${pid}" 2>/dev/null || true
  fi
  wait "${pid}" 2>/dev/null || true
}

write_manifest() {
  local status="$1"
  local exit_code="$2"
  local error_message="$3"
  local l1_pid="${4:-}"
  local l1_process_group_id="${5:-}"
  node - "${state_file}" "${manifest_file}" "${run_dir}" "${status}" "${exit_code}" "${error_message}" "${l1_pid}" "${l1_process_group_id}" "${stdout_log}" "${stderr_log}" "${l1_console_log}" "${l2_console_log}" "${l2_launcher_stdout_log}" "${l2_launcher_stderr_log}" "${l2_launch_marker_log}" "${l2_runtime_share_dir}" <<'NODE'
const fs = require("fs");
const [
  stateFile,
  manifestFile,
  runDir,
  status,
  exitCodeRaw,
  errorMessage,
  l1PidRaw,
  l1ProcessGroupIdRaw,
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
const l1ProcessGroupId = l1ProcessGroupIdRaw === "" ? null : Number(l1ProcessGroupIdRaw);
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
      processGroupId: Number.isInteger(l1ProcessGroupId) ? l1ProcessGroupId : null,
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
if (status === "stopped") {
  manifest.stopReason = errorMessage || "buildroot-based CVM launch stopped";
}
if (Number.isInteger(exitCode)) {
  manifest.exitCode = exitCode;
}
fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
NODE
}

finish_stopped() {
  local reason="${1:-buildroot-based CVM launch stopped}"
  terminate_l1_process "${l1_pid}" "${l1_process_group_id}"
  stop_l2_console_stream
  rm -f "${l1_pid_file}"
  normalize_console_log "${stdout_log}"
  normalize_console_log "${stderr_log}"
  normalize_console_log "${l1_console_log}"
  normalize_console_log "${l2_launcher_stdout_log}"
  normalize_console_log "${l2_launcher_stderr_log}"
  normalize_console_log "${l2_console_log}"
  write_manifest "stopped" "130" "${reason}" "" ""
}

handle_interrupt() {
  local signal="$1"
  trap - INT TERM
  finish_stopped "interrupted by SIG${signal}"
  exit 130
}

trap 'handle_interrupt INT' INT
trap 'handle_interrupt TERM' TERM

if [ -z "${hoststack_share_dir}" ] || [ ! -d "${hoststack_share_dir}" ]; then
  echo "missing host share directory: ${hoststack_share_dir}" >&2
  exit 1
fi
if [ ! -f "${hoststack_launch_script_local}" ]; then
  echo "missing host-stack launch script: ${hoststack_launch_script_local}" >&2
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
  "${l2_console_log}" \
  "${stop_request_file}"

ln -sfn "${l2_runtime_share_dir}/launch-l2.marker" "${l2_launch_marker_log}"
ln -sfn "${l2_runtime_share_dir}/qemu.stdout.log" "${l2_launcher_stdout_log}"
ln -sfn "${l2_runtime_share_dir}/qemu.stderr.log" "${l2_launcher_stderr_log}"
ln -sfn "${l2_runtime_share_dir}/qemu.stdout.log" "${l2_console_log}"
: > "${l2_runtime_share_dir}/qemu.stdout.log"
if command -v tail >/dev/null 2>&1; then
  tail --sleep-interval=0.05 -n +1 -f -- "${l2_console_log}" >&2 &
  l2_console_stream_pid="$!"
fi

l1_launch_cmd="mount -t 9p -o trans=virtio,version=9p2000.L host /mnt && exec /mnt/launch-l2-hoststack.sh"
l1_args_file="$(mktemp "${run_dir}/l1-qemu-args.XXXXXX")"
bash "${script_dir}/l1-launch.sh" \
  --state "${state_file}" \
  --run-dir "${run_dir}" \
  --boot-command "${l1_launch_cmd}" > "${l1_args_file}"
mapfile -d '' -t l1_qemu_cmd < "${l1_args_file}"
rm -f "${l1_args_file}"

printf '[nvirsh-buildroot-based-cvm] launching l1 host stack\n' | tee -a "${stdout_log}"
if command -v setsid >/dev/null 2>&1; then
  setsid "${l1_qemu_cmd[@]}" >> "${l1_console_log}" 2>&1 < /dev/null &
  l1_pid="$!"
  l1_process_group_id="${l1_pid}"
else
  "${l1_qemu_cmd[@]}" >> "${l1_console_log}" 2>&1 < /dev/null &
  l1_pid="$!"
fi
printf '%s\n' "${l1_pid}" > "${l1_pid_file}"
write_manifest "running" "" "" "${l1_pid}" "${l1_process_group_id}"

set +e
wait_for_cvm_l2_ready "${l2_console_log}" "${l1_pid}" 2100
launch_wait_status="$?"
set -e

if [ -f "${stop_request_file}" ]; then
  finish_stopped "stop requested"
  exit 130
fi

if [ "${launch_wait_status}" -eq 0 ]; then
  if [ "${l2_launch_mode}" = "linaro-gen-run-vmm" ]; then
    printf '[nvirsh-buildroot-based-cvm] observed l2 guest RSI evidence and buildroot login prompt\n' | tee -a "${stdout_log}"
  else
    printf '[nvirsh-buildroot-based-cvm] observed l2 buildroot login prompt\n' | tee -a "${stdout_log}"
  fi
  terminate_l1_process "${l1_pid}" "${l1_process_group_id}"
  stop_l2_console_stream
  rm -f "${l1_pid_file}"
  normalize_console_log "${stdout_log}"
  normalize_console_log "${stderr_log}"
  normalize_console_log "${l1_console_log}"
  normalize_console_log "${l2_launcher_stdout_log}"
  normalize_console_log "${l2_launcher_stderr_log}"
  normalize_console_log "${l2_console_log}"
  write_manifest "success" "0" "" "" ""
  cat > "${result_file}" <<EOF
{"details":{"run_dir":"${run_dir}","manifest":"${manifest_file}","phase":"${phase}","build_dir_key":"${build_dir_key}","detached":false,"l1_console_log":"${l1_console_log}","l2_console_log":"${l2_console_log}","l2_launcher_stdout_log":"${l2_launcher_stdout_log}","l2_launcher_stderr_log":"${l2_launcher_stderr_log}","l2_launch_marker":"${l2_launch_marker_log}"}}
EOF
  exit 0
fi

terminate_l1_process "${l1_pid}" "${l1_process_group_id}"
stop_l2_console_stream
rm -f "${l1_pid_file}"
l1_exit_status=1

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
write_manifest "error" "${l1_exit_status}" "${failure_message}" "" ""
exit "${l1_exit_status}"
