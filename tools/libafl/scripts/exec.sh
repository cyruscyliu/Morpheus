#!/usr/bin/env bash
set -euo pipefail

# Optional project override (tests / rare custom harnesses).
# When unset, this script is the default nested-QEMU harness.
_libafl_harness_override="${MORPHEUS_LIBAFL_HARNESS_SCRIPT:-}"
if [ -n "${_libafl_harness_override}" ]; then
  _self="$(realpath "${BASH_SOURCE[0]}")"
  _over="$(realpath "${_libafl_harness_override}" 2>/dev/null || true)"
  if [ -n "${_over}" ] && [ "${_over}" != "${_self}" ]; then
    source "$(dirname "${BASH_SOURCE[0]}")/../../_shared/scripts/project-hook.sh"
    harness_arg_file="${MORPHEUS_LIBAFL_HARNESS_ARG_FILE:-}"
    harness_args=()
    if [ -n "${harness_arg_file}" ] && [ -s "${harness_arg_file}" ]; then
      mapfile -t harness_args < "${harness_arg_file}"
    fi
    morpheus_delegate_project_hook \
      "${BASH_SOURCE[0]}" \
      "${_libafl_harness_override}" \
      "libafl harness" \
      "${harness_args[@]}"
  fi
fi

source_dir="${MORPHEUS_LIBAFL_SOURCE:?}"
run_dir="${MORPHEUS_LIBAFL_RUN_DIR:?}"
install_dir="${MORPHEUS_LIBAFL_INSTALL_DIR:?}"
detach="${MORPHEUS_LIBAFL_DETACH:-false}"
run_seconds="${MORPHEUS_LIBAFL_RUN_SECONDS:-0}"
result_file="${MORPHEUS_LIBAFL_RESULT_FILE:-${MORPHEUS_SCRIPT_RESULT_FILE:?}}"
source "$(dirname "${BASH_SOURCE[0]}")/../../_shared/scripts/parallelism.sh"

nvirsh_state=""
l2_run_window_ms=""
l2_mode="vm"
l2_accel="auto"
l2_cpu=""
disable_nqc2_plugin="false"
capture_runtime="false"
replay_inputs=()
seed_inputs=()
devilang_states=()
devilang_grammar=""
fuzz_virtio_ids=""
fuzz_virtio_ids_set=false

# Morpheus scripted exec passes repeatable harness-arg via env/file, not argv.
# Load those when the script is invoked with no positional args.
if [ "$#" -eq 0 ]; then
  harness_arg_file="${MORPHEUS_LIBAFL_HARNESS_ARG_FILE:-}"
  if [ -n "${harness_arg_file}" ] && [ -s "${harness_arg_file}" ]; then
    mapfile -t _harness_from_file < "${harness_arg_file}"
    set -- "${_harness_from_file[@]}"
  elif [ -n "${MORPHEUS_LIBAFL_HARNESS_ARG:-}" ]; then
    mapfile -t _harness_from_env <<< "${MORPHEUS_LIBAFL_HARNESS_ARG}"
    set -- "${_harness_from_env[@]}"
  fi
fi

while [ "$#" -gt 0 ]; do
  case "$1" in
    --nvirsh-state) shift; nvirsh_state="${1:-}" ;;
    --l2-run-window-ms) shift; l2_run_window_ms="${1:-}" ;;
    --l2-mode) shift; l2_mode="${1:-}" ;;
    --l2-accel) shift; l2_accel="${1:-}" ;;
    --l2-cpu) shift; l2_cpu="${1:-}" ;;
    --replay-input) shift; replay_inputs+=("${1:-}") ;;
    --seed-input) shift; seed_inputs+=("${1:-}") ;;
    --devilang-state) shift; devilang_states+=("${1:-}") ;;
    --devilang-grammar) shift; devilang_grammar="${1:-}" ;;
    --fuzz-virtio-ids)
      shift
      fuzz_virtio_ids="${1:-}"
      fuzz_virtio_ids_set=true
      ;;
    --disable-nqc2-plugin) disable_nqc2_plugin="true" ;;
    --capture-runtime) capture_runtime="true" ;;
    *) echo "unknown qemu_nesting harness argument: $1" >&2; exit 1 ;;
  esac
  shift
done

if [ "${fuzz_virtio_ids_set}" = "false" ] &&
   [ "${MORPHEUS_QEMU_FUZZ_VIRTIO_IDS+x}" = "x" ]; then
  fuzz_virtio_ids="${MORPHEUS_QEMU_FUZZ_VIRTIO_IDS}"
  fuzz_virtio_ids_set=true
fi

if [ "${fuzz_virtio_ids_set}" = "true" ]; then
  case "${fuzz_virtio_ids}" in
    *[!0-9A-Fa-fxX,]*)
      echo "--fuzz-virtio-ids accepts comma-separated decimal or hexadecimal IDs" >&2
      exit 1
      ;;
  esac
fi

manifest_file="${run_dir}/manifest.json"
l1_runtime_dir="${run_dir}/l1-runtime"
corpus_dir="${run_dir}/corpus"
objective_dir="${run_dir}/objectives"
replay_inputs_file="${run_dir}/replay-inputs.txt"
replay_state_file="${run_dir}/replay-state.json"
seed_inputs_file="${run_dir}/seed-inputs.txt"
devilang_states_file="${run_dir}/devilang-states.txt"
devilang_grammar_file="${run_dir}/devilang-grammar.path"
step_log_file="${run_dir%/}/../stdout.log"
runner_log_file="${run_dir}/launcher.stdout.log"
fuzzer_bin="${install_dir}/bin/qemu_nesting"
stub_elf="${install_dir}/bin/libafl_nesting_stub"
bridge_dir="${install_dir}/../build/qemu-libafl-bridge"
qemu_bundle_dir="${bridge_dir}/build/qemu-bundle/usr/local/share/qemu"
workspace_root="${MORPHEUS_LIBAFL_WORKSPACE:-${MORPHEUS_SCRIPT_WORKSPACE:-}}"
if [ -z "${workspace_root}" ]; then
  echo "missing Morpheus workspace root for qemu_nesting harness" >&2
  exit 1
fi
workspace_root="$(cd "${workspace_root}" && pwd)"
repo_root="${MORPHEUS_REPO_ROOT:-}"
if [ -z "${repo_root}" ]; then
  repo_root="$(cd "${workspace_root}/../.." && pwd)"
fi
repo_root="$(cd "${repo_root}" && pwd)"

mkdir -p "${run_dir}" "${l1_runtime_dir}" "${corpus_dir}" "${objective_dir}" "$(dirname "${result_file}")"
find "${l1_runtime_dir}" -mindepth 1 -maxdepth 1 -exec rm -rf {} +
find "${corpus_dir}" -mindepth 1 -maxdepth 1 -exec rm -rf {} +
find "${objective_dir}" -mindepth 1 -maxdepth 1 -exec rm -rf {} +
rm -f "${replay_inputs_file}" "${replay_state_file}"
rm -f "${seed_inputs_file}"
rm -f "${devilang_states_file}"
rm -f "${devilang_grammar_file}"
: > "${runner_log_file}"

manifest_pid=""
if [ -f "${manifest_file}" ]; then
  manifest_pid="$(node -e 'const fs=require("fs"); try { const m=JSON.parse(fs.readFileSync(process.argv[1], "utf8")); process.stdout.write(String(m.pid || "")); } catch {}' "${manifest_file}")"
fi

kill_run() {
  local pid="$1"
  [ -n "${pid}" ] || return 0
  kill -TERM -- "-${pid}" 2>/dev/null || true
  sleep 1
  kill -KILL -- "-${pid}" 2>/dev/null || true
}

kill_run "${manifest_pid}"

