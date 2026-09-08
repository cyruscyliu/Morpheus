#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${script_dir}/../../_shared/scripts/parallelism.sh"
source_dir="${MORPHEUS_LIBAFL_SOURCE:?}"
install_dir="${MORPHEUS_LIBAFL_INSTALL_DIR:?}"
run_dir="${MORPHEUS_LIBAFL_RUN_DIR:?}"
workspace_root="${MORPHEUS_LIBAFL_WORKSPACE:-${MORPHEUS_SCRIPT_WORKSPACE:?}}"
data_root="${MORPHEUS_DATA_ROOT:-$(cd "${workspace_root}/../.." && pwd)}"
cache_root="${MORPHEUS_CACHE_ROOT:-${data_root}/cache}"
cache_namespace="${MORPHEUS_LIBAFL_CACHE_NAMESPACE:-}"
if [ -z "${cache_namespace}" ]; then
  cache_namespace="$(basename "${workspace_root}")"
fi
bridge_build_dir_key="${MORPHEUS_LIBAFL_QEMU_BRIDGE_BUILD_DIR_KEY:-qemu-libafl-bridge-11.0.3-aarch64-softmmu}"
nvirsh_build_dir_key="${MORPHEUS_LIBAFL_NVIRSH_BUILD_DIR_KEY:-qemu-buildroot-based-cvm-libafl-grammar-nesting-fuzzing-v3-nopanic}"
bridge_root="${cache_root}/${cache_namespace}/tools/qemu-libafl-bridge/builds/${bridge_build_dir_key}"
bridge_source="${MORPHEUS_LIBAFL_QEMU_BRIDGE_SOURCE:-${bridge_root}/rebased-source}"
bridge_library="${MORPHEUS_LIBAFL_QEMU_BRIDGE_LIBRARY:-${bridge_root}/install/lib/libqemu-system-aarch64.so}"
bridge_data_dir="${MORPHEUS_LIBAFL_QEMU_BRIDGE_DATA_DIR:-${bridge_root}/build/qemu-bundle/usr/local/share/qemu}"
nvirsh_state="${MORPHEUS_LIBAFL_NVIRSH_STATE:-${cache_root}/${cache_namespace}/tools/nvirsh-buildroot-based-cvm/builds/${nvirsh_build_dir_key}/install/state.json}"
seed_input="${MORPHEUS_LIBAFL_SEED_INPUT:?}"
build_dir_key="${MORPHEUS_LIBAFL_BUILD_DIR_KEY:-default}"
repetitions="${MORPHEUS_LIBAFL_REPETITIONS:-3}"
l2_memory_mb="${MORPHEUS_LIBAFL_L2_MEMORY_MB:-512}"
l2_run_window_ms="${MORPHEUS_LIBAFL_L2_RUN_WINDOW_MS:-180000}"
startup_timeout="${MORPHEUS_LIBAFL_STARTUP_TIMEOUT_SECONDS:-300}"
reference_baseline="${MORPHEUS_LIBAFL_REFERENCE_BASELINE_MS:-}"
reference_report="${MORPHEUS_LIBAFL_REFERENCE_REPORT:-}"
result_file="${MORPHEUS_LIBAFL_RESULT_FILE:-${MORPHEUS_SCRIPT_RESULT_FILE:?}}"
report_file="${run_dir}/benchmark.json"
records_file="${run_dir}/benchmark-records.jsonl"

for required_path in "${source_dir}" "${install_dir}" "${bridge_source}" \
  "${bridge_library}" "${bridge_data_dir}" "${nvirsh_state}" "${seed_input}"; do
  if [ ! -e "${required_path}" ]; then
    echo "missing benchmark input: ${required_path}" >&2
    exit 1
  fi
done
if ! [[ "${repetitions}" =~ ^[1-9][0-9]*$ ]]; then
  echo "repetitions must be a positive integer" >&2
  exit 1
fi
if ! [[ "${l2_memory_mb}" =~ ^[1-9][0-9]*$ ]]; then
  echo "l2-memory-mb must be a positive integer" >&2
  exit 1
fi
if ! [[ "${l2_run_window_ms}" =~ ^[1-9][0-9]*$ ]]; then
  echo "l2-run-window-ms must be a positive integer" >&2
  exit 1
