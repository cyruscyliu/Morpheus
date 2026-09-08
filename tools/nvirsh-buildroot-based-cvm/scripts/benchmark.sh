#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${script_dir}/../../_shared/scripts/parallelism.sh"
install_dir="${MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_INSTALL_DIR:?}"
run_dir="${MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_RUN_DIR:?}"
state_file="${install_dir}/state.json"
build_dir_key="${MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_BUILD_DIR_KEY:-default}"
result_file="${MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_RESULT_FILE:-${MORPHEUS_SCRIPT_RESULT_FILE:?}}"
repetitions="${MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_REPETITIONS:-3}"
launch_timeout="${MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_STARTUP_TIMEOUT_SECONDS:-300}"
l2_memory_mb="${MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_L2_MEMORY_MB:-512}"
reference_baseline="${MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_REFERENCE_BASELINE_MS:-}"
reference_report="${MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_REFERENCE_REPORT:-}"
report_file="${run_dir}/benchmark.json"
records_file="${run_dir}/benchmark-records.jsonl"

if [ ! -f "${state_file}" ]; then
  echo "missing prepared state: ${state_file}" >&2
  exit 1
fi
if ! [[ "${repetitions}" =~ ^[1-9][0-9]*$ ]]; then
  echo "repetitions must be a positive integer" >&2
  exit 1
fi
if ! [[ "${launch_timeout}" =~ ^[1-9][0-9]*$ ]]; then
  echo "startup-timeout-seconds must be a positive integer" >&2
  exit 1
fi
if ! [[ "${l2_memory_mb}" =~ ^[1-9][0-9]*$ ]] ||
   [ "${l2_memory_mb}" -lt 256 ] || [ "${l2_memory_mb}" -gt 65536 ]; then
  echo "l2-memory-mb must be an integer between 256 and 65536" >&2
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

mapfile -t l1_values < <(
  read_values "${MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_L1_SMP:-}" "1"
)
mapfile -t l2_values < <(
  read_values "${MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_L2_SMP:-}" "1"
)
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
        MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_INSTALL_DIR="${install_dir}" \
        MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_RUN_DIR="${case_dir}" \
        MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_PHASE=launch \
        MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_BUILD_DIR_KEY="${build_dir_key}" \
        MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_RESULT_FILE="${case_dir}/result.json" \
        MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_L1_SMP="${l1_smp}" \
        MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_L2_SMP="${l2_smp}" \
        MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_L2_MEMORY_MB="${l2_memory_mb}" \
        MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_RUNTIME_SUBDIR="morpheus-l2-runtime-c${l1_smp}-${l2_smp}-r${repeat}" \
        MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_MEASURE_L2_STARTUP=true \
        MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_STOP_ON_READY=true \
        MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_LAUNCH_TIMEOUT_SECONDS="${launch_timeout}" \
        bash "${script_dir}/exec.sh" \
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
const duration = timing && Number.isFinite(Number(timing.duration_ms))
  ? Number(timing.duration_ms)
  : null;
const record = {
  case_dir: caseDir,
  l1_smp: Number(l1Raw),
  l2_smp: Number(l2Raw),
  repetition: Number(repeatRaw),
  exec_status: Number(statusRaw),
  duration_ms: duration,
  timing_status: timing ? String(timing.status || "unknown") : "missing",
};
fs.appendFileSync(recordsFile, `${JSON.stringify(record)}\n`);
NODE
    done
  done
done

host_model="$(LC_ALL=C lscpu 2>/dev/null | awk -F: '/Model name/ {gsub(/^[ \t]+/, "", $2); print $2; exit}' || true)"
host_cpus="$(getconf _NPROCESSORS_ONLN 2>/dev/null || true)"

node - "${records_file}" "${report_file}" "${build_dir_key}" \
  "${repetitions}" "${reference_baseline}" "${host_model}" "${host_cpus}" \
  "${l2_memory_mb}" "${l1_values[*]}" "${l2_values[*]}" \
  "${l1_smp_cap}" "${reference_report}" <<'NODE'
const fs = require("fs");
const [recordsFile, reportFile, buildDirKey, repetitionsRaw, referenceRaw,
  hostModel, hostCpusRaw, l2MemoryRaw, l1Raw, l2Raw, l1CapRaw,
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
  && referenceReport.combinations
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
const summaries = [];
for (const [key, entries] of groups) {
  const durations = entries
    .map((entry) => entry.duration_ms)
    .filter((value) => Number.isFinite(value));
  const [l1, l2] = key.split("/").map(Number);
  summaries.push({
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
summaries.sort((a, b) => (a.l1_smp - b.l1_smp) || (a.l2_smp - b.l2_smp));
const baseline = summaries.find((entry) => entry.l1_smp === 1 && entry.l2_smp === 1);
const baselineMs = baseline && baseline.median_ms !== null ? baseline.median_ms : null;
const coefficient = baselineMs !== null && referenceBaseline !== null && referenceBaseline > 0
  ? baselineMs / referenceBaseline
  : null;
for (const entry of summaries) {
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
const complete = summaries.filter((entry) => entry.complete_run_set && entry.median_ms !== null);
const recommendation = complete.length === 0
  ? null
  : complete.reduce((best, entry) =>
      best === null || entry.median_ms < best.median_ms ? entry : best, null);
const report = {
  schemaVersion: 1,
  metric: "l2-qemu-exec-to-buildroot-ready",
  method: "nvirsh-direct",
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
    l2_memory_mb: Number(l2MemoryRaw),
    repetitions,
    l1_smp_cap: Number(l1CapRaw),
    timing_boundary: "qemu-exec-start to Buildroot login prompt",
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
  combinations: summaries,
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
