#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

install_dir="${MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_INSTALL_DIR:?}"
run_dir="${MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_RUN_DIR:?}"
phase="${MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_PHASE:?}"
detach="${MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_DETACH:-false}"
build_dir_key="${MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_BUILD_DIR_KEY:-default}"
l2_smp="${MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_L2_SMP:-}"
l2_memory_mb="${MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_L2_MEMORY_MB:-}"
l2_runtime_subdir="${MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_RUNTIME_SUBDIR:-morpheus-l2-runtime}"
l1_smp_override="${MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_L1_SMP:-}"
measure_l2_startup="${MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_MEASURE_L2_STARTUP:-false}"
stop_on_ready="${MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_STOP_ON_READY:-false}"
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
l2_launcher_stderr_stream_pid=""
l2_marker_stream_pid=""
l2_cvm_evidence_reported="false"
l2_ready_reported="false"
l2_rsi_status_reported="false"
l2_qemu_exec_start_ns=""
l2_buildroot_ready_ns=""
l2_timing_file="${run_dir}/l2-startup-timing.json"
failure_message=""

if [ "${phase}" != "launch" ]; then
  echo "unsupported buildroot-based CVM exec phase: ${phase}" >&2
  exit 1
fi
if [ "${detach}" = "true" ]; then
  echo "detached buildroot-based CVM exec is not implemented" >&2
  exit 1
fi
if [ -n "${l2_smp}" ] && ! [[ "${l2_smp}" =~ ^[1-9][0-9]*$ ]]; then
  echo "l2-smp must be a positive integer" >&2
  exit 1
fi
if [ -n "${l1_smp_override}" ] && ! [[ "${l1_smp_override}" =~ ^[1-9][0-9]*$ ]]; then
  echo "l1-smp must be a positive integer" >&2
  exit 1
fi
if [ -n "${l2_memory_mb}" ] && ! [[ "${l2_memory_mb}" =~ ^[1-9][0-9]*$ ]]; then
  echo "l2-memory-mb must be a positive integer" >&2
  exit 1
fi
if [ -n "${l2_memory_mb}" ] &&
   { [ "${l2_memory_mb}" -lt 256 ] || [ "${l2_memory_mb}" -gt 65536 ]; }; then
  echo "l2-memory-mb must be between 256 and 65536 MB" >&2
  exit 1
fi
if ! [[ "${l2_runtime_subdir}" =~ ^[A-Za-z0-9._-]+$ ]]; then
  echo "runtime-subdir must contain only letters, digits, dot, underscore, or dash" >&2
  exit 1
fi
case "${measure_l2_startup}" in
  true|false) ;;
  *)
    echo "measure-l2-startup must be true or false" >&2
    exit 1
    ;;
esac
case "${stop_on_ready}" in
  true|false) ;;
  *)
    echo "stop-on-ready must be true or false" >&2
    exit 1
    ;;
esac
if [ "${stop_on_ready}" = "true" ]; then
  measure_l2_startup="true"
fi
if [ ! -f "${state_file}" ]; then
  echo "missing prepared state: ${state_file}" >&2
  exit 1
fi

mkdir -p "${run_dir}"
rm -f "${l2_timing_file}"

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
l2_runtime_share_dir="${hoststack_share_dir%/}/${l2_runtime_subdir}"
l2_launch_mode="${runtime_fields[3]:-direct-qemu}"
l2_rsi_evidence_marker="MORPHEUS_RSI_EVIDENCE:"
l2_rsi_evidence_missing_marker="MORPHEUS_RSI_EVIDENCE_MISSING"

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
        tail -n 1 | tr -d '\r' || true
    )"
  fi
  printf '%s' "${detail}"
}

normalize_console_log() {
  local logfile="$1"
  local normalized_logfile="${logfile}"
  if [ ! -f "${logfile}" ]; then
    return 0
  fi
  if [ -L "${logfile}" ]; then
    normalized_logfile="$(readlink -f "${logfile}" 2>/dev/null || true)"
  fi
  if [ -n "${normalized_logfile}" ] && [ -f "${normalized_logfile}" ]; then
    perl -0pi -e 's/\r\r\n/\n/g; s/\r\n/\n/g; s/\r/\n/g;' "${normalized_logfile}"
  fi
}