[ -n "${nvirsh_state}" ] || { echo "missing qemu_nesting harness argument: --nvirsh-state" >&2; exit 1; }
[ -f "${nvirsh_state}" ] || { echo "missing prepared nvirsh state: ${nvirsh_state}" >&2; exit 1; }
[ -x "${fuzzer_bin}" ] || { echo "missing qemu_nesting fuzzer binary: ${fuzzer_bin}" >&2; exit 1; }
[ -f "${stub_elf}" ] || { echo "missing guest stub ELF: ${stub_elf}" >&2; exit 1; }

replay_enabled=false
if [ "${#replay_inputs[@]}" -gt 0 ]; then
  node - "${replay_inputs_file}" "${replay_state_file}" "${workspace_root}" "${repo_root}" "${replay_inputs[@]}" <<'NODE'
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const outputFile = process.argv[2];
const stateFile = process.argv[3];
const workspaceRoot = process.argv[4];
const repoRoot = process.argv[5];
const roots = process.argv.slice(6);
const inputs = [];
function resolveInputPath(input) {
  const candidates = [
    path.resolve(input),
    path.resolve(workspaceRoot, input),
    path.resolve(repoRoot, input),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return path.resolve(input);
}
function addFile(file) {
  const stat = fs.statSync(file);
  if (!stat.isFile()) return;
  const base = path.basename(file);
  if (base.startsWith(".") || base.endsWith(".metadata")) return;
  inputs.push(path.resolve(file));
}
for (const root of roots) {
  const resolved = resolveInputPath(root);
  const stat = fs.statSync(resolved);
  if (stat.isDirectory()) {
    for (const entry of fs.readdirSync(resolved).sort()) addFile(path.join(resolved, entry));
  } else {
    addFile(resolved);
  }
}
const unique = [...new Set(inputs)].sort();
if (unique.length === 0) throw new Error("no replay inputs resolved");
fs.writeFileSync(outputFile, `${unique.join("\n")}\n`);
const entries = unique.map((file, index) => {
  const data = fs.readFileSync(file);
  return { index, path: file, size: data.length, sha256: crypto.createHash("sha256").update(data).digest("hex") };
});
fs.writeFileSync(stateFile, JSON.stringify({
  schemaVersion: 1,
  tool: "libafl",
  mode: "replay",
  inputCount: entries.length,
  inputs: entries,
  runtimeGroups: [],
}, null, 2));
NODE
  replay_enabled=true
fi

if [ "${#seed_inputs[@]}" -gt 0 ]; then
  node - "${seed_inputs_file}" "${workspace_root}" "${repo_root}" "${seed_inputs[@]}" <<'NODE'
const fs = require("fs");
const path = require("path");
const outputFile = process.argv[2];
const workspaceRoot = process.argv[3];
const repoRoot = process.argv[4];
const roots = process.argv.slice(5);
const inputs = [];
function resolveInputPath(input) {
  const candidates = [
    path.resolve(input),
    path.resolve(workspaceRoot, input),
    path.resolve(repoRoot, input),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return path.resolve(input);
}
function addFile(file) {
  const stat = fs.statSync(file);
  if (!stat.isFile()) return;
  const base = path.basename(file);
  if (base.startsWith(".") || base.endsWith(".metadata")) return;
  inputs.push(path.resolve(file));
}
for (const root of roots) {
  const resolved = resolveInputPath(root);
  const stat = fs.statSync(resolved);
  if (stat.isDirectory()) {
    for (const entry of fs.readdirSync(resolved).sort()) addFile(path.join(resolved, entry));
  } else {
    addFile(resolved);
  }
}
const unique = [...new Set(inputs)].sort();
if (unique.length === 0) throw new Error("no seed inputs resolved");
fs.writeFileSync(outputFile, `${unique.join("\n")}\n`);
NODE
fi

if [ "${#devilang_states[@]}" -gt 0 ]; then
  node - "${devilang_states_file}" "${workspace_root}" "${repo_root}" "${devilang_states[@]}" <<'NODE'
const fs = require("fs");
const path = require("path");
const outputFile = process.argv[2];
const workspaceRoot = process.argv[3];
const repoRoot = process.argv[4];
const roots = process.argv.slice(5);
const inputs = [];
function resolveInputPath(input) {
  const candidates = [
    path.resolve(input),
    path.resolve(workspaceRoot, input),
    path.resolve(repoRoot, input),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return path.resolve(input);
}
function addFile(file) {
  const stat = fs.statSync(file);
  if (!stat.isFile()) return;
  if (!file.endsWith(".state")) return;
  inputs.push(path.resolve(file));
}
for (const root of roots) {
  const resolved = resolveInputPath(root);
  const stat = fs.statSync(resolved);
  if (stat.isDirectory()) {
    for (const entry of fs.readdirSync(resolved).sort()) addFile(path.join(resolved, entry));
  } else {
    addFile(resolved);
  }
}
const unique = [...new Set(inputs)].sort();
if (unique.length === 0) throw new Error("no devilang state files resolved");
fs.writeFileSync(outputFile, `${unique.join("\n")}\n`);
NODE
fi

if [ -n "${devilang_grammar}" ]; then
  node - "${devilang_grammar_file}" "${workspace_root}" "${repo_root}" "${devilang_grammar}" <<'NODE'
const fs = require("fs");
const path = require("path");
const outputFile = process.argv[2];
const workspaceRoot = process.argv[3];
const repoRoot = process.argv[4];
const input = process.argv[5];
const candidates = [
  path.resolve(input),
  path.resolve(workspaceRoot, input),
  path.resolve(repoRoot, input),
];
const resolved = candidates.find((candidate) => fs.existsSync(candidate));
if (!resolved) {
  throw new Error(`no Devilang grammar path found for ${input}`);
}
fs.writeFileSync(outputFile, `${path.resolve(resolved)}\n`);
NODE
fi

if [ "${replay_enabled}" = "true" ] && [ "${detach}" = "true" ]; then
  echo "libafl replay does not support --detach" >&2
  exit 1
fi
if [ -n "${l2_run_window_ms}" ]; then
  if ! [[ "${l2_run_window_ms}" =~ ^[0-9]+$ ]] || [ "${l2_run_window_ms}" -lt 1000 ] || [ "${l2_run_window_ms}" -gt 900000 ]; then
    echo "l2-run-window-ms must be an integer between 1000 and 900000" >&2
    exit 1
  fi
fi
case "${l2_mode}" in vm|cvm) ;; *) echo "l2-mode must be one of: vm, cvm" >&2; exit 1 ;; esac
case "${l2_accel}" in auto|kvm|tcg) ;; *) echo "l2-accel must be one of: auto, kvm, tcg" >&2; exit 1 ;; esac
if [ -n "${l2_cpu}" ]; then
  case "${l2_cpu}" in host|max|cortex-a57) ;; *) echo "l2-cpu must be one of: host, max, cortex-a57" >&2; exit 1 ;; esac
fi

printf '[libafl/qemu_nesting] l2 controls: mode=%s accel=%s cpu=%s window_ms=%s\n' \
  "${l2_mode}" "${l2_accel}" "${l2_cpu:-default}" "${l2_run_window_ms:-default}" >&2

MORPHEUS_NVIRSH_INSTALL_DIR="$(dirname "${nvirsh_state}")" \
MORPHEUS_NVIRSH_RESULT_FILE="${run_dir}/nvirsh-stop.json" \
"${repo_root}/tools/nvirsh/scripts/stop.sh"

