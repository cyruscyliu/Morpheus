#!/usr/bin/env bash
set -euo pipefail

source_dir="${MORPHEUS_LIBAFL_SOURCE:?}"
run_dir="${MORPHEUS_LIBAFL_RUN_DIR:?}"
install_dir="${MORPHEUS_LIBAFL_INSTALL_DIR:?}"
nvirsh_state="${MORPHEUS_LIBAFL_NVIRSH_STATE:?}"
detach="${MORPHEUS_LIBAFL_DETACH:-false}"
run_seconds="${MORPHEUS_LIBAFL_RUN_SECONDS:-0}"
l2_run_window_ms="${MORPHEUS_LIBAFL_L2_RUN_WINDOW_MS:-}"
l2_accel="${MORPHEUS_LIBAFL_L2_ACCEL:-auto}"
l2_cpu="${MORPHEUS_LIBAFL_L2_CPU:-}"
result_file="${MORPHEUS_LIBAFL_RESULT_FILE:-${MORPHEUS_SCRIPT_RESULT_FILE:?}}"
manifest_file="${run_dir}/manifest.json"
l1_runtime_dir="${run_dir}/l1-runtime"
corpus_dir="${run_dir}/corpus"
objective_dir="${run_dir}/crashes"
replay_input_arg_file="${MORPHEUS_LIBAFL_REPLAY_INPUT_FILE:-}"
replay_inputs_file="${run_dir}/replay-inputs.txt"
replay_state_file="${run_dir}/replay-state.json"
step_log_file="${run_dir%/}/../stdout.log"
fuzzer_bin="${install_dir}/bin/qemu_nesting"
stub_elf="${install_dir}/bin/libafl_nesting_stub"
bridge_dir="${install_dir}/../build/qemu-libafl-bridge"
qemu_bundle_dir="${bridge_dir}/build/qemu-bundle/usr/local/share/qemu"

mkdir -p "${run_dir}" "${l1_runtime_dir}" "${corpus_dir}" "${objective_dir}" "$(dirname "${result_file}")"
find "${l1_runtime_dir}" -mindepth 1 -maxdepth 1 -exec rm -rf {} +

manifest_pid=""
if [ -f "${manifest_file}" ]; then
  manifest_pid="$(node -e 'const fs=require("fs"); try { const m=JSON.parse(fs.readFileSync(process.argv[1], "utf8")); process.stdout.write(String(m.pid || "")); } catch {}' "${manifest_file}")"
fi

kill_run() {
  local pid="$1"
  if [ -z "${pid}" ]; then
    return 0
  fi
  kill -TERM -- "-${pid}" 2>/dev/null || true
  sleep 1
  kill -KILL -- "-${pid}" 2>/dev/null || true
}

kill_run "${manifest_pid}"
pkill -f "${fuzzer_bin}" 2>/dev/null || true

if [ ! -f "${nvirsh_state}" ]; then
  echo "missing prepared nvirsh state: ${nvirsh_state}" >&2
  exit 1
fi
if [ ! -x "${fuzzer_bin}" ]; then
  echo "missing qemu_nesting fuzzer binary: ${fuzzer_bin}" >&2
  exit 1
fi
if [ ! -f "${stub_elf}" ]; then
  echo "missing guest stub ELF: ${stub_elf}" >&2
  exit 1
fi

replay_enabled=false
if [ -n "${replay_input_arg_file}" ]; then
  if [ ! -f "${replay_input_arg_file}" ]; then
    echo "missing replay input list: ${replay_input_arg_file}" >&2
    exit 1
  fi
  node - "${replay_input_arg_file}" "${replay_inputs_file}" "${replay_state_file}" <<'NODE'
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const sourceFile = process.argv[2];
const outputFile = process.argv[3];
const stateFile = process.argv[4];
const roots = fs.readFileSync(sourceFile, "utf8")
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter(Boolean);
const inputs = [];

function addFile(file) {
  const stat = fs.statSync(file);
  if (!stat.isFile()) {
    return;
  }
  const base = path.basename(file);
  if (base.startsWith(".") || base.endsWith(".metadata")) {
    return;
  }
  inputs.push(path.resolve(file));
}

for (const root of roots) {
  const resolved = path.resolve(root);
  const stat = fs.statSync(resolved);
  if (stat.isDirectory()) {
    for (const entry of fs.readdirSync(resolved).sort()) {
      addFile(path.join(resolved, entry));
    }
  } else {
    addFile(resolved);
  }
}

