#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "${script_dir}/../.." && pwd)"
cd "${repo_root}"

seconds=""
cache_root=""
run_dir=""
l2_run_window_ms=""

usage() {
  cat <<'EOF'
Usage:
  projects/hyperarm/run-libafl-fuzzing-raw.sh --seconds N
  projects/hyperarm/run-libafl-fuzzing-raw.sh --minutes N
  projects/hyperarm/run-libafl-fuzzing-raw.sh --hours N
    [--l2-run-window-ms N]

Runs the extracted LibAFL qemu_nesting command directly, without Morpheus.
It reuses the existing HyperArm cache artifacts for LibAFL, QEMU firmware, and
the prepared nvirsh overlay.
EOF
}

die() {
  echo "error: $*" >&2
  exit 1
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --seconds)
      shift
      seconds="${1:-}"
      ;;
    --minutes)
      shift
      minutes="${1:-}"
      [[ "${minutes}" =~ ^[0-9]+$ ]] || die "--minutes requires an integer"
      seconds=$((minutes * 60))
      ;;
    --hours)
      shift
      hours="${1:-}"
      [[ "${hours}" =~ ^[0-9]+$ ]] || die "--hours requires an integer"
      seconds=$((hours * 3600))
      ;;
    --cache-root)
      shift
      cache_root="${1:-}"
      ;;
    --run-dir)
      shift
      run_dir="${1:-}"
      ;;
    --l2-run-window-ms)
      shift
      l2_run_window_ms="${1:-}"
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      die "unknown argument: $1"
      ;;
  esac
  shift
done

[ -n "${seconds}" ] || die "choose one of --seconds, --minutes, or --hours"
[[ "${seconds}" =~ ^[0-9]+$ ]] || die "timeout must be an integer"
[ "${seconds}" -gt 0 ] || die "timeout must be greater than zero"
if [ -n "${l2_run_window_ms}" ]; then
  [[ "${l2_run_window_ms}" =~ ^[0-9]+$ ]] || die "l2-run-window-ms must be an integer"
  [ "${l2_run_window_ms}" -ge 1000 ] || die "l2-run-window-ms must be at least 1000"
  [ "${l2_run_window_ms}" -le 900000 ] || die "l2-run-window-ms must be at most 900000"
fi

if [ -z "${cache_root}" ]; then
  home="${HOME:-}"
  if [ -z "${home}" ]; then
    home="$(getent passwd "$(id -u)" | cut -d: -f6)"
  fi
  cache_root="${home}/.cache/morpheus/hyperarm"
fi

if [ -z "${run_dir}" ]; then
  run_dir="projects/hyperarm/workspace/raw-libafl-runs/$(date -u +%Y%m%dT%H%M%SZ)"
fi
mkdir -p "${run_dir}"

state_file="${cache_root}/tools/nvirsh/builds/qemu-debian-arm64/install/state.json"
install_dir="${cache_root}/tools/libafl/builds/libafl-main/install"
fuzzer_bin="${install_dir}/bin/qemu_nesting"
stub_elf="${install_dir}/bin/libafl_nesting_stub"
qemu_bundle_dir="${cache_root}/tools/libafl/builds/libafl-main/build/qemu-libafl-bridge/build/qemu-bundle/usr/local/share/qemu"

[ -f "${state_file}" ] || die "missing prepared nvirsh state: ${state_file}"
[ -x "${fuzzer_bin}" ] || die "missing fuzzer binary: ${fuzzer_bin}"
[ -f "${stub_elf}" ] || die "missing guest stub: ${stub_elf}"
[ -d "${qemu_bundle_dir}" ] || die "missing QEMU bundle: ${qemu_bundle_dir}"

readarray -t state_fields < <(
  node - "${state_file}" <<'NODE'
const fs = require("fs");
const state = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const firmware = state.hostLaunch?.firmware || "";
const overlay = state.hostLaunch?.overlayImage || "";
const l1Args = Array.isArray(state.profileData?.l1?.launcherArgs)
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
process.stdout.write(`${firmware}\n${overlay}\n${cpu}\n${memory}\n${smp}\n`);
NODE
)

firmware="${state_fields[0]}"
overlay_image="${state_fields[1]}"
l1_cpu="${state_fields[2]}"
l1_memory="${state_fields[3]}"
l1_smp="${state_fields[4]}"
libafl_l1_smp="${MORPHEUS_LIBAFL_L1_SMP:-1}"

[ -f "${firmware}" ] || die "missing firmware: ${firmware}"
[ -f "${overlay_image}" ] || die "missing overlay image: ${overlay_image}"

args=(
  -machine virt,virtualization=on,gic-version=3
  -cpu "${l1_cpu}"
  -m "${l1_memory}"
  -smp "${libafl_l1_smp}"
  -nographic
  -bios "${firmware}"
  -drive "file=${overlay_image},if=virtio,format=qcow2"
  -L "${qemu_bundle_dir}"
)
if [ -n "${l2_run_window_ms}" ]; then
  args+=(
    -fw_cfg "name=opt/morpheus/l2-run-window-ms,string=${l2_run_window_ms}"
    -smbios "type=11,value=morpheus.l2_run_window_ms=${l2_run_window_ms}"
  )
fi

kill_group() {
  local pid="$1"
  [ -n "${pid}" ] || return 0
  kill -TERM -- "-${pid}" 2>/dev/null || true
  sleep 1
  kill -KILL -- "-${pid}" 2>/dev/null || true
}

pkill -f "${fuzzer_bin}" 2>/dev/null || true

echo "run_dir=${run_dir}"
echo "timeout_seconds=${seconds}"
echo "prepared_l1_smp=${l1_smp}"
echo "effective_l1_smp=${libafl_l1_smp}"
if [ -n "${l2_run_window_ms}" ]; then
  echo "l2_run_window_ms=${l2_run_window_ms}"
fi
echo "command:"
printf 'STUB=%q %q' "${stub_elf}" "${fuzzer_bin}"
printf ' %q' "${args[@]}"
printf '\n'

child_pid=""
trap 'kill_group "${child_pid}"; exit 143' TERM INT

end_time=$((SECONDS + seconds))
attempt=1
while [ "${SECONDS}" -lt "${end_time}" ]; do
  echo "starting attempt ${attempt}" | tee -a "${run_dir}/raw-run.log"
  setsid env "STUB=${stub_elf}" "${fuzzer_bin}" "${args[@]}" \
    > >(tee -a "${run_dir}/stdout.log") \
    2> >(tee -a "${run_dir}/stderr.log" >&2) &
  child_pid="$!"

  while [ "${SECONDS}" -lt "${end_time}" ] && kill -0 "${child_pid}" 2>/dev/null; do
    if ps -o stat= --ppid "${child_pid}" | grep -q 'Z'; then
      echo "defunct child detected; restarting" | tee -a "${run_dir}/raw-run.log" >&2
      kill_group "${child_pid}"
      break
    fi
    sleep 5
  done

  if [ "${SECONDS}" -ge "${end_time}" ]; then
    echo "timeout reached; stopping fuzzer" | tee -a "${run_dir}/raw-run.log"
    kill_group "${child_pid}"
    child_pid=""
    exit 0
  fi

  if wait "${child_pid}"; then
    status=0
  else
    status="$?"
  fi
  child_pid=""
  echo "fuzzer exited with status ${status}; restarting" | tee -a "${run_dir}/raw-run.log" >&2
  attempt=$((attempt + 1))
  sleep 1
done