mapfile -d '' -t state_fields < <(
  node - "${nvirsh_state}" <<'NODE'
const fs = require("fs");
const path = require("path");
const state = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const tool = String(state.tool || "");
const host = (state.hostLaunch && typeof state.hostLaunch === "object")
  ? state.hostLaunch
  : {};
const firmware = String(host.firmwareA || host.firmware || "");
const firmwareB = String(host.firmwareB || "");
const overlay = String(host.overlayImage || "");
const seed = (state.hostLaunch && state.hostLaunch.seedImage) || "";
const buildDir = state.buildDir || "";
const l1Args = (state.profileData && state.profileData.l1 && Array.isArray(state.profileData.l1.launcherArgs))
  ? state.profileData.l1.launcherArgs
  : [];
let cpu = String(host.cpu || "cortex-a57");
let memory = String(host.memory || "8192");
let smp = String(host.cpus || "4");
let machine = String(host.machine || "");
let cmdline = String(host.cmdline || "");
let accel = String(host.accel || "");
let enableKvm = String(Boolean(host.enableKvm));
for (let i = 0; i < l1Args.length - 1; i += 1) {
  if (!host.cpu && l1Args[i] === "-cpu") cpu = String(l1Args[i + 1]);
  if (!host.memory && l1Args[i] === "-m") memory = String(l1Args[i + 1]);
  if (!host.cpus && l1Args[i] === "-smp") smp = String(l1Args[i + 1]);
  if (!host.machine && l1Args[i] === "-machine") machine = String(l1Args[i + 1]);
  if (!host.cmdline && l1Args[i] === "-append") cmdline = String(l1Args[i + 1]);
  if (!host.accel && l1Args[i] === "-accel") accel = String(l1Args[i + 1]);
  if (!host.enableKvm && l1Args[i] === "-enable-kvm") enableKvm = "true";
}
const l1State = (state.layeredState && state.layeredState.l1) || {};
const hostStack = l1State.hostStack || {};
const hoststackRootfs = l1State.rootfs
  || hostStack.rootfs
  || path.join(buildDir, "l1", "cca-host-stack", "out", "host.ext4");
const hoststackShareDir = l1State.shareDir
  || l1State.runtimeShareDir
  || path.join(buildDir, "l1");
const hoststackLaunch = l1State.launchScriptHoststack
  || path.join(buildDir, "l1", "launch-l2-hoststack.sh");
const hostKernel = String(host.kernel || "");
process.stdout.write(
  [
    tool,
    firmware,
    firmwareB,
    overlay,
    seed,
    buildDir,
    cpu,
    memory,
    smp,
    machine,
    cmdline,
    hoststackRootfs,
    hoststackShareDir,
    hoststackLaunch,
    hostKernel,
    accel,
    enableKvm,
  ].join("\0"),
);
process.stdout.write("\0");
NODE
)

nvirsh_state_tool="${state_fields[0]:-}"
firmware="${state_fields[1]:-}"
firmware_b="${state_fields[2]:-}"
overlay_image="${state_fields[3]:-}"
l1_build_dir="${state_fields[5]:-}"
l1_cpu="${state_fields[6]:-}"
l1_memory="${state_fields[7]:-}"
l1_smp="${state_fields[8]:-}"
l1_machine="${state_fields[9]:-}"
l1_cmdline_from_state="${state_fields[10]:-}"
l1_hoststack_rootfs="${state_fields[11]:-}"
l1_hoststack_share_dir="${state_fields[12]:-}"
l1_hoststack_launch="${state_fields[13]:-}"
l1_host_kernel="${state_fields[14]:-}"
l1_accel="${state_fields[15]:-}"
l1_enable_kvm="${state_fields[16]:-false}"
libafl_l1_smp_requested="${MORPHEUS_LIBAFL_L1_SMP:-${l1_smp:-}}"
l1_memory_requested="${MORPHEUS_LIBAFL_L1_MEMORY:-${l1_memory:-}}"
libafl_l1_smp="$(morpheus_resolve_l1_qemu_cpus "${libafl_l1_smp_requested}")"
l1_memory="$(morpheus_resolve_l1_qemu_memory_mb "${l1_memory_requested}")"
qemu_data_dir="${qemu_bundle_dir}"
firmware_data_dir="$(dirname "${firmware}")"
direct_l1_kernel="${l1_host_kernel:-${l1_build_dir}/l1/host-boot/vmlinuz}"
direct_l1_initrd="${l1_build_dir}/l1/host-boot/initrd.img"
direct_l1_cmdline="${l1_build_dir}/l1/host-boot/cmdline.txt"
sanitize_bootargs() {
  printf '%s\n' "$1" \
    | sed \
        -e 's/\<BOOT_IMAGE=[^ ]*//g' \
        -e 's/\<init=[^ ]*//g' \
        -e 's/  */ /g' \
        -e 's/^ //' \
        -e 's/ $//'
}
if [ -f "${direct_l1_cmdline}" ]; then
  direct_l1_append="$(sanitize_bootargs "$(cat "${direct_l1_cmdline}")")"
elif [ -n "${l1_cmdline_from_state}" ]; then
  direct_l1_append="$(sanitize_bootargs "${l1_cmdline_from_state}")"
else
  direct_l1_append="root=PARTUUID=48bd50df-bfd1-4457-8648-8026f634af47 ro"
fi
direct_l1_append="${direct_l1_append} init=/root/libafl_nesting_stub norandmaps rw"
if [ ! -f "${qemu_data_dir}/efi-virtio.rom" ] && [ -f "${firmware_data_dir}/efi-virtio.rom" ]; then
  qemu_data_dir="${firmware_data_dir}"
elif [ ! -f "${qemu_data_dir}/efi-virtio.rom" ] && [ -f "/usr/share/qemu/efi-virtio.rom" ]; then
  qemu_data_dir="/usr/share/qemu"
fi

extract_l1_runtime_from_log() {
  local output_dir="$1"
  local log_file="$2"
  local replay_mode="${3:-false}"
  local replay_state="${4:-}"
  [ -f "${log_file}" ] || return 0
  node - "${log_file}" "${output_dir}" "${replay_mode}" "${replay_state}" <<'NODE'
const fs = require("fs");
const path = require("path");
const logFile = process.argv[2];
const outputDir = process.argv[3];
const replayMode = process.argv[4] === "true";
const replayStateFile = process.argv[5] || "";
const safeName = /^[A-Za-z0-9._-]+$/;
const records = new Map();
const runtimeGroups = [];
const outcomes = [];
let replayIndex = 0;
let outcomeIndex = 0;
let pendingOutcome = null;
function resetRecord(name, size, dumped, truncated) {
  if (!safeName.test(name)) return;
  records.set(name, { size: Number(size), dumped: Number(dumped), truncated: truncated === "1", chunks: new Map(), complete: false });
}
function recordFor(name) {
  if (!safeName.test(name) || !records.has(name)) return null;
  return records.get(name);
}
function writeRecordToDir(dir, name, record) {
  if (!record || !record.complete) return;
  const chunks = [...record.chunks.entries()].sort((a, b) => a[0] - b[0]).map((entry) => entry[1]);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), Buffer.concat(chunks));
}
function flushRuntimeGroup() {
  if (records.size === 0) {
    pendingOutcome = null;
    return;
  }

  let wrote = false;
  if (pendingOutcome) {
    const groupName = `${String(outcomeIndex).padStart(6, "0")}-${pendingOutcome.kind}`;
    const groupDir = path.join(outputDir, "outcomes", groupName);
    for (const [name, record] of records.entries()) {
      if (record.complete) {
        writeRecordToDir(groupDir, name, record);
        wrote = true;
      }
    }
    if (wrote) {
      fs.writeFileSync(
        path.join(groupDir, "outcome.json"),
        JSON.stringify(pendingOutcome, null, 2),
      );
      outcomes.push({ index: outcomeIndex, ...pendingOutcome, dir: groupDir });
      outcomeIndex += 1;
    }
  } else if (replayMode) {
    const groupName = `replay-${String(replayIndex).padStart(6, "0")}`;
    const groupDir = path.join(outputDir, groupName);
    for (const [name, record] of records.entries()) {
      if (record.complete) {
        writeRecordToDir(groupDir, name, record);
        writeRecordToDir(outputDir, name, record);
        wrote = true;
      }
    }
    if (wrote) {
      runtimeGroups.push({ index: replayIndex, dir: groupDir });
      replayIndex += 1;
    }
  }
  records.clear();
  pendingOutcome = null;
}
const logPrefix = "LQPRINTF: ";
const content = fs.readFileSync(logFile, "utf8");
for (const line of content.split(/\r?\n/)) {
  const index = line.indexOf(logPrefix);
  const message = index >= 0 ? line.slice(index + logPrefix.length) : line;
  let match = message.match(/^stub-outcome kind=(kernel-panic|launcher-exit|launcher-signal|harness-error) detail=(-?\d+)$/);
  if (match) {
    pendingOutcome = { kind: match[1], detail: Number(match[2]) };
    continue;
  }
  match = message.match(/^stub-runtime begin name=([A-Za-z0-9._-]+) size=(\d+) dumped=(\d+) truncated=([01])$/);
  if (match) { resetRecord(match[1], match[2], match[3], match[4]); continue; }
  match = message.match(/^stub-runtime data name=([A-Za-z0-9._-]+) offset=(\d+) hex=([0-9a-f]*)$/);
  if (match) {
    const record = recordFor(match[1]);
    if (!record || !/^(?:[0-9a-f]{2})*$/.test(match[3])) continue;
    record.chunks.set(Number(match[2]), Buffer.from(match[3], "hex"));
    continue;
  }
  match = message.match(/^stub-runtime end name=([A-Za-z0-9._-]+)$/);
  if (match) {
    const record = recordFor(match[1]);
    if (record) {
      record.complete = true;
      if (!replayMode && !pendingOutcome) writeRecordToDir(outputDir, match[1], record);
    }
    continue;
  }
  if (message === "stub: dumped runtime files to log") flushRuntimeGroup();
}
flushRuntimeGroup();
if (outcomes.length > 0) {
  fs.writeFileSync(path.join(outputDir, "outcomes.json"), JSON.stringify(outcomes, null, 2));
}
if (replayMode && replayStateFile && fs.existsSync(replayStateFile)) {
  const state = JSON.parse(fs.readFileSync(replayStateFile, "utf8"));
  state.runtimeGroups = runtimeGroups;
  state.outcomes = outcomes;
  fs.writeFileSync(replayStateFile, JSON.stringify(state, null, 2));
}
NODE
}

