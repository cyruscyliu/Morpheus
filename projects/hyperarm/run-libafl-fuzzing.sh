#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "${script_dir}/../.." && pwd)"
cd "${repo_root}"

config="projects/hyperarm/morpheus.yaml"
workflow="nvirsh-aarch64-libafl-nesting-fuzzing"
run_id="wf-20260609011130-6eb23996"
seconds=""
json="false"

usage() {
  cat <<'EOF'
Usage:
  projects/hyperarm/run-libafl-fuzzing.sh --seconds N [--run-id ID] [--json]
  projects/hyperarm/run-libafl-fuzzing.sh --minutes N [--run-id ID] [--json]
  projects/hyperarm/run-libafl-fuzzing.sh --hours N [--run-id ID] [--json]

Runs the HyperArm LibAFL nesting fuzzer by resuming only the libafl_exec
Morpheus workflow step. Prior fetch/build/prep artifacts are reused from
that workflow run. If --run-id is omitted, this uses the run we have been
working from: wf-20260609011130-6eb23996.
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
[ -f "${config}" ] || die "missing config: ${config}"

run_manifest="projects/hyperarm/workspace/runs/${run_id}/workflow.json"
[ -f "${run_manifest}" ] || die "missing workflow run: ${run_id}"
node - "${run_manifest}" "${workflow}" <<'NODE'
const fs = require("fs");
const [manifest, workflow] = process.argv.slice(2);
const data = JSON.parse(fs.readFileSync(manifest, "utf8"));
if (data.workflow !== workflow) {
  throw new Error(`run ${data.id} is ${data.workflow}, not ${workflow}`);
}
NODE
latest_run_id="$(node - "projects/hyperarm/workspace/runs" "${workflow}" <<'NODE'
const fs = require("fs");
const path = require("path");
const [runsDir, workflow] = process.argv.slice(2);
const runs = fs.readdirSync(runsDir)
  .map((id) => {
    const manifest = path.join(runsDir, id, "workflow.json");
    if (!fs.existsSync(manifest)) return null;
    const data = JSON.parse(fs.readFileSync(manifest, "utf8"));
    if (data.workflow !== workflow) return null;
    return { id, createdAt: data.createdAt || "" };
  })
  .filter(Boolean)
  .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
if (runs[0]) process.stdout.write(runs[0].id);
NODE
)"
[ "${latest_run_id}" = "${run_id}" ] || die "run ${run_id} is not the latest ${workflow} run (${latest_run_id}); Morpheus can only apply temporary step config through workflow run --only-step"

tmp_config="$(mktemp "projects/hyperarm/libafl-fuzzing.XXXXXX.yaml")"
trap 'rm -f "${tmp_config}"' EXIT

step_timeout=$((seconds + 120))
node - "${config}" "${tmp_config}" "${workflow}" "${seconds}" "${step_timeout}" <<'NODE'
const fs = require("fs");
const [configPath, outPath, workflow, seconds, stepTimeout] = process.argv.slice(2);
const lines = fs.readFileSync(configPath, "utf8").split(/\n/);
let inWorkflow = false;
let inExec = false;
let replaceNextRunSeconds = false;
let sawWorkflow = false;
let sawExec = false;
let changedRunSeconds = false;
let changedTimeout = false;

const out = lines.map((line) => {
  if (/^  [A-Za-z0-9_.:-]+:$/.test(line)) {
    inWorkflow = line === `  ${workflow}:`;
    if (inWorkflow) sawWorkflow = true;
    inExec = false;
  }
  if (inWorkflow && /^      - id: /.test(line)) {
    inExec = line.trim() === "- id: libafl_exec";
    if (inExec) sawExec = true;
  }
  if (inExec && replaceNextRunSeconds && /^          - /.test(line)) {
    replaceNextRunSeconds = false;
    changedRunSeconds = true;
    return `          - "${seconds}"`;
  }
  if (inExec && line.trim() === "- --run-seconds") {
    replaceNextRunSeconds = true;
    return line;
  }
  if (inExec && /^        timeout-seconds: /.test(line)) {
    changedTimeout = true;
    return `        timeout-seconds: ${stepTimeout}`;
  }
  return line;
});

if (!sawWorkflow) throw new Error(`workflow not found: ${workflow}`);
if (!sawExec) throw new Error("libafl_exec step not found");
if (!changedRunSeconds) throw new Error("libafl_exec --run-seconds not found");
if (!changedTimeout) throw new Error("libafl_exec timeout-seconds not found");
fs.writeFileSync(outPath, out.join("\n"));
NODE

echo "running ${workflow} run ${run_id} libafl_exec for ${seconds}s" >&2
cmd=(
  ./bin/morpheus
  --config "${tmp_config}"
  workflow run
  --name "${workflow}"
  --only-step libafl_exec
)
if [ "${json}" = "true" ]; then
  cmd+=(--json)
fi

"${cmd[@]}"