const unique = [...new Set(inputs)].sort();
if (unique.length === 0) {
  throw new Error(`no replay inputs resolved from ${sourceFile}`);
}
fs.writeFileSync(outputFile, `${unique.join("\n")}\n`);

const entries = unique.map((file, index) => {
  const data = fs.readFileSync(file);
  return {
    index,
    path: file,
    size: data.length,
    sha256: crypto.createHash("sha256").update(data).digest("hex"),
  };
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

if [ "${replay_enabled}" = "true" ] && [ "${detach}" = "true" ]; then
  echo "libafl replay does not support --detach" >&2
  exit 1
fi
if [ -n "${l2_run_window_ms}" ]; then
  if ! [[ "${l2_run_window_ms}" =~ ^[0-9]+$ ]] \
     || [ "${l2_run_window_ms}" -lt 1000 ] \
     || [ "${l2_run_window_ms}" -gt 900000 ]; then
    echo "l2-run-window-ms must be an integer between 1000 and 900000" >&2
    exit 1
  fi
fi
case "${l2_accel}" in
  auto|kvm|tcg)
    ;;
  *)
    echo "l2-accel must be one of: auto, kvm, tcg" >&2
    exit 1
    ;;
esac
if [ -n "${l2_cpu}" ]; then
  case "${l2_cpu}" in
    host|max|cortex-a57)
      ;;
    *)
      echo "l2-cpu must be one of: host, max, cortex-a57" >&2
      exit 1
      ;;
  esac
fi
printf '[libafl] l2 controls: accel=%s cpu=%s window_ms=%s\n' \
  "${l2_accel}" "${l2_cpu:-default}" "${l2_run_window_ms:-default}" >&2

MORPHEUS_NVIRSH_INSTALL_DIR="$(dirname "${nvirsh_state}")" \
MORPHEUS_NVIRSH_RESULT_FILE="${run_dir}/nvirsh-stop.json" \
"$(dirname "$0")/../../nvirsh/scripts/stop.sh"

readarray -t state_fields < <(
  node - "${nvirsh_state}" <<'NODE'
const fs = require("fs");
const state = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const firmware = (state.hostLaunch && state.hostLaunch.firmware) || "";
const overlay = (state.hostLaunch && state.hostLaunch.overlayImage) || "";
const seed = (state.hostLaunch && state.hostLaunch.seedImage) || "";
const buildDir = state.buildDir || "";
const l1Args = (state.profileData && state.profileData.l1 && Array.isArray(state.profileData.l1.launcherArgs))
  ? state.profileData.l1.launcherArgs
  : [];
let cpu = "cortex-a57";
let memory = "8192";
let smp = "4";
for (let i = 0; i < l1Args.length - 1; i += 1) {
  if (l1Args[i] === "-cpu") cpu = String(l1Args[i + 1]);
  if (l1Args[i] === "-m") memory = String(l1Args[i + 1]);
  if (l1Args[i] === "-smp") smp = String(l1Args[i + 1]);
}
process.stdout.write(`${firmware}\n${overlay}\n${seed}\n${cpu}\n${memory}\n${smp}\n${buildDir}\n`);
NODE
)

firmware="${state_fields[0]}"
overlay_image="${state_fields[1]}"
l1_cpu="${state_fields[3]}"
l1_memory="${state_fields[4]}"
l1_smp="${state_fields[5]}"
l1_build_dir="${state_fields[6]}"
libafl_l1_smp="${MORPHEUS_LIBAFL_L1_SMP:-1}"
qemu_data_dir="${qemu_bundle_dir}"
firmware_data_dir="$(dirname "${firmware}")"
direct_l1_kernel="${l1_build_dir}/l1/host-boot/vmlinuz"
direct_l1_initrd="${l1_build_dir}/l1/host-boot/initrd.img"
direct_l1_append="root=PARTUUID=48bd50df-bfd1-4457-8648-8026f634af47 ro init=/root/libafl_nesting_stub norandmaps rw"
disable_nqc2_plugin="${MORPHEUS_LIBAFL_DISABLE_NQC2_PLUGIN:-false}"
if [ -n "${MORPHEUS_L2_DISABLE_NQC2_PLUGIN:-}" ]; then
  disable_nqc2_plugin="true"
fi
if [ ! -f "${qemu_data_dir}/efi-virtio.rom" ] && \
   [ -f "${firmware_data_dir}/efi-virtio.rom" ]; then
  qemu_data_dir="${firmware_data_dir}"