write_result() {
  if [ "${replay_enabled}" = "true" ]; then
    cat > "${result_file}" <<EOF
{"details":{"pid":null,"detached":false,"run_dir":"${run_dir}","manifest":"${manifest_file}","l1_runtime_dir":"${l1_runtime_dir}","corpus_dir":"${corpus_dir}","objective_dir":"${objective_dir}","replay_state":"${replay_state_file}","replay_inputs":"${replay_inputs_file}"},"artifacts":[{"path":"l1-runtime-dir","location":"${l1_runtime_dir}"},{"path":"corpus-dir","location":"${corpus_dir}"},{"path":"objective-dir","location":"${objective_dir}"},{"path":"replay-state","location":"${replay_state_file}"},{"path":"replay-inputs","location":"${replay_inputs_file}"}]}
EOF
  else
    cat > "${result_file}" <<EOF
{"details":{"pid":null,"detached":false,"run_dir":"${run_dir}","manifest":"${manifest_file}","l1_runtime_dir":"${l1_runtime_dir}","corpus_dir":"${corpus_dir}","objective_dir":"${objective_dir}"},"artifacts":[{"path":"l1-runtime-dir","location":"${l1_runtime_dir}"},{"path":"corpus-dir","location":"${corpus_dir}"},{"path":"objective-dir","location":"${objective_dir}"}]}
EOF
  fi
}

# Propagate L2 controls into the L1 guest (fw_cfg + cmdline + smbios).
if [ "${disable_nqc2_plugin}" = "true" ]; then
  direct_l1_append="${direct_l1_append} morpheus.l2_disable_nqc2_plugin=1"
fi
if [ "${capture_runtime}" = "true" ]; then
  direct_l1_append="${direct_l1_append} morpheus.capture_runtime=1"
fi
if [ -n "${l2_run_window_ms}" ]; then
  direct_l1_append="${direct_l1_append} morpheus.l2_run_window_ms=${l2_run_window_ms}"
fi
if [ "${l2_mode}" != "vm" ]; then
  direct_l1_append="${direct_l1_append} morpheus.l2_mode=${l2_mode}"
fi
if [ "${l2_accel}" != "auto" ]; then
  direct_l1_append="${direct_l1_append} morpheus.l2_accel=${l2_accel}"
fi
if [ -n "${l2_cpu}" ]; then
  direct_l1_append="${direct_l1_append} morpheus.l2_cpu=${l2_cpu}"
fi

append_l2_fw_cfg() {
  local machine="${1:-}"
  local machine_base="${machine%%,*}"
  local fw_cfg_supported="false"

  # sbsa-ref intentionally has no fw_cfg device. The same controls are
  # present in the L1 kernel command line, and SMBIOS remains a fallback for
  # machine types that expose it.
  case "${machine_base}" in
    virt|virt-*) fw_cfg_supported="true" ;;
  esac

  if [ "${disable_nqc2_plugin}" = "true" ]; then
    if [ "${fw_cfg_supported}" = "true" ]; then
      args+=("-fw_cfg" "name=opt/morpheus/l2-disable-nqc2-plugin,string=1")
    fi
    args+=("-smbios" "type=11,value=morpheus.l2_disable_nqc2_plugin=1")
  fi
  if [ "${capture_runtime}" = "true" ]; then
    if [ "${fw_cfg_supported}" = "true" ]; then
      args+=("-fw_cfg" "name=opt/morpheus/capture-runtime,string=1")
    fi
    args+=("-smbios" "type=11,value=morpheus.capture_runtime=1")
  fi
  if [ -n "${l2_run_window_ms}" ]; then
    if [ "${fw_cfg_supported}" = "true" ]; then
      args+=("-fw_cfg" "name=opt/morpheus/l2-run-window-ms,string=${l2_run_window_ms}")
    fi
    args+=("-smbios" "type=11,value=morpheus.l2_run_window_ms=${l2_run_window_ms}")
  fi
  if [ "${l2_mode}" != "vm" ]; then
    if [ "${fw_cfg_supported}" = "true" ]; then
      args+=("-fw_cfg" "name=opt/morpheus/l2-mode,string=${l2_mode}")
    fi
    args+=("-smbios" "type=11,value=morpheus.l2_mode=${l2_mode}")
  fi
  if [ "${l2_accel}" != "auto" ]; then
    if [ "${fw_cfg_supported}" = "true" ]; then
      args+=("-fw_cfg" "name=opt/morpheus/l2-accel,string=${l2_accel}")
    fi
    args+=("-smbios" "type=11,value=morpheus.l2_accel=${l2_accel}")
  fi
  if [ -n "${l2_cpu}" ]; then
    if [ "${fw_cfg_supported}" = "true" ]; then
      args+=("-fw_cfg" "name=opt/morpheus/l2-cpu,string=${l2_cpu}")
    fi
    args+=("-smbios" "type=11,value=morpheus.l2_cpu=${l2_cpu}")
  fi
  if [ "${fw_cfg_supported}" = "true" ]; then
    printf '[libafl/qemu_nesting] l1 metadata: fw_cfg+smbios machine=%s\n' \
      "${machine}" >&2
  else
    printf '[libafl/qemu_nesting] l1 metadata: cmdline+smbios machine=%s\n' \
      "${machine}" >&2
  fi
}

l1_boot_image="${run_dir}/l1-boot-fat.img"
l1_boot_startup="${run_dir}/l1-boot-fat-startup.nsh"
l1_share_staging_dir="${run_dir}/l1-share-staging"
l1_share_image="${run_dir}/l1-share.ext4"
direct_l1_share_stub_path="/mnt/libafl_nesting_stub"
direct_l1_stub_env="MORPHEUS_L2_MODE=${l2_mode}"
if [ "${fuzz_virtio_ids_set}" = "true" ]; then
  direct_l1_stub_env="${direct_l1_stub_env} MORPHEUS_QEMU_FUZZ_VIRTIO_IDS=${fuzz_virtio_ids}"
