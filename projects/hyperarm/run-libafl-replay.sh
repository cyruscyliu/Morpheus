#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "${script_dir}/../.." && pwd)"
cd "${repo_root}"

config="projects/hyperarm/morpheus.yaml"
workflow="nvirsh-aarch64-libafl-nesting-fuzzing"
run_id="wf-20260609011130-6eb23996"
json="false"
disable_nqc2_plugin="false"
l2_run_window_ms="30000"
l2_accel="auto"
l2_cpu=""
inputs=()

usage() {
  cat <<'EOF'
Usage:
  projects/hyperarm/run-libafl-replay.sh --input PATH [--input PATH ...]
  projects/hyperarm/run-libafl-replay.sh --run-id ID --input PATH [--json]

Replays one or more LibAFL qemu_nesting seeds through Morpheus. PATH may be a
single seed file or a directory containing on-disk corpus/objective entries.
Dotfiles and *.metadata files are ignored by the LibAFL exec step.

Options:
  --disable-nqc2-plugin   Launch L2 QEMU without the guest NQC2 plugin.
  --l2-run-window-ms N     L2 QEMU run window per replay input. Default: 30000.
  --l2-accel MODE          L2 accelerator: auto, kvm, or tcg. Default: auto.
  --l2-cpu MODEL           L2 CPU model: host, max, or cortex-a57.
EOF
}

die() {
  echo "error: $*" >&2
  exit 1
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --input)
      shift
      inputs+=("${1:-}")
      ;;
    --run-id)
      shift
      run_id="${1:-}"
      ;;
    --config)
      shift
      config="${1:-}"
      ;;
    --json)
      json="true"
      ;;
    --disable-nqc2-plugin)
      disable_nqc2_plugin="true"
      ;;
    --l2-run-window-ms)
      shift
      l2_run_window_ms="${1:-}"
      ;;
    --l2-accel)
      shift
      l2_accel="${1:-}"
      ;;
    --l2-cpu)
      shift
      l2_cpu="${1:-}"
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

[ "${#inputs[@]}" -gt 0 ] || die "provide at least one --input PATH"
[ -f "${config}" ] || die "missing config: ${config}"
[[ "${l2_run_window_ms}" =~ ^[0-9]+$ ]] || die "l2-run-window-ms must be an integer"
[ "${l2_run_window_ms}" -ge 1000 ] || die "l2-run-window-ms must be at least 1000"
[ "${l2_run_window_ms}" -le 900000 ] || die "l2-run-window-ms must be at most 900000"
case "${l2_accel}" in
  auto|kvm|tcg) ;;
  *) die "l2-accel must be one of: auto, kvm, tcg" ;;
esac
if [ -n "${l2_cpu}" ]; then
  case "${l2_cpu}" in
    host|max|cortex-a57) ;;
    *) die "l2-cpu must be one of: host, max, cortex-a57" ;;
  esac
fi

for input in "${inputs[@]}"; do
  [ -e "${input}" ] || die "missing replay input: ${input}"
done

absolute_inputs=()
for input in "${inputs[@]}"; do
  absolute_inputs+=("$(realpath "${input}")")
done

inspect_json="$(./bin/morpheus --config "${config}" workflow inspect --id "${run_id}" --json)"
readarray -t artifacts < <(
  node -e '
const fs = require("fs");
const workflow = process.argv[1];
const payload = JSON.parse(fs.readFileSync(0, "utf8"));
const details = payload.details || {};
const actualWorkflow = details.workflowName || details.workflow;
if (actualWorkflow !== workflow) {
  throw new Error(`run ${details.id} is ${actualWorkflow}, not ${workflow}`);
}
function artifact(stepId, name) {
  const step = (details.steps || []).find((item) => item.id === stepId);
  if (!step || step.status !== "success") {
    throw new Error(`step ${stepId} is not successful`);
  }
  const found = (step.artifacts || []).find((item) => item.path === name);
  if (!found || !found.location) {
    throw new Error(`missing artifact ${stepId}.${name}`);
  }
  return found.location;
}
process.stdout.write(`${artifact("libafl_patch", "source-dir")}\n`);
process.stdout.write(`${artifact("nvirsh_build", "prepared-state")}\n`);
  ' "${workflow}" <<<"${inspect_json}"
)

source_dir="${artifacts[0]}"
nvirsh_state="${artifacts[1]}"

cmd=(
  ./bin/morpheus
  --config "${config}"
  workflow run
  --tool libafl
  --source "${source_dir}"
  --harness-script "projects/hyperarm/workspace/tools/libafl/scripts/qemu_nesting/exec.sh"
  --harness-arg "--nvirsh-state"
  --harness-arg "${nvirsh_state}"
  --harness-arg "--l2-run-window-ms"
  --harness-arg "${l2_run_window_ms}"
  --harness-arg "--l2-accel"
  --harness-arg "${l2_accel}"
)

if [ -n "${l2_cpu}" ]; then
  cmd+=(--harness-arg "--l2-cpu" --harness-arg "${l2_cpu}")
fi

for input in "${absolute_inputs[@]}"; do
  cmd+=(--harness-arg "--replay-input" --harness-arg "${input}")
done

if [ "${disable_nqc2_plugin}" = "true" ]; then
  cmd+=(--harness-arg "--disable-nqc2-plugin")
fi

if [ "${json}" = "true" ]; then
  cmd+=(--json)
fi

"${cmd[@]}"