elif [ ! -f "${qemu_data_dir}/efi-virtio.rom" ] && \
     [ -f "/usr/share/qemu/efi-virtio.rom" ]; then
  qemu_data_dir="/usr/share/qemu"
fi

extract_l1_runtime_from_log() {
  local output_dir="$1"
  local log_file="$2"
  local replay_mode="${3:-false}"
  local replay_state="${4:-}"

  if [ ! -f "${log_file}" ]; then
    return 0
  fi
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
let replayIndex = 0;

function resetRecord(name, size, dumped, truncated) {
  if (!safeName.test(name)) {
    return;
  }
  records.set(name, {
    size: Number(size),
    dumped: Number(dumped),
    truncated: truncated === "1",
    chunks: new Map(),
    complete: false,
  });
}

function recordFor(name) {
  if (!safeName.test(name) || !records.has(name)) {
    return null;
  }
  return records.get(name);
}

function writeRecordToDir(dir, name, record) {
  if (!record || !record.complete) {
    return;
  }
  const chunks = [...record.chunks.entries()]
    .sort((left, right) => left[0] - right[0])
    .map((entry) => entry[1]);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), Buffer.concat(chunks));
}

function flushReplayGroup() {
  if (!replayMode || records.size === 0) {
    return;
  }
  const groupName = `replay-${String(replayIndex).padStart(6, "0")}`;
  const groupDir = path.join(outputDir, groupName);
  let wrote = false;
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
  records.clear();
}

const logPrefix = "LQPRINTF: ";
const content = fs.readFileSync(logFile, "utf8");
for (const line of content.split(/\r?\n/)) {
  const index = line.indexOf(logPrefix);
  const message = index >= 0 ? line.slice(index + logPrefix.length) : line;
  let match = message.match(
    /^stub-runtime begin name=([A-Za-z0-9._-]+) size=(\d+) dumped=(\d+) truncated=([01])$/,
  );
  if (match) {
    resetRecord(match[1], match[2], match[3], match[4]);
    continue;
  }

  match = message.match(
    /^stub-runtime data name=([A-Za-z0-9._-]+) offset=(\d+) hex=([0-9a-f]*)$/,
  );
  if (match) {
    const record = recordFor(match[1]);
    if (!record || !/^(?:[0-9a-f]{2})*$/.test(match[3])) {
      continue;
    }
    record.chunks.set(Number(match[2]), Buffer.from(match[3], "hex"));
    continue;
  }

  match = message.match(/^stub-runtime end name=([A-Za-z0-9._-]+)$/);
  if (match) {
    const record = recordFor(match[1]);
    if (record) {
      record.complete = true;
      if (!replayMode) {
        writeRecordToDir(outputDir, match[1], record);
      }
    }
    continue;
  }

  if (message === "stub: dumped runtime files to log") {
    flushReplayGroup();
  }
}
flushReplayGroup();