fi
if [ -n "${l2_run_window_ms}" ]; then
  direct_l1_stub_env="${direct_l1_stub_env} MORPHEUS_L2_RUN_WINDOW_MS=${l2_run_window_ms}"
fi
if [ "${capture_runtime}" = "true" ]; then
  direct_l1_stub_env="${direct_l1_stub_env} MORPHEUS_CAPTURE_RUNTIME=1"
fi
direct_l1_stub_launch_cmd="mkdir -p /mnt && mount -t ext4 -o ro /dev/vdb /mnt && ${direct_l1_stub_env} exec ${direct_l1_share_stub_path}"
direct_l1_share_prefix="${direct_l1_append%% init=/root/libafl_nesting_stub *}"
direct_l1_share_suffix="${direct_l1_append#* init=/root/libafl_nesting_stub }"
if [ "${direct_l1_share_prefix}" = "${direct_l1_append}" ]; then
  echo "missing init token in CVM L1 boot arguments" >&2
  exit 1
fi
direct_l1_share_append="${direct_l1_share_prefix} init=/bin/sh -- -c \"${direct_l1_stub_launch_cmd}\" ${direct_l1_share_suffix}"

stage_buildroot_cvm_share() {
  local staging_dir="$1"
  local share_image="$2"
  local source_share="$3"
  local launch_source="${4:-${source_share}/launch-l2-hoststack.sh}"
  local inner_launch_source="${source_share}/launch-l2.sh"
  local qemu_img_bin="${MORPHEUS_QEMU_IMG_BIN:-${MORPHEUS_QEMU_IMG:-}}"
  local mkfs_ext4_bin="${MORPHEUS_MKFS_EXT4_BIN:-${MORPHEUS_MKFS_EXT4:-}}"
  local staging_bytes
  local image_bytes
  local image_mb
  local align_bytes=$((64 * 1024 * 1024))
  local minimum_bytes=$((256 * 1024 * 1024))
  local headroom_bytes=$((128 * 1024 * 1024))

  [ -f "${stub_elf}" ] || {
    echo "missing LibAFL guest stub: ${stub_elf}" >&2
    exit 1
  }
  [ -f "${launch_source}" ] || {
    echo "missing host-stack launcher: ${launch_source}" >&2
    exit 1
  }
  [ -f "${inner_launch_source}" ] || {
    echo "missing L2 launcher: ${inner_launch_source}" >&2
    exit 1
  }
  [ -d "${source_share}/guest-images" ] || {
    echo "missing staged guest images: ${source_share}/guest-images" >&2
    exit 1
  }
  [ -d "${source_share}/guest-qemu" ] || {
    echo "missing staged guest QEMU: ${source_share}/guest-qemu" >&2
    exit 1
  }

  rm -rf "${staging_dir}" "${share_image}"
  mkdir -p "${staging_dir}"
  cp -f "${stub_elf}" "${staging_dir}/libafl_nesting_stub"
  chmod 0755 "${staging_dir}/libafl_nesting_stub"
  cp -f "${launch_source}" "${staging_dir}/launch-l2-hoststack.sh"
  chmod 0755 "${staging_dir}/launch-l2-hoststack.sh"
  cp -f "${inner_launch_source}" "${staging_dir}/launch-l2-inner.sh"
  chmod 0755 "${staging_dir}/launch-l2-inner.sh"
  cp -a "${source_share}/guest-images" "${staging_dir}/"
  cp -a "${source_share}/guest-qemu" "${staging_dir}/"

  # The buildroot launcher predates LibAFL's input-status contract. Keep the
  # generated launcher intact and add the contract in this per-run wrapper.
  cat > "${staging_dir}/launch-l2.sh" <<'EOF'
#!/bin/sh
set -eu

runtime_dir="${MORPHEUS_L2_RUNTIME_DIR:-/run/morpheus-libafl}"
status_path="${MORPHEUS_QEMU_INPUT_STATUS_PATH:-${runtime_dir}/qemu-input.status}"
input_path="${MORPHEUS_QEMU_INPUT_PATH:-}"

if [ ! -d "${runtime_dir}" ]; then
  mkdir -p "${runtime_dir}"
fi
: > "${status_path}"
input_size="missing"
if [ -n "${input_path}" ]; then
  input_size="$(stat -c %s "${input_path}" 2>/dev/null || printf missing)"
fi
printf 'input-status-path=%s\n' "${status_path}" >> "${status_path}"
printf 'input-path=%s\n' "${input_path:-unset}" >> "${status_path}"
printf 'input-size=%s\n' "${input_size}" >> "${status_path}"
printf 'qemu-exec-start\n' >> "${status_path}"
export MORPHEUS_QEMU_INPUT_STATUS_PATH="${status_path}"
exec /mnt/launch-l2-inner.sh
EOF
  chmod 0755 "${staging_dir}/launch-l2.sh"

  staging_bytes="$(du -s -B1 --apparent-size "${staging_dir}" | awk '{print $1}')"
  image_bytes=$((staging_bytes + headroom_bytes))
  if [ "${image_bytes}" -lt "${minimum_bytes}" ]; then
    image_bytes="${minimum_bytes}"
  fi
  image_bytes=$(((image_bytes + align_bytes - 1) / align_bytes * align_bytes))
  image_mb=$((image_bytes / 1024 / 1024))

  if [ -z "${qemu_img_bin}" ]; then
    qemu_img_bin="$(command -v qemu-img 2>/dev/null || true)"
  fi
  [ -x "${qemu_img_bin}" ] || {
    echo "missing qemu-img for LibAFL CVM staging" >&2
    exit 1
  }
  if [ -z "${mkfs_ext4_bin}" ]; then
    mkfs_ext4_bin="$(command -v mkfs.ext4 2>/dev/null || true)"
  fi
  if [ -z "${mkfs_ext4_bin}" ] || [ ! -x "${mkfs_ext4_bin}" ]; then
    for candidate in /sbin/mkfs.ext4 /usr/sbin/mkfs.ext4; do
      if [ -x "${candidate}" ]; then
        mkfs_ext4_bin="${candidate}"
        break
      fi
    done
  fi
  [ -x "${mkfs_ext4_bin}" ] || {
    echo "missing mkfs.ext4 for LibAFL CVM staging" >&2
    exit 1
  }

  "${qemu_img_bin}" create -f raw "${share_image}" "${image_mb}M" >/dev/null
  "${mkfs_ext4_bin}" -m 0 -d "${staging_dir}" "${share_image}" >/dev/null
  printf '[libafl/qemu_nesting] staged buildroot CVM share: bytes=%s image=%s\n' \
    "${staging_bytes}" "${share_image}" >&2
}