host_time_ns() {
  local value=""
  if command -v perl >/dev/null 2>&1; then
    value="$(perl -MTime::HiRes=clock_gettime,CLOCK_MONOTONIC \
      -e 'printf "%.0f\n", clock_gettime(CLOCK_MONOTONIC) * 1e9' 2>/dev/null || true)"
  fi
  if ! [[ "${value}" =~ ^[0-9]+$ ]]; then
    value="$(date +%s%N 2>/dev/null || true)"
  fi
  if [[ "${value}" =~ ^[0-9]+$ ]]; then
    printf '%s\n' "${value}"
  else
    printf '%s000000000\n' "$(date +%s)"
  fi
}

write_l2_startup_timing() {
  [ "${measure_l2_startup}" = "true" ] || return 0
  node - "${l2_timing_file}" "${l2_qemu_exec_start_ns}" \
    "${l2_buildroot_ready_ns}" "${l2_smp}" <<'NODE'
const fs = require("fs");
const [outputFile, startRaw, readyRaw, smpRaw] = process.argv.slice(2);
const isInteger = (value) => /^\d+$/.test(value || "");
const hasStart = isInteger(startRaw);
const hasReady = isInteger(readyRaw);
let durationMs = null;
if (hasStart && hasReady) {
  const durationNs = BigInt(readyRaw) - BigInt(startRaw);
  if (durationNs >= 0n) durationMs = Number(durationNs) / 1e6;
}
const result = {
  schemaVersion: 1,
  metric: "l2-qemu-exec-to-buildroot-ready",
  source: "nvirsh-buildroot-based-cvm-host-observer",
  l2_smp: isInteger(smpRaw) ? Number(smpRaw) : null,
  qemu_exec_start_ns: hasStart ? startRaw : null,
  buildroot_ready_ns: hasReady ? readyRaw : null,
  duration_ms: durationMs,
  status: durationMs === null ? "incomplete" : "complete",
};
fs.writeFileSync(outputFile, `${JSON.stringify(result, null, 2)}\n`);
NODE
}

follow_runtime_log() {
  local logfile="$1"
  local prefix="${2:-}"
  exec perl - "${logfile}" "${prefix}" <<'PERL'
use strict;
use warnings;
use IO::Handle;
use Time::HiRes qw(sleep time);

my ($path, $prefix) = @ARGV;
$prefix = "" unless defined $prefix;
STDOUT->autoflush(1);

my ($handle, $device, $inode, $offset);
my $pending_cr = "";
my $pending_since = 0;
my $at_line_start = 1;

sub emit_text {
  my ($text) = @_;
  return unless length($text);
  while (length($text)) {
    if ($at_line_start) {
      print STDOUT $prefix;
      $at_line_start = 0;
    }
    my $newline = index($text, "\n");
    if ($newline < 0) {
      print STDOUT $text;
      last;
    }
    print STDOUT substr($text, 0, $newline + 1, "");
    $at_line_start = 1;
  }
}

sub close_handle {
  if ($handle) {
    close($handle);
  }
  undef $handle;
  undef $device;
  undef $inode;
  undef $offset;
}

sub open_handle {
  return 0 unless -e $path;
  open(my $candidate, '<', $path) or return 0;
  binmode($candidate);
  my @file_stat = stat($candidate);
  close_handle();
  $handle = $candidate;
  $device = $file_stat[0];
  $inode = $file_stat[1];
  $offset = 0;
  seek($handle, 0, 0);
  return 1;
}

sub normalize_chunk {
  my ($chunk) = @_;
  $pending_cr .= $chunk;
  my $body = $pending_cr;
  my $trailing_cr = "";
  if ($body =~ /(\r+)$/) {
    $trailing_cr = $1;
    substr($body, -length($trailing_cr), length($trailing_cr), "");
  }
  $body =~ s/\r+\n/\n/g;
  $body =~ s/\r/\n/g;
  emit_text($body);
  $pending_cr = $trailing_cr;
  $pending_since = length($pending_cr) ? time() : 0;
}

while (1) {
  unless ($handle) {
    open_handle();
    sleep(0.05);
    next;
  }

  my @path_stat = stat($path);
  if (!@path_stat
      || $path_stat[0] != $device
      || $path_stat[1] != $inode
      || $path_stat[7] < $offset) {
    close_handle();
    next;
  }

  my $read = sysread($handle, my $chunk, 8192);
  if (defined($read) && $read > 0) {
    $offset += $read;
    normalize_chunk($chunk);
    next;
  }
  if (!defined($read)) {
    close_handle();
    sleep(0.05);
    next;
  }

  # Do not leave a terminal carriage return buffered forever when a writer
  # emits a progress update without a following newline.
  if (length($pending_cr) && time() - $pending_since >= 0.25) {
    emit_text("\n");
    $pending_cr = "";
    $pending_since = 0;
  }
  sleep(0.05);
}
PERL
}