fi
if ! [[ "${startup_timeout}" =~ ^[1-9][0-9]*$ ]]; then
  echo "startup-timeout-seconds must be a positive integer" >&2
  exit 1
fi
if [ -n "${reference_baseline}" ] &&
   ! [[ "${reference_baseline}" =~ ^[0-9]+([.][0-9]+)?$ ]]; then
  echo "reference-baseline-ms must be a non-negative number" >&2
  exit 1
fi
if [ -n "${reference_report}" ] && [ ! -f "${reference_report}" ]; then
  echo "reference-report must point to a readable benchmark.json" >&2
  exit 1
fi

read_values() {
  local raw="$1"
  local fallback="$2"
  if [ -z "${raw}" ]; then
    printf '%s\n' "${fallback}"
    return 0
  fi
  printf '%s\n' "${raw}" | tr ',' '\n' | awk 'NF { print }'
}

validate_values() {
  local label="$1"
  shift
  local value
  for value in "$@"; do
    if ! [[ "${value}" =~ ^[1-9][0-9]*$ ]]; then
      echo "${label} must contain positive integers; got ${value}" >&2
      exit 1
    fi
  done
}

mapfile -t l1_values < <(read_values "${MORPHEUS_LIBAFL_L1_SMP:-}" "1")
mapfile -t l2_values < <(read_values "${MORPHEUS_LIBAFL_L2_SMP:-}" "1")
validate_values "l1-smp" "${l1_values[@]}"
validate_values "l2-smp" "${l2_values[@]}"
l1_smp_cap="$(morpheus_default_jobs)"

mkdir -p "${run_dir}"
: > "${records_file}"

for l1_smp in "${l1_values[@]}"; do
  for l2_smp in "${l2_values[@]}"; do
    if [ "${l1_smp}" -lt "${l2_smp}" ]; then
      continue
    fi
    for ((repeat = 1; repeat <= repetitions; repeat++)); do
      case_dir="${run_dir}/cases/l1-${l1_smp}-l2-${l2_smp}/repeat-${repeat}"
      mkdir -p "${case_dir}"
      if [ "${l1_smp}" -gt "${l1_smp_cap}" ]; then
        node - "${records_file}" "${l1_smp}" "${l2_smp}" "${repeat}" \
          "${case_dir}" "${l1_smp_cap}" <<'NODE'
const fs = require("fs");
const [recordsFile, l1Raw, l2Raw, repeatRaw, caseDir, capRaw] = process.argv.slice(2);
fs.appendFileSync(recordsFile, `${JSON.stringify({
  case_dir: caseDir,
  l1_smp: Number(l1Raw),
  l2_smp: Number(l2Raw),
  repetition: Number(repeatRaw),
  exec_status: 125,
  duration_ms: null,
  timing_status: "unsupported-l1-smp-cap",
  l1_smp_cap: Number(capRaw),
})}\n`);
NODE
        continue
      fi
      set +e
      env \
        MORPHEUS_LIBAFL_SOURCE="${source_dir}" \
        MORPHEUS_LIBAFL_RUN_DIR="${case_dir}" \
        MORPHEUS_LIBAFL_INSTALL_DIR="${install_dir}" \
        MORPHEUS_LIBAFL_RESULT_FILE="${case_dir}/result.json" \
        MORPHEUS_LIBAFL_QEMU_BRIDGE_SOURCE="${bridge_source}" \
        MORPHEUS_LIBAFL_QEMU_BRIDGE_LIBRARY="${bridge_library}" \
        MORPHEUS_LIBAFL_QEMU_BRIDGE_DATA_DIR="${bridge_data_dir}" \
        MORPHEUS_LIBAFL_WORKSPACE="${workspace_root}" \
        MORPHEUS_LIBAFL_L1_SMP="${l1_smp}" \
        MORPHEUS_LIBAFL_EXECUTOR_TIMEOUT_SECONDS="${startup_timeout}" \
        bash "${script_dir}/exec.sh" \
          --nvirsh-state "${nvirsh_state}" \
          --l2-mode cvm \
          --l2-accel kvm \
          --l2-cpu host \
          --l2-smp "${l2_smp}" \
          --l2-memory-mb "${l2_memory_mb}" \
          --l2-run-window-ms "${l2_run_window_ms}" \
          --replay-input "${seed_input}" \
          --disable-nqc2-plugin \
          --measure-l2-startup \
          > "${case_dir}/benchmark.stdout.log" \
          2> "${case_dir}/benchmark.stderr.log"
      exec_status="$?"
      set -e

      node - "${records_file}" "${case_dir}/l2-startup-timing.json" \
        "${l1_smp}" "${l2_smp}" "${repeat}" "${exec_status}" "${case_dir}" <<'NODE'