create_l1_uefi_boot_image() {
  local image_path="$1"
  local kernel_path="$2"
  local startup_path="$3"
  node - "${image_path}" "${kernel_path}" "${startup_path}" <<'NODE'
const fs = require("fs");

const [imagePath, kernelPath, startupPath] = process.argv.slice(2);
const bootFiles = [
  { name: "IMAGE", data: fs.readFileSync(kernelPath) },
  { name: "STARTUP.NSH", data: fs.readFileSync(startupPath) },
];

const bytesPerSector = 512;
const partitionStartSectors = 63;
const sectorsPerCluster = 8;
const reservedSectors = 1;
const fatCopies = 2;
const rootEntryCount = 512;
const rootDirSectors = Math.ceil((rootEntryCount * 32) / bytesPerSector);
const mediaDescriptor = 0xf8;
const minimumFat16Clusters = 4085;
const bytesPerCluster = bytesPerSector * sectorsPerCluster;

function encodeShortName(name) {
  const upper = String(name).toUpperCase();
  const parts = upper.split(".");
  const base = (parts.shift() || "").replace(/[^A-Z0-9_$~!#%&'(){}@^`-]/g, "_");
  const ext = parts.join("").replace(/[^A-Z0-9_$~!#%&'(){}@^`-]/g, "_");
  return {
    base: base.slice(0, 8).padEnd(8, " "),
    ext: ext.slice(0, 3).padEnd(3, " "),
  };
}

function clustersForSize(size) {
  return Math.max(1, Math.ceil(size / bytesPerCluster));
}

let usedClusters = 0;
for (const file of bootFiles) {
  file.clusterCount = clustersForSize(file.data.length);
  usedClusters += file.clusterCount;
}

let totalClusters = Math.max(usedClusters, minimumFat16Clusters);
let sectorsPerFat = 1;
while (true) {
  const nextSectorsPerFat = Math.ceil(((totalClusters + 2) * 2) / bytesPerSector);
  const nextTotalClusters = Math.max(usedClusters, minimumFat16Clusters);
  if (nextSectorsPerFat === sectorsPerFat && nextTotalClusters === totalClusters) {
    break;
  }
  sectorsPerFat = nextSectorsPerFat;
  totalClusters = nextTotalClusters;
}

const volumeSectors =
  reservedSectors +
  (fatCopies * sectorsPerFat) +
  rootDirSectors +
  (totalClusters * sectorsPerCluster);
const totalSectors = partitionStartSectors + volumeSectors;
if (totalSectors > 0xffffffff || volumeSectors > 0xffffffff) {
  throw new Error(`boot image too large: ${totalSectors} sectors`);
}
const volumeSectors16 = volumeSectors < 0x10000 ? volumeSectors : 0;
const volumeSectors32 = volumeSectors16 === 0 ? volumeSectors : 0;
const image = Buffer.alloc(totalSectors * bytesPerSector, 0);
const volumeStart = partitionStartSectors * bytesPerSector;

function writeAscii(target, offset, text, width) {
  const bytes = Buffer.from(String(text).padEnd(width, " ").slice(0, width), "ascii");
  bytes.copy(target, offset);
}

function encodeChs(lba) {
  const sectorsPerTrack = 63;
  const heads = 16;
  const sectorIndex = lba % sectorsPerTrack;
  const head = Math.floor(lba / sectorsPerTrack) % heads;
  const cylinder = Math.floor(lba / (sectorsPerTrack * heads));
  if (cylinder > 1023) {
    return Buffer.from([0xff, 0xff, 0xff]);
  }
  return Buffer.from([
    head,
    (sectorIndex + 1) | ((cylinder >> 8) << 6),
    cylinder & 0xff,
  ]);
}

function writeEntry(target, entryIndex, file) {
  const offset = entryIndex * 32;
  const shortName = encodeShortName(file.name);
  writeAscii(target, offset, shortName.base, 8);
  writeAscii(target, offset + 8, shortName.ext, 3);
  target[offset + 11] = 0x20;
  target.writeUInt16LE(file.startCluster, offset + 26);
  target.writeUInt32LE(file.data.length, offset + 28);
}

const mbr = image.subarray(0, bytesPerSector);
mbr[0] = 0xeb;
mbr[1] = 0x3c;
mbr[2] = 0x90;
writeAscii(mbr, 3, "MSWIN4.1", 8);
const partitionEntry = 446;
const endLba = partitionStartSectors + volumeSectors - 1;
mbr[partitionEntry] = 0x80;
encodeChs(partitionStartSectors).copy(mbr, partitionEntry + 1);
mbr[partitionEntry + 4] = 0x06;
encodeChs(endLba).copy(mbr, partitionEntry + 5);
mbr.writeUInt32LE(partitionStartSectors, partitionEntry + 8);
mbr.writeUInt32LE(volumeSectors, partitionEntry + 12);
mbr.writeUInt32LE(0x4d4f5250, 440);
mbr[510] = 0x55;
mbr[511] = 0xaa;

const bootSector = image.subarray(volumeStart, volumeStart + bytesPerSector);
bootSector[0] = 0xeb;
bootSector[1] = 0x3c;
bootSector[2] = 0x90;
writeAscii(bootSector, 3, "MSWIN4.1", 8);
bootSector.writeUInt16LE(bytesPerSector, 11);
bootSector[13] = sectorsPerCluster;
bootSector.writeUInt16LE(reservedSectors, 14);
bootSector[16] = fatCopies;
bootSector.writeUInt16LE(rootEntryCount, 17);
bootSector.writeUInt16LE(volumeSectors16, 19);
bootSector[21] = mediaDescriptor;
bootSector.writeUInt16LE(sectorsPerFat, 22);
bootSector.writeUInt16LE(32, 24);
bootSector.writeUInt16LE(64, 26);
bootSector.writeUInt32LE(volumeSectors32, 32);
bootSector[36] = 0x80;
bootSector[38] = 0x29;
bootSector.writeUInt32LE(0x4d4f5250, 39);
writeAscii(bootSector, 43, "MORPHEUS", 11);
writeAscii(bootSector, 54, "FAT16", 8);
bootSector[510] = 0x55;
bootSector[511] = 0xaa;

const fatStart = volumeStart + (reservedSectors * bytesPerSector);
const fatSizeBytes = sectorsPerFat * bytesPerSector;
const rootDirStart = fatStart + (fatCopies * fatSizeBytes);
const dataStart = rootDirStart + (rootDirSectors * bytesPerSector);
const fat = image.subarray(fatStart, fatStart + fatSizeBytes);
fat.writeUInt16LE(0xfff8, 0);
fat.writeUInt16LE(0xffff, 2);

let nextCluster = 2;
for (const [index, file] of bootFiles.entries()) {
  file.startCluster = nextCluster;
  for (let clusterOffset = 0; clusterOffset < file.clusterCount; clusterOffset += 1) {
    const cluster = nextCluster + clusterOffset;
    const nextValue =
      clusterOffset + 1 < file.clusterCount ? cluster + 1 : 0xffff;
    fat.writeUInt16LE(nextValue, cluster * 2);
  }
  const fileOffset = dataStart + ((file.startCluster - 2) * bytesPerCluster);
  file.data.copy(image, fileOffset);
  writeEntry(
    image.subarray(rootDirStart, rootDirStart + (rootDirSectors * bytesPerSector)),
    index,
    file,
  );
  nextCluster += file.clusterCount;
}

for (let fatIndex = 1; fatIndex < fatCopies; fatIndex += 1) {
  fat.copy(image, fatStart + (fatIndex * fatSizeBytes));
}

fs.writeFileSync(imagePath, image);
NODE
}

ensure_cpu_flag() {
  local cpu="$1"
  local flag="$2"
  local value="$3"
  case ",${cpu}," in
    *",${flag}="*) printf '%s\n' "${cpu}" ;;
    *) printf '%s,%s=%s\n' "${cpu}" "${flag}" "${value}" ;;
  esac
}

if [ "${l2_mode}" = "cvm" ]; then
  # Match nvirsh CVM L1: RME-capable machine + max CPU with x-rme.
  # Keep the libafl stub as PID 1 so the fuzz loop still runs inside the L1
  # guest. For buildroot-based CVM states, stage the stub on the shared host
  # tree and boot the prepared rootfs with a host-share mount handoff.
  if [ -z "${l1_hoststack_share_dir}" ]; then
    l1_hoststack_share_dir="${l1_build_dir}/l1"
  fi
  if [ -z "${l1_hoststack_rootfs}" ]; then
    l1_hoststack_rootfs="${l1_build_dir}/l1/cca-host-stack/out/host.ext4"
  fi
  if [ ! -d "${l1_hoststack_share_dir}" ]; then
    echo "missing l1 hoststack share dir for cvm: ${l1_hoststack_share_dir}" >&2
    exit 1
  fi
  if [ ! -x "${l1_hoststack_share_dir}/launch-l2-hoststack.sh" ] &&      [ ! -x "${l1_hoststack_launch:-}" ]; then
    echo "missing launch-l2-hoststack.sh under ${l1_hoststack_share_dir}" >&2
    exit 1
  fi
  if [ -z "${firmware}" ] || [ ! -f "${firmware}" ]; then
    echo "missing cvm l1 firmware (flash.bin): ${firmware}" >&2
    exit 1
  fi

  l1_cpu_effective="${l1_cpu:-max}"
  case "${l1_cpu_effective}" in
    max|max,*) ;;
    *) l1_cpu_effective="max" ;;
  esac
  l1_cpu_effective="$(ensure_cpu_flag "${l1_cpu_effective}" "x-rme" "on")"
  l1_cpu_effective="$(ensure_cpu_flag "${l1_cpu_effective}" "sme" "off")"
  l1_cpu_effective="$(ensure_cpu_flag "${l1_cpu_effective}" "pauth-impdef" "on")"
  l1_cpu_effective="$(ensure_cpu_flag "${l1_cpu_effective}" "sve" "off")"

  # Keep the CVM L1 aligned with the prepared nvirsh state. The workflow
  # already chooses the outer L1 memory and vCPU sizing, and the nesting
  # fuzzing path must honor those values instead of falling back to the older
  # 4096M / 1-vCPU default.
  l1_memory_cvm="${l1_memory}"
  l1_smp_cvm="${libafl_l1_smp}"

  if [ "${nvirsh_state_tool}" = "nvirsh-buildroot-based-cvm" ]; then
    if [ ! -f "${direct_l1_kernel}" ]; then
      echo "missing cvm l1 kernel for buildroot-based state: ${direct_l1_kernel}" >&2
      exit 1
    fi
    if [ ! -f "${l1_hoststack_rootfs}" ]; then
      echo "missing cvm l1 rootfs for buildroot-based state: ${l1_hoststack_rootfs}" >&2
      exit 1
    fi
    if [ -n "${firmware_b}" ] && [ ! -f "${firmware_b}" ]; then
      echo "missing cvm l1 firmware b for buildroot-based state: ${firmware_b}" >&2
      exit 1
    fi

    stage_buildroot_cvm_share \
      "${l1_share_staging_dir}" \
      "${l1_share_image}" \
      "${l1_hoststack_share_dir}" \
      "${l1_hoststack_launch:-${l1_hoststack_share_dir}/launch-l2-hoststack.sh}"
    cat > "${l1_boot_startup}" <<EOF