stop_l2_console_stream() {
  local stream_pid=""
  for stream_pid in \
    "${l2_console_stream_pid}" \
    "${l2_launcher_stderr_stream_pid}" \
    "${l2_marker_stream_pid}"; do
    if [ -z "${stream_pid}" ]; then
      continue
    fi
    kill "${stream_pid}" 2>/dev/null || true
    wait "${stream_pid}" 2>/dev/null || true
  done
  l2_console_stream_pid=""
  l2_launcher_stderr_stream_pid=""
  l2_marker_stream_pid=""
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
  node - "${state_file}" "${manifest_file}" "${run_dir}" "${status}" "${exit_code}" "${error_message}" "${l1_pid}" "${l1_process_group_id}" "${stdout_log}" "${stderr_log}" "${l1_console_log}" "${l2_console_log}" "${l2_launcher_stdout_log}" "${l2_launcher_stderr_log}" "${l2_launch_marker_log}" "${l2_runtime_share_dir}" "${l2_timing_file}" <<'NODE'
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
  l2TimingFile,
] = process.argv.slice(2);
const state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
const now = new Date().toISOString();
const exitCode = exitCodeRaw === "" ? null : Number(exitCodeRaw);
const l1Pid = l1PidRaw === "" ? null : Number(l1PidRaw);
const l1ProcessGroupId = l1ProcessGroupIdRaw === "" ? null : Number(l1ProcessGroupIdRaw);
let previousManifest = null;
if (fs.existsSync(manifestFile)) {
  try {
    previousManifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
  } catch {}
}
const l2ConsoleText = fs.existsSync(l2ConsoleLog)
  ? fs.readFileSync(l2ConsoleLog, "utf8")
  : "";
const l2LaunchMarkerText = fs.existsSync(l2LaunchMarkerLog)
  ? fs.readFileSync(l2LaunchMarkerLog, "utf8")
  : "";
const l2LaunchMarkerLines = l2LaunchMarkerText
  .replace(/\r/g, "")
  .split("\n")
  .map((line) => line.trim())
  .filter(Boolean);
const launchMode = l2LaunchMarkerLines
  .find((line) => line.startsWith("launch-mode=")) || null;
const qemuCommandLine = l2LaunchMarkerLines
  .find((line) => line.startsWith("qemu-cmd=")) || null;
const qemuCommand = qemuCommandLine ? qemuCommandLine.slice("qemu-cmd=".length) : null;
const directRmeEvidence = {
  confidentialGuestSupport: Boolean(qemuCommand && qemuCommand.includes("confidential-guest-support=rme0")),
  rmeGuestObject: Boolean(qemuCommand && qemuCommand.includes("rme-guest,id=rme0")),
  enableKvm: Boolean(qemuCommand && qemuCommand.includes("-enable-kvm")),
};
const helperLaunchEvidence = launchMode === "launch-mode=linaro-gen-run-vmm"
  && l2LaunchMarkerLines.includes("qemu-exec-start");