const fs = require("fs");
const [recordsFile, timingFile, l1Raw, l2Raw, repeatRaw, statusRaw, caseDir] =
  process.argv.slice(2);
let timing = null;
if (fs.existsSync(timingFile)) {
  try {
    timing = JSON.parse(fs.readFileSync(timingFile, "utf8"));
  } catch {}
}
const samples = timing && Array.isArray(timing.samples) ? timing.samples : [];
const durations = samples
  .map((sample) => Number(sample.duration_ms))
  .filter((value) => Number.isFinite(value));
fs.appendFileSync(recordsFile, `${JSON.stringify({
  case_dir: caseDir,
  l1_smp: Number(l1Raw),
  l2_smp: Number(l2Raw),
  repetition: Number(repeatRaw),
  exec_status: Number(statusRaw),
  duration_ms: durations.length ? durations[durations.length - 1] : null,
  timing_status: durations.length ? "complete" : "missing",
})}\n`);
NODE
    done
  done
done

host_model="$(LC_ALL=C lscpu 2>/dev/null | awk -F: '/Model name/ {gsub(/^[ \t]+/, "", $2); print $2; exit}' || true)"
host_cpus="$(getconf _NPROCESSORS_ONLN 2>/dev/null || true)"

node - "${records_file}" "${report_file}" "${build_dir_key}" \
  "${repetitions}" "${reference_baseline}" "${host_model}" "${host_cpus}" \
  "${l2_memory_mb}" "${l2_run_window_ms}" "${l1_values[*]}" \
  "${l2_values[*]}" "${l1_smp_cap}" "${reference_report}" <<'NODE'
const fs = require("fs");
const [recordsFile, reportFile, buildDirKey, repetitionsRaw, referenceRaw,
  hostModel, hostCpusRaw, l2MemoryRaw, l2WindowRaw, l1Raw, l2Raw, l1CapRaw,
  referenceReportPath] =
  process.argv.slice(2);
const referenceReportFile = referenceReportPath || "";
const records = fs.readFileSync(recordsFile, "utf8")
  .split(/\r?\n/)
  .filter(Boolean)
  .map((line) => JSON.parse(line));
const repetitions = Number(repetitionsRaw);
const skippedCombinations = [];
for (const l1 of l1Raw.split(" ").filter(Boolean).map(Number)) {
  for (const l2 of l2Raw.split(" ").filter(Boolean).map(Number)) {
    if (l1 < l2) skippedCombinations.push({ l1_smp: l1, l2_smp: l2 });
  }
}
let referenceReport = null;
if (referenceReportFile !== "") {
  try {
    referenceReport = JSON.parse(fs.readFileSync(referenceReportFile, "utf8"));
  } catch (error) {
    console.error(`failed to parse reference-report: ${error.message}`);
    process.exit(1);
  }
}
const referenceBaselineFromReport = referenceReport
  && Array.isArray(referenceReport.combinations)
  ? referenceReport.combinations.find((entry) => entry.l1_smp === 1 && entry.l2_smp === 1)
  : null;
const referenceBaseline = referenceRaw === ""
  ? (referenceBaselineFromReport && Number.isFinite(Number(referenceBaselineFromReport.median_ms))
      ? Number(referenceBaselineFromReport.median_ms) : null)
  : Number(referenceRaw);