mode 100 31
pci
fs0:\Image ${direct_l1_share_append}
reset -c
EOF
    create_l1_uefi_boot_image "${l1_boot_image}" "${direct_l1_kernel}" "${l1_boot_startup}"

    l1_machine_effective="${l1_machine:-sbsa-ref}"
    args=(
      "-display" "none"
      "-nographic"
      "-nodefaults"
      "-serial" "mon:stdio"
      "-action" "panic=exit-failure"
      "-machine" "${l1_machine_effective}"
      "-cpu" "${l1_cpu_effective}"
      "-m" "${l1_memory_cvm}"
      "-smp" "${l1_smp_cvm}"
      "-drive" "format=raw,id=hd0,if=none,file=${l1_hoststack_rootfs},snapshot=on"
      "-device" "virtio-blk-pci,drive=hd0,num-queues=1"
      "-drive" "format=raw,id=share,if=none,file=${l1_share_image},snapshot=on"
      "-device" "virtio-blk-pci,drive=share,num-queues=1"
      "-drive" "file=${l1_boot_image},format=raw,snapshot=on"
      "-L" "${qemu_data_dir}"
    )
    append_l2_fw_cfg "${l1_machine_effective}"
    if [ -n "${firmware_b}" ]; then
      args+=(
        "-drive" "file=${firmware},format=raw,if=pflash,snapshot=on"
        "-drive" "file=${firmware_b},format=raw,if=pflash,snapshot=on"
      )
    else
      args+=(
        "-bios" "${firmware}"
        "-kernel" "${direct_l1_kernel}"
        "-append" "${direct_l1_share_append}"
      )
    fi
    if [ -n "${l1_accel}" ]; then
      args+=("-accel" "${l1_accel}")
    else
      args+=("-accel" "tcg")
    fi
    if [ "${l1_enable_kvm}" = "true" ]; then
      args+=("-enable-kvm")
    fi
    printf '[libafl/qemu_nesting] cvm l1 buildroot-state: cpu=%s memory=%s smp=%s rootfs=%s share=%s\n' \
      "${l1_cpu_effective}" "${l1_memory_cvm}" "${l1_smp_cvm}" "${l1_hoststack_rootfs}" "${l1_share_image}" >&2
  else
    if [ ! -f "${direct_l1_kernel}" ] || [ ! -f "${direct_l1_initrd}" ]; then
      echo "missing cvm l1 host-boot kernel/initrd under ${l1_build_dir}/l1/host-boot" >&2
      exit 1
    fi

    args=(
      "-machine" "virt,acpi=off,virtualization=on,secure=on,gic-version=3,iommu=smmuv3"
      "-cpu" "${l1_cpu_effective}"
      "-m" "${l1_memory_cvm}"
      "-smp" "${l1_smp_cvm}"
      "-nographic"
      "-accel" "tcg"
      "-bios" "${firmware}"
      "-kernel" "${direct_l1_kernel}"
      "-initrd" "${direct_l1_initrd}"
      "-append" "${direct_l1_append}"
      "-drive" "file=${overlay_image},if=virtio,format=qcow2"
      "-L" "${qemu_data_dir}"
    )
    append_l2_fw_cfg "virt"
    printf '[libafl/qemu_nesting] cvm l1 legacy-state: cpu=%s memory=%s smp=%s share=%s\n' \
      "${l1_cpu_effective}" "${l1_memory_cvm}" "${l1_smp_cvm}" "${l1_hoststack_share_dir}" >&2
  fi
else
  args=(
    "-machine" "virt,virtualization=on,gic-version=3"
    "-cpu" "${l1_cpu}"
    "-m" "${l1_memory}"
    "-smp" "${libafl_l1_smp}"
    "-nographic"
    "-drive" "file=${overlay_image},if=virtio,format=qcow2"
    "-L" "${qemu_data_dir}"
  )
  append_l2_fw_cfg "virt"
  if [ -f "${direct_l1_kernel}" ] && [ -f "${direct_l1_initrd}" ]; then
    args+=("-kernel" "${direct_l1_kernel}" "-initrd" "${direct_l1_initrd}" "-append" "${direct_l1_append}")
  else
    args+=("-bios" "${firmware}")
  fi
fi

launch_env=("STUB=${stub_elf}" "MORPHEUS_LIBAFL_CORPUS_DIR=${corpus_dir}" "MORPHEUS_LIBAFL_OBJECTIVE_DIR=${objective_dir}")
if [ -n "${l2_run_window_ms}" ]; then
  launch_env+=("MORPHEUS_LIBAFL_L2_RUN_WINDOW_MS=${l2_run_window_ms}")
  # Default non-replay executor timeout is 12s, far below CVM L2 windows.
  # Cover the full L2 window plus headroom for L1/L2 bring-up under TCG.
  if [ -z "${MORPHEUS_LIBAFL_EXECUTOR_TIMEOUT_SECONDS:-}" ]; then
    executor_timeout_secs=$(( (l2_run_window_ms + 999) / 1000 + 90 ))
    if [ "${l2_mode}" = "cvm" ] && [ "${executor_timeout_secs}" -lt 300 ]; then
      executor_timeout_secs=300
    fi
    launch_env+=("MORPHEUS_LIBAFL_EXECUTOR_TIMEOUT_SECONDS=${executor_timeout_secs}")
    printf '[libafl/qemu_nesting] executor timeout seconds=%s (from l2 window %s ms)\n' \
      "${executor_timeout_secs}" "${l2_run_window_ms}" >&2
  else
    launch_env+=("MORPHEUS_LIBAFL_EXECUTOR_TIMEOUT_SECONDS=${MORPHEUS_LIBAFL_EXECUTOR_TIMEOUT_SECONDS}")
  fi