const cvmEvidenceObserved = (
  directRmeEvidence.confidentialGuestSupport
  && directRmeEvidence.rmeGuestObject
  && directRmeEvidence.enableKvm
) || helperLaunchEvidence;
const cvmEvidenceLines = l2LaunchMarkerLines.filter((line) => (
  line.startsWith("launch-mode=")
  || line.startsWith("helper-cmd=")
  || line.startsWith("qemu-cmd=")
  || line.startsWith("qemu-seed-consumer=")
  || line.startsWith("qemu-mmio-trace=")
  || line.startsWith("dtb-generator=")
  || line.startsWith("dtb-generated=")
  || line === "qemu-exec-start"
  || line.startsWith("qemu-exit-status=")
));
const guestRsiEvidence = l2ConsoleText
  .replace(/\r/g, "")
  .split("\n")
  .find((line) => line.includes("MORPHEUS_RSI_EVIDENCE:")) || null;
const guestRsiEvidenceMissing = l2ConsoleText.includes("MORPHEUS_RSI_EVIDENCE_MISSING");
const l2Ready = l2ConsoleText.includes("buildroot login:");
const previousL2 = previousManifest
  && previousManifest.runtime
  && previousManifest.runtime.l2
  && typeof previousManifest.runtime.l2 === "object"
  ? previousManifest.runtime.l2
  : {};
let l2StartupTiming = null;
if (fs.existsSync(l2TimingFile)) {
  try {
    l2StartupTiming = JSON.parse(fs.readFileSync(l2TimingFile, "utf8"));
  } catch {}
}
const manifest = {
  schemaVersion: 1,
  tool: "nvirsh-buildroot-based-cvm",
  buildDirKey: state.buildDirKey,
  buildDir: state.buildDir,
  installDir: state.installDir,
  runDir,
  status,
  currentPhase: status === "running"
    ? "launch"
    : status === "stopped"
      ? "stopped"
      : "done",
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
      startupTiming: l2StartupTiming,
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
  createdAt: previousManifest && previousManifest.createdAt ? previousManifest.createdAt : now,
  updatedAt: now,
};
manifest.runtime.l2.ready = l2Ready || Boolean(previousL2.ready);
manifest.runtime.l2.readyAt = manifest.runtime.l2.ready
  ? (previousL2.readyAt || now)
  : null;