const referenceCombinations = new Map();
if (referenceReport && Array.isArray(referenceReport.combinations)) {
  for (const entry of referenceReport.combinations) {
    if (Number.isFinite(Number(entry.median_ms))) {
      referenceCombinations.set(`${entry.l1_smp}/${entry.l2_smp}`, Number(entry.median_ms));
    }
  }
}
const groups = new Map();
for (const record of records) {
  const key = `${record.l1_smp}/${record.l2_smp}`;
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(record);
}
function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}
const combinations = [];
for (const [key, entries] of groups) {
  const durations = entries.map((entry) => entry.duration_ms)
    .filter((value) => Number.isFinite(value));
  const [l1, l2] = key.split("/").map(Number);
  combinations.push({
    l1_smp: l1,
    l2_smp: l2,
    l2_memory_mb: Number(l2MemoryRaw),
    requested: entries.length,
    complete: durations.length,
    failed: entries.length - durations.length,
    durations_ms: durations,
    median_ms: median(durations),
    min_ms: durations.length ? Math.min(...durations) : null,
    max_ms: durations.length ? Math.max(...durations) : null,
    reference_median_ms: referenceCombinations.get(key) ?? null,
  });
}
combinations.sort((a, b) => (a.l1_smp - b.l1_smp) || (a.l2_smp - b.l2_smp));
const baseline = combinations.find((entry) => entry.l1_smp === 1 && entry.l2_smp === 1);
const baselineMs = baseline && baseline.median_ms !== null ? baseline.median_ms : null;
const coefficient = baselineMs !== null && referenceBaseline !== null && referenceBaseline > 0
  ? baselineMs / referenceBaseline
  : null;
for (const entry of combinations) {
  entry.complete_run_set = entry.complete === repetitions;
  entry.relative_to_1x1 = baselineMs !== null && entry.median_ms !== null
    ? entry.median_ms / baselineMs
    : null;
  entry.speedup_vs_1x1 = baselineMs !== null && entry.median_ms !== null
    ? baselineMs / entry.median_ms
    : null;
  entry.estimated_ms_from_reference_baseline = referenceBaseline !== null
    && coefficient !== null
    ? (entry.reference_median_ms !== null
        ? entry.reference_median_ms * coefficient
        : entry.relative_to_1x1 !== null
          ? referenceBaseline * entry.relative_to_1x1
          : null)
    : null;
  entry.estimated_ms_on_host = entry.estimated_ms_from_reference_baseline;
}
const complete = combinations.filter((entry) => entry.complete_run_set && entry.median_ms !== null);
const recommendation = complete.length === 0
  ? null
  : complete.reduce((best, entry) =>
      best === null || entry.median_ms < best.median_ms ? entry : best, null);
const report = {
  schemaVersion: 1,
  metric: "l2-qemu-exec-to-buildroot-ready",
  method: "libafl-replay",
  build_dir_key: buildDirKey,
  host: {
    model: hostModel || null,
    online_cpus: /^\d+$/.test(hostCpusRaw) ? Number(hostCpusRaw) : null,
  },
  design: {
    l1_smp: l1Raw.split(" ").filter(Boolean).map(Number),
    l2_smp: l2Raw.split(" ").filter(Boolean).map(Number),
    constraint: "l1_smp >= l2_smp",
    skipped_combinations: skippedCombinations,
    l2_memory_mb: Number(process.env.MORPHEUS_LIBAFL_L2_MEMORY_MB || 512),
    repetitions,
    l1_smp_cap: Number(l1CapRaw),
    timing_boundary: "L2 qemu-exec-start to Buildroot login prompt",
    readiness_timeout_ms: Number(l2WindowRaw),
    readiness_timeout_is_not_a_measurement: true,
  },
  normalization: {
    local_1x1_median_ms: baselineMs,
    reference_1x1_median_ms: referenceBaseline,
    reference_report: referenceReportFile || null,
    host_time_coefficient: coefficient,
    coefficient_definition: "local 1x1 median / reference 1x1 median",
    estimate_formula: "reference combination median * coefficient, or reference 1x1 * local relative_to_1x1 when no reference report is supplied",
  },
  samples: records,
  combinations,
  recommendation: recommendation
    ? { l1_smp: recommendation.l1_smp, l2_smp: recommendation.l2_smp,
        median_ms: recommendation.median_ms }
    : null,
};
fs.writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`);
NODE

node - "${result_file}" "${report_file}" "${run_dir}" <<'NODE'
const fs = require("fs");
const [resultFile, reportFile, runDir] = process.argv.slice(2);
fs.writeFileSync(resultFile, `${JSON.stringify({
  details: { run_dir: runDir, benchmark_report: reportFile },
  artifacts: [{ path: "benchmark-report", location: reportFile }],
}, null, 2)}\n`);
NODE