elif [ "${l2_mode}" = "cvm" ]; then
  # CVM without explicit window still needs far more than the 12s default.
  launch_env+=("MORPHEUS_LIBAFL_EXECUTOR_TIMEOUT_SECONDS=${MORPHEUS_LIBAFL_EXECUTOR_TIMEOUT_SECONDS:-300}")
fi
if [ "${replay_enabled}" = "true" ]; then
  launch_env+=("MORPHEUS_LIBAFL_REPLAY_INPUTS=${replay_inputs_file}" "MORPHEUS_LIBAFL_REPLAY_STATE=${replay_state_file}")
fi
if [ -f "${seed_inputs_file}" ] && [ -s "${seed_inputs_file}" ]; then
  launch_env+=("MORPHEUS_LIBAFL_INITIAL_INPUTS=${seed_inputs_file}")
fi
if [ -f "${devilang_states_file}" ] && [ -s "${devilang_states_file}" ]; then
  launch_env+=("MORPHEUS_LIBAFL_DEVILANG_STATES=${devilang_states_file}")
fi
if [ -f "${devilang_grammar_file}" ] && [ -s "${devilang_grammar_file}" ]; then
  devilang_grammar_path="$(sed -n '1p' "${devilang_grammar_file}")"
  launch_env+=("MORPHEUS_LIBAFL_DEVILANG_GRAMMAR=${devilang_grammar_path}")
fi

launch_cmd=(env "${launch_env[@]}" "${fuzzer_bin}" "${args[@]}")

source_log_file() {
  if [ -f "${step_log_file}" ] && [ -s "${step_log_file}" ]; then
    printf '%s\n' "${step_log_file}"
  else
    printf '%s\n' "${runner_log_file}"
  fi
}

spawn_launcher() {
  setsid "${launch_cmd[@]}" > >(tee -a "${runner_log_file}") 2>&1 &
  child_pid="$!"
}

child_pid=""
cleanup() {
  local status="$1"
  if [ -n "${child_pid}" ]; then kill_run "${child_pid}"; fi
  extract_l1_runtime_from_log "${l1_runtime_dir}" "$(source_log_file)" "${replay_enabled}" "${replay_state_file}"
  cat > "${manifest_file}" <<EOF
{"schemaVersion":1,"tool":"libafl","status":"${status}","runDir":"${run_dir}","manifest":"${manifest_file}","pid":null,"stubElf":"${stub_elf}","nvirshState":"${nvirsh_state}","l1RuntimeDir":"${l1_runtime_dir}","corpusDir":"${corpus_dir}","objectiveDir":"${objective_dir}","replayState":"${replay_state_file}","replayInputs":"${replay_inputs_file}"}
EOF
}

if [ "${detach}" = "true" ]; then
  spawn_launcher
  pid="${child_pid}"
  cat > "${manifest_file}" <<EOF
{"schemaVersion":1,"tool":"libafl","status":"running","runDir":"${run_dir}","manifest":"${manifest_file}","pid":${pid},"stubElf":"${stub_elf}","nvirshState":"${nvirsh_state}","corpusDir":"${corpus_dir}","objectiveDir":"${objective_dir}","replayState":"${replay_state_file}","replayInputs":"${replay_inputs_file}"}
EOF
  if [ "${replay_enabled}" = "true" ]; then
    cat > "${result_file}" <<EOF
{"details":{"pid":${pid},"detached":true,"run_dir":"${run_dir}","manifest":"${manifest_file}","l1_runtime_dir":"${l1_runtime_dir}","corpus_dir":"${corpus_dir}","objective_dir":"${objective_dir}","replay_state":"${replay_state_file}","replay_inputs":"${replay_inputs_file}"},"artifacts":[{"path":"l1-runtime-dir","location":"${l1_runtime_dir}"},{"path":"corpus-dir","location":"${corpus_dir}"},{"path":"objective-dir","location":"${objective_dir}"},{"path":"replay-state","location":"${replay_state_file}"},{"path":"replay-inputs","location":"${replay_inputs_file}"}]}
EOF
  else
    cat > "${result_file}" <<EOF
{"details":{"pid":${pid},"detached":true,"run_dir":"${run_dir}","manifest":"${manifest_file}","l1_runtime_dir":"${l1_runtime_dir}","corpus_dir":"${corpus_dir}","objective_dir":"${objective_dir}"},"artifacts":[{"path":"l1-runtime-dir","location":"${l1_runtime_dir}"},{"path":"corpus-dir","location":"${corpus_dir}"},{"path":"objective-dir","location":"${objective_dir}"}]}
EOF
  fi
  exit 0
fi

trap 'cleanup "terminated"; exit 143' TERM INT
if [ "${run_seconds}" != "0" ] && [ "${replay_enabled}" != "true" ]; then
  end_time=$((SECONDS + run_seconds))
  attempt=1
  while [ "${SECONDS}" -lt "${end_time}" ]; do
    spawn_launcher
    cat > "${manifest_file}" <<EOF
{"schemaVersion":1,"tool":"libafl","status":"running","runDir":"${run_dir}","manifest":"${manifest_file}","pid":${child_pid},"stubElf":"${stub_elf}","nvirshState":"${nvirsh_state}","attempt":${attempt},"corpusDir":"${corpus_dir}","objectiveDir":"${objective_dir}","replayState":"${replay_state_file}","replayInputs":"${replay_inputs_file}"}
EOF
    while [ "${SECONDS}" -lt "${end_time}" ] && kill -0 "${child_pid}" 2>/dev/null; do
      if ps -o stat= --ppid "${child_pid}" | grep -q 'Z'; then
        echo "libafl launcher has a defunct child; restarting attempt $((attempt + 1))" >&2
        kill_run "${child_pid}"
        break
      fi
      sleep 5
    done
    if [ "${SECONDS}" -ge "${end_time}" ]; then
      cleanup "success"
      child_pid=""
      break
    fi
    if wait "${child_pid}"; then child_status=0; else child_status="$?"; fi
    child_pid=""
    echo "libafl fuzzer exited before timed run completed; restarting attempt $((attempt + 1)) after status ${child_status}" >&2
    attempt=$((attempt + 1))
    sleep 1
  done
else
  spawn_launcher
  cat > "${manifest_file}" <<EOF
{"schemaVersion":1,"tool":"libafl","status":"running","runDir":"${run_dir}","manifest":"${manifest_file}","pid":${child_pid},"stubElf":"${stub_elf}","nvirshState":"${nvirsh_state}","corpusDir":"${corpus_dir}","objectiveDir":"${objective_dir}","replayState":"${replay_state_file}","replayInputs":"${replay_inputs_file}"}
EOF
  wait "${child_pid}"
  child_pid=""
fi

cat > "${manifest_file}" <<EOF
{"schemaVersion":1,"tool":"libafl","status":"success","runDir":"${run_dir}","manifest":"${manifest_file}","pid":null,"stubElf":"${stub_elf}","nvirshState":"${nvirsh_state}","l1RuntimeDir":"${l1_runtime_dir}","corpusDir":"${corpus_dir}","objectiveDir":"${objective_dir}","replayState":"${replay_state_file}","replayInputs":"${replay_inputs_file}"}
EOF
extract_l1_runtime_from_log "${l1_runtime_dir}" "$(source_log_file)" "${replay_enabled}" "${replay_state_file}"
write_result