manifest.runtime.l2.cvmEvidence = {
  observed: cvmEvidenceObserved || Boolean(previousL2.cvmEvidence && previousL2.cvmEvidence.observed),
  observedAt: cvmEvidenceObserved
    ? (previousL2.cvmEvidence && previousL2.cvmEvidence.observedAt) || now
    : (previousL2.cvmEvidence && previousL2.cvmEvidence.observedAt) || null,
  launchMode,
  markerLines: cvmEvidenceLines,
  qemuCommand,
  directRmeEvidence,
  helperLaunchEvidence,
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

write_result() {
  local result_status="$1"
  local exit_code="$2"
  local message="${3:-}"
  node - "${result_file}" "${run_dir}" "${manifest_file}" "${phase}" "${build_dir_key}" \
    "${l1_console_log}" "${l2_console_log}" "${l2_launcher_stdout_log}" \
    "${l2_launcher_stderr_log}" "${l2_launch_marker_log}" "${result_status}" \
    "${exit_code}" "${message}" "${l2_timing_file}" <<'NODE'
const fs = require("fs");
const path = require("path");
const [
  resultFile,
  runDir,
  manifestFile,
  phase,
  buildDirKey,
  l1ConsoleLog,
  l2ConsoleLog,
  l2LauncherStdoutLog,
  l2LauncherStderrLog,
  l2LaunchMarkerLog,
  resultStatus,
  exitCodeRaw,
  message,
  l2TimingFile,
] = process.argv.slice(2);
const details = {
  run_dir: runDir,
  manifest: manifestFile,
  phase,
  build_dir_key: buildDirKey,
  detached: false,
  l1_console_log: l1ConsoleLog,
  l2_console_log: l2ConsoleLog,
  l2_launcher_stdout_log: l2LauncherStdoutLog,
  l2_launcher_stderr_log: l2LauncherStderrLog,
  l2_launch_marker: l2LaunchMarkerLog,
  l2_boot_timing: l2TimingFile,
};
if (resultStatus === "stopped") {
  details.stopped = true;
  details.stop_reason = message || "buildroot-based CVM launch stopped";
} else if (message) {
  details.error_message = message;
}
const payload = {
  details,
};
payload.artifacts = [
  { path: "run-manifest", location: manifestFile },
];
if (fs.existsSync(l2TimingFile)) {
  try {
    payload.l2_boot_timing = JSON.parse(fs.readFileSync(l2TimingFile, "utf8"));
    payload.artifacts.push({ path: "l2-startup-timing", location: l2TimingFile });
  } catch {}
}
const exitCode = Number(exitCodeRaw);
if (Number.isInteger(exitCode)) {
  payload.exit_code = exitCode;
}
fs.mkdirSync(path.dirname(resultFile), { recursive: true });
fs.writeFileSync(resultFile, `${JSON.stringify(payload, null, 2)}\n`);
NODE
}

append_runtime_notice() {
  local message="$1"
  printf '%s\n' "${message}" | tee -a "${stdout_log}" >&2
}

observe_l2_runtime() {
  local manifest_changed="false"
  local launch_mode_line=""
  local qemu_cmd_line=""
  local helper_cmd_line=""
  local rsi_line=""

  if [ "${measure_l2_startup}" = "true" ] \
    && [ -z "${l2_qemu_exec_start_ns}" ] \
    && [ -f "${l2_launch_marker_log}" ] \
    && LC_ALL=C grep -a -q -- 'qemu-exec-start' "${l2_launch_marker_log}" 2>/dev/null; then
    l2_qemu_exec_start_ns="$(host_time_ns)"
  fi

  if [ "${l2_cvm_evidence_reported}" != "true" ] \
    && [ -f "${l2_launch_marker_log}" ] \
    && LC_ALL=C grep -a -q -- 'qemu-exec-start' "${l2_launch_marker_log}" 2>/dev/null; then
    launch_mode_line="$(LC_ALL=C grep -a -m1 -- '^launch-mode=' "${l2_launch_marker_log}" 2>/dev/null | tr -d '\r' || true)"
    qemu_cmd_line="$(LC_ALL=C grep -a -m1 -- '^qemu-cmd=' "${l2_launch_marker_log}" 2>/dev/null | tr -d '\r' || true)"
    helper_cmd_line="$(LC_ALL=C grep -a -m1 -- '^helper-cmd=' "${l2_launch_marker_log}" 2>/dev/null | tr -d '\r' || true)"
    append_runtime_notice "[nvirsh-buildroot-based-cvm] observed L2 CVM launch evidence"
    [ -n "${launch_mode_line}" ] && append_runtime_notice "[nvirsh-buildroot-based-cvm] ${launch_mode_line}"
    [ -n "${qemu_cmd_line}" ] && append_runtime_notice "[nvirsh-buildroot-based-cvm] ${qemu_cmd_line}"
    [ -n "${helper_cmd_line}" ] && append_runtime_notice "[nvirsh-buildroot-based-cvm] ${helper_cmd_line}"
    if [ -n "${qemu_cmd_line}" ] \
      && [[ "${qemu_cmd_line}" == *"confidential-guest-support=rme0"* ]] \
      && [[ "${qemu_cmd_line}" == *"rme-guest,id=rme0"* ]] \
      && [[ "${qemu_cmd_line}" == *"-enable-kvm"* ]]; then
      append_runtime_notice "[nvirsh-buildroot-based-cvm] L2 QEMU is configured as an RME confidential guest with KVM"
    elif [ "${l2_launch_mode}" = "linaro-gen-run-vmm" ]; then
      append_runtime_notice "[nvirsh-buildroot-based-cvm] L2 helper launch reached its guest execution point"
    else
      append_runtime_notice "[nvirsh-buildroot-based-cvm] L2 launch marker reached guest execution without a complete RME command line"
    fi
    l2_cvm_evidence_reported="true"
    manifest_changed="true"
  fi

  if [ "${l2_rsi_status_reported}" != "true" ] \
    && [ "${l2_launch_mode}" = "linaro-gen-run-vmm" ] \
    && [ -f "${l2_console_log}" ]; then
    if LC_ALL=C grep -a -q -- "${l2_rsi_evidence_marker}" "${l2_console_log}" 2>/dev/null; then
      rsi_line="$(LC_ALL=C grep -a -m1 -- "${l2_rsi_evidence_marker}" "${l2_console_log}" 2>/dev/null | tr -d '\r' || true)"
      append_runtime_notice "[nvirsh-buildroot-based-cvm] observed guest RSI evidence: ${rsi_line}"
      l2_rsi_status_reported="true"
      manifest_changed="true"
    elif LC_ALL=C grep -a -q -- "${l2_rsi_evidence_missing_marker}" "${l2_console_log}" 2>/dev/null; then
      append_runtime_notice "[nvirsh-buildroot-based-cvm] guest RSI evidence marker reported missing"
      l2_rsi_status_reported="true"
      manifest_changed="true"
    fi
  fi

  if [ "${l2_ready_reported}" != "true" ] \
    && [ -f "${l2_console_log}" ] \
    && LC_ALL=C grep -a -q -- 'buildroot login:' "${l2_console_log}" 2>/dev/null; then
    if [ "${measure_l2_startup}" = "true" ] && [ -z "${l2_buildroot_ready_ns}" ]; then
      l2_buildroot_ready_ns="$(host_time_ns)"
    fi
    append_runtime_notice "[nvirsh-buildroot-based-cvm] observed L2 buildroot login prompt; continuing until stop"
    l2_ready_reported="true"
    manifest_changed="true"
  fi

  if [ "${manifest_changed}" = "true" ]; then
    if ! write_manifest "running" "" "" "${l1_pid}" "${l1_process_group_id}"; then
      append_runtime_notice "[nvirsh-buildroot-based-cvm] warning: could not update the running manifest"
    fi
  fi
}

finish_ready() {
  terminate_l1_process "${l1_pid}" "${l1_process_group_id}"
  stop_l2_console_stream
  rm -f "${l1_pid_file}"
  normalize_console_log "${stdout_log}"
  normalize_console_log "${stderr_log}"
  normalize_console_log "${l1_console_log}"
  normalize_console_log "${l2_launcher_stdout_log}"
  normalize_console_log "${l2_launcher_stderr_log}"
  normalize_console_log "${l2_console_log}"
  write_l2_startup_timing
  write_manifest "success" "0" "" "" ""
  write_result "success" "0" ""
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
  write_l2_startup_timing
  write_manifest "stopped" "130" "${reason}" "" ""
  write_result "stopped" "130" "${reason}"
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
if command -v perl >/dev/null 2>&1; then
  follow_runtime_log "${l2_console_log}" "" >&2 &
  l2_console_stream_pid="$!"
  follow_runtime_log "${l2_launcher_stderr_log}" \
    '[nvirsh-buildroot-based-cvm] L2 launcher stderr: ' >&2 &
  l2_launcher_stderr_stream_pid="$!"
  follow_runtime_log "${l2_launch_marker_log}" \
    '[nvirsh-buildroot-based-cvm] L2 launch marker: ' >&2 &
  l2_marker_stream_pid="$!"
fi

l1_launch_cmd="mount -t 9p -o trans=virtio,version=9p2000.L host /mnt"
if [ -n "${l2_smp}" ]; then
  l1_launch_cmd="${l1_launch_cmd} && export MORPHEUS_L2_SMP=${l2_smp}"
fi
if [ -n "${l2_memory_mb}" ]; then
  l1_launch_cmd="${l1_launch_cmd} && export MORPHEUS_L2_MEMORY_MB=${l2_memory_mb}"
fi
if [ "${l2_runtime_subdir}" != "morpheus-l2-runtime" ]; then
  l1_launch_cmd="${l1_launch_cmd} && export MORPHEUS_L2_RUNTIME_DIR=/mnt/${l2_runtime_subdir}"
fi
l1_launch_cmd="${l1_launch_cmd} && exec /mnt/launch-l2-hoststack.sh"
l1_args_file="$(mktemp "${run_dir}/l1-qemu-args.XXXXXX")"
l1_launch_args=(
  --state "${state_file}"
  --run-dir "${run_dir}"
  --boot-command "${l1_launch_cmd}"
)
if [ -n "${l1_smp_override}" ]; then
  l1_launch_args+=(--l1-cpus "${l1_smp_override}")
fi
bash "${script_dir}/l1-launch.sh" \
  "${l1_launch_args[@]}" > "${l1_args_file}"
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

launch_started_at="${SECONDS}"
next_progress_at="${SECONDS}"
launch_timeout_seconds="${MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_LAUNCH_TIMEOUT_SECONDS:-2100}"
poll_interval_seconds="1"
if [ "${measure_l2_startup}" = "true" ]; then
  poll_interval_seconds="0.02"
fi
while :; do
  observe_l2_runtime

  if [ "${stop_on_ready}" = "true" ] && [ "${l2_ready_reported}" = "true" ]; then
    finish_ready
    exit 0
  fi

  if [ -f "${stop_request_file}" ]; then
    finish_stopped "stop requested"
    exit 130
  fi

  if ! kill -0 "${l1_pid}" 2>/dev/null; then
    set +e
    wait "${l1_pid}"
    l1_exit_status="$?"
    set -e
    break
  fi

  if [ "${SECONDS}" -ge "${next_progress_at}" ]; then
    elapsed=$((SECONDS - launch_started_at))
    printf '[nvirsh-buildroot-based-cvm] L1 host stack running; waiting for L2 CVM evidence/login (%ss elapsed)\n' \
      "${elapsed}" | tee -a "${stdout_log}" >&2
    next_progress_at=$((SECONDS + 15))
  fi

  if [ "${launch_timeout_seconds}" -gt 0 ] \
    && [ "$((SECONDS - launch_started_at))" -ge "${launch_timeout_seconds}" ]; then
    l1_exit_status=124
    failure_message="timed out while keeping L1 host stack running"
    terminate_l1_process "${l1_pid}" "${l1_process_group_id}"
    break
  fi
  sleep "${poll_interval_seconds}"
done

if [ -f "${stop_request_file}" ]; then
  finish_stopped "stop requested"
  exit 130
fi

stop_l2_console_stream
rm -f "${l1_pid_file}"
normalize_console_log "${stdout_log}"
normalize_console_log "${stderr_log}"
normalize_console_log "${l1_console_log}"
normalize_console_log "${l2_launcher_stdout_log}"
normalize_console_log "${l2_launcher_stderr_log}"
normalize_console_log "${l2_console_log}"
if [ "${l1_exit_status:-1}" -eq 124 ]; then
  failure_message="timed out while keeping L1 host stack running"
else
  failure_message="$(failure_detail)"
fi
if [ -z "${failure_message}" ]; then
  failure_message="L1 host stack exited before the CVM workflow was stopped"
fi
write_l2_startup_timing
case "${l1_exit_status:-1}" in
  0|137|143)
    l1_exit_status=1
    ;;
esac
write_manifest "error" "${l1_exit_status:-1}" "${failure_message}" "" ""
write_result "error" "${l1_exit_status:-1}" "${failure_message}"
exit "${l1_exit_status:-1}"
