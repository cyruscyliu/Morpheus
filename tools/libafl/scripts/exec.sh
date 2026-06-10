#!/usr/bin/env bash
set -euo pipefail

source_dir="${MORPHEUS_LIBAFL_SOURCE:?}"
run_dir="${MORPHEUS_LIBAFL_RUN_DIR:?}"
install_dir="${MORPHEUS_LIBAFL_INSTALL_DIR:?}"
nvirsh_state="${MORPHEUS_LIBAFL_NVIRSH_STATE:?}"
detach="${MORPHEUS_LIBAFL_DETACH:-false}"
run_seconds="${MORPHEUS_LIBAFL_RUN_SECONDS:-0}"
result_file="${MORPHEUS_LIBAFL_RESULT_FILE:-${MORPHEUS_SCRIPT_RESULT_FILE:?}}"
manifest_file="${run_dir}/manifest.json"
l1_runtime_dir="${run_dir}/l1-runtime"
corpus_dir="${run_dir}/corpus"
objective_dir="${run_dir}/crashes"
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
process.stdout.write(`${firmware}\n${overlay}\n${seed}\n${cpu}\n${memory}\n${smp}\n`);
NODE
)

firmware="${state_fields[0]}"
overlay_image="${state_fields[1]}"
l1_cpu="${state_fields[3]}"
l1_memory="${state_fields[4]}"
l1_smp="${state_fields[5]}"
qemu_data_dir="${qemu_bundle_dir}"
firmware_data_dir="$(dirname "${firmware}")"
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

  if [ ! -f "${log_file}" ]; then
    return 0
  fi
  node - "${log_file}" "${output_dir}" <<'NODE'
const fs = require("fs");
const path = require("path");

const logFile = process.argv[2];
const outputDir = process.argv[3];
const safeName = /^[A-Za-z0-9._-]+$/;
const records = new Map();

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

function writeRecord(name, record) {
  if (!record || !record.complete) {
    return;
  }
  const chunks = [...record.chunks.entries()]
    .sort((left, right) => left[0] - right[0])
    .map((entry) => entry[1]);
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, name), Buffer.concat(chunks));
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
      writeRecord(match[1], record);
    }
  }
}
NODE
}

write_result() {
  cat > "${result_file}" <<EOF
{"details":{"pid":null,"detached":false,"run_dir":"${run_dir}","manifest":"${manifest_file}","l1_runtime_dir":"${l1_runtime_dir}","corpus_dir":"${corpus_dir}","objective_dir":"${objective_dir}"},"artifacts":[{"path":"l1-runtime-dir","location":"${l1_runtime_dir}"},{"path":"corpus-dir","location":"${corpus_dir}"},{"path":"objective-dir","location":"${objective_dir}"}]}
EOF
}

args=(
  "-machine" "virt,virtualization=on,gic-version=3"
  "-cpu" "${l1_cpu}"
  "-m" "${l1_memory}"
  "-smp" "${l1_smp}"
  "-nographic"
  "-bios" "${firmware}"
  "-drive" "file=${overlay_image},if=virtio,format=qcow2"
  "-L" "${qemu_data_dir}"
)

launch_cmd=(
  env
  "STUB=${stub_elf}"
  "MORPHEUS_LIBAFL_CORPUS_DIR=${corpus_dir}"
  "MORPHEUS_LIBAFL_OBJECTIVE_DIR=${objective_dir}"
  "${fuzzer_bin}"
  "${args[@]}"
)

child_pid=""
cleanup() {
  local status="$1"
  if [ -n "${child_pid}" ]; then
    kill_run "${child_pid}"
  fi
  extract_l1_runtime_from_log "${l1_runtime_dir}" "${step_log_file}"
  cat > "${manifest_file}" <<EOF
{"schemaVersion":1,"tool":"libafl","status":"${status}","runDir":"${run_dir}","manifest":"${manifest_file}","pid":null,"stubElf":"${stub_elf}","nvirshState":"${nvirsh_state}","l1RuntimeDir":"${l1_runtime_dir}","corpusDir":"${corpus_dir}","objectiveDir":"${objective_dir}"}
EOF
}

if [ "${detach}" = "true" ]; then
  setsid "${launch_cmd[@]}" < /dev/null &
  pid="$!"
  cat > "${manifest_file}" <<EOF
{"schemaVersion":1,"tool":"libafl","status":"running","runDir":"${run_dir}","manifest":"${manifest_file}","pid":${pid},"stubElf":"${stub_elf}","nvirshState":"${nvirsh_state}","corpusDir":"${corpus_dir}","objectiveDir":"${objective_dir}"}
EOF
  cat > "${result_file}" <<EOF
{"details":{"pid":${pid},"detached":true,"run_dir":"${run_dir}","manifest":"${manifest_file}","l1_runtime_dir":"${l1_runtime_dir}","corpus_dir":"${corpus_dir}","objective_dir":"${objective_dir}"},"artifacts":[{"path":"l1-runtime-dir","location":"${l1_runtime_dir}"},{"path":"corpus-dir","location":"${corpus_dir}"},{"path":"objective-dir","location":"${objective_dir}"}]}
EOF
  exit 0
fi

trap 'cleanup "terminated"; exit 143' TERM INT
if [ "${run_seconds}" != "0" ]; then
  end_time=$((SECONDS + run_seconds))
  attempt=1
  while [ "${SECONDS}" -lt "${end_time}" ]; do
    setsid "${launch_cmd[@]}" &
    child_pid="$!"
    cat > "${manifest_file}" <<EOF
{"schemaVersion":1,"tool":"libafl","status":"running","runDir":"${run_dir}","manifest":"${manifest_file}","pid":${child_pid},"stubElf":"${stub_elf}","nvirshState":"${nvirsh_state}","attempt":${attempt},"corpusDir":"${corpus_dir}","objectiveDir":"${objective_dir}"}
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
{"schemaVersion":1,"tool":"libafl","status":"running","runDir":"${run_dir}","manifest":"${manifest_file}","pid":${child_pid},"stubElf":"${stub_elf}","nvirshState":"${nvirsh_state}","corpusDir":"${corpus_dir}","objectiveDir":"${objective_dir}"}
EOF
  wait "${child_pid}"
  child_pid=""
fi

cat > "${manifest_file}" <<EOF
{"schemaVersion":1,"tool":"libafl","status":"success","runDir":"${run_dir}","manifest":"${manifest_file}","pid":null,"stubElf":"${stub_elf}","nvirshState":"${nvirsh_state}","l1RuntimeDir":"${l1_runtime_dir}","corpusDir":"${corpus_dir}","objectiveDir":"${objective_dir}"}
EOF
extract_l1_runtime_from_log "${l1_runtime_dir}" "${step_log_file}"
write_result