if (replayMode && replayStateFile && fs.existsSync(replayStateFile)) {
  const state = JSON.parse(fs.readFileSync(replayStateFile, "utf8"));
  state.runtimeGroups = runtimeGroups;
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

args=(
  "-machine" "virt,virtualization=on,gic-version=3"
  "-cpu" "${l1_cpu}"
  "-m" "${l1_memory}"
  "-smp" "${libafl_l1_smp}"
  "-nographic"
  "-drive" "file=${overlay_image},if=virtio,format=qcow2"
  "-L" "${qemu_data_dir}"
)
if [ "${disable_nqc2_plugin}" = "true" ]; then
  direct_l1_append="${direct_l1_append} morpheus.l2_disable_nqc2_plugin=1"
  args+=(
    "-fw_cfg" "name=opt/morpheus/l2-disable-nqc2-plugin,string=1"
    "-smbios" "type=11,value=morpheus.l2_disable_nqc2_plugin=1"
  )
fi
if [ -n "${l2_run_window_ms}" ]; then
  direct_l1_append="${direct_l1_append} morpheus.l2_run_window_ms=${l2_run_window_ms}"
  args+=(
    "-fw_cfg" "name=opt/morpheus/l2-run-window-ms,string=${l2_run_window_ms}"
    "-smbios" "type=11,value=morpheus.l2_run_window_ms=${l2_run_window_ms}"
  )
fi
if [ "${l2_accel}" != "auto" ]; then
  direct_l1_append="${direct_l1_append} morpheus.l2_accel=${l2_accel}"
  args+=(
    "-fw_cfg" "name=opt/morpheus/l2-accel,string=${l2_accel}"
    "-smbios" "type=11,value=morpheus.l2_accel=${l2_accel}"
  )
fi
if [ -n "${l2_cpu}" ]; then
  direct_l1_append="${direct_l1_append} morpheus.l2_cpu=${l2_cpu}"
  args+=(
    "-fw_cfg" "name=opt/morpheus/l2-cpu,string=${l2_cpu}"
    "-smbios" "type=11,value=morpheus.l2_cpu=${l2_cpu}"
  )
fi
if [ -f "${direct_l1_kernel}" ] && [ -f "${direct_l1_initrd}" ]; then
  args+=(
    "-kernel" "${direct_l1_kernel}"
    "-initrd" "${direct_l1_initrd}"
    "-append" "${direct_l1_append}"
  )
else
  args+=("-bios" "${firmware}")
fi

launch_env=(
  "STUB=${stub_elf}"
  "MORPHEUS_LIBAFL_CORPUS_DIR=${corpus_dir}"
  "MORPHEUS_LIBAFL_OBJECTIVE_DIR=${objective_dir}"
)
if [ -n "${l2_run_window_ms}" ]; then
  launch_env+=("MORPHEUS_LIBAFL_L2_RUN_WINDOW_MS=${l2_run_window_ms}")
fi
if [ "${replay_enabled}" = "true" ]; then
  launch_env+=(
    "MORPHEUS_LIBAFL_REPLAY_INPUTS=${replay_inputs_file}"
    "MORPHEUS_LIBAFL_REPLAY_STATE=${replay_state_file}"
  )
fi

launch_cmd=(
  env
  "${launch_env[@]}"
  "${fuzzer_bin}"
  "${args[@]}"
)

child_pid=""
cleanup() {
  local status="$1"
  if [ -n "${child_pid}" ]; then
    kill_run "${child_pid}"
  fi
  extract_l1_runtime_from_log "${l1_runtime_dir}" "${step_log_file}" "${replay_enabled}" "${replay_state_file}"
  cat > "${manifest_file}" <<EOF
{"schemaVersion":1,"tool":"libafl","status":"${status}","runDir":"${run_dir}","manifest":"${manifest_file}","pid":null,"stubElf":"${stub_elf}","nvirshState":"${nvirsh_state}","l1RuntimeDir":"${l1_runtime_dir}","corpusDir":"${corpus_dir}","objectiveDir":"${objective_dir}","replayState":"${replay_state_file}","replayInputs":"${replay_inputs_file}"}
EOF
}

if [ "${detach}" = "true" ]; then
  setsid "${launch_cmd[@]}" < /dev/null &
  pid="$!"
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
    setsid "${launch_cmd[@]}" &
    child_pid="$!"
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
    if wait "${child_pid}"; then
      child_status=0
    else
      child_status="$?"
    fi
    child_pid=""
    echo "libafl fuzzer exited before timed run completed; restarting attempt $((attempt + 1)) after status ${child_status}" >&2
    attempt=$((attempt + 1))
    sleep 1
  done
else
  setsid "${launch_cmd[@]}" &
  child_pid="$!"
  cat > "${manifest_file}" <<EOF
{"schemaVersion":1,"tool":"libafl","status":"running","runDir":"${run_dir}","manifest":"${manifest_file}","pid":${child_pid},"stubElf":"${stub_elf}","nvirshState":"${nvirsh_state}","corpusDir":"${corpus_dir}","objectiveDir":"${objective_dir}","replayState":"${replay_state_file}","replayInputs":"${replay_inputs_file}"}
EOF
  wait "${child_pid}"
  child_pid=""
fi

cat > "${manifest_file}" <<EOF
{"schemaVersion":1,"tool":"libafl","status":"success","runDir":"${run_dir}","manifest":"${manifest_file}","pid":null,"stubElf":"${stub_elf}","nvirshState":"${nvirsh_state}","l1RuntimeDir":"${l1_runtime_dir}","corpusDir":"${corpus_dir}","objectiveDir":"${objective_dir}","replayState":"${replay_state_file}","replayInputs":"${replay_inputs_file}"}
EOF
extract_l1_runtime_from_log "${l1_runtime_dir}" "${step_log_file}" "${replay_enabled}" "${replay_state_file}"
write_result
