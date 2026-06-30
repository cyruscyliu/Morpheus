#!/usr/bin/env bash
set -euo pipefail

tool_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "${tool_root}/../_shared/scripts/parallelism.sh"
repo_root="$(cd "${tool_root}/../.." && pwd)"
legacy="${tool_root}/llcg"
runtime_helper_default="$(cd "${tool_root}/../llbase/scripts" && pwd)/runtime.sh"
result_file="${MORPHEUS_LLCG_RESULT_FILE:-${MORPHEUS_SCRIPT_RESULT_FILE:?}}"
output_dir="${MORPHEUS_LLCG_OUTPUT:?}"
build_dir="${MORPHEUS_LLCG_BUILD_DIR:-${tool_root}/build}"
clang="${MORPHEUS_LLCG_CLANG:-15}"
generator="${MORPHEUS_LLCG_GENERATOR:-}"
source_dir="${MORPHEUS_LLCG_SOURCE_DIR:-}"
scope_list="${MORPHEUS_LLCG_SCOPE_LIST:-}"
groups_extension="${MORPHEUS_LLCG_GROUPS_EXTENSION:-}"
extra_edges_file="${MORPHEUS_LLCG_EXTRA_EDGES_FILE:-}"
file_list="${MORPHEUS_LLCG_FILE_FILE:-}"
inline_files="${MORPHEUS_LLCG_FILE:-}"
filter_list="${MORPHEUS_LLCG_FILTER_FILE:-}"
inline_filters="${MORPHEUS_LLCG_FILTER:-}"
llbase_contract="${MORPHEUS_LLCG_LLBASE_CONTRACT:-}"
jobs="${MORPHEUS_LLCG_JOBS:-$(morpheus_default_jobs)}"
kernel_version=""
llbic_source_dir=""
python_deps_dir="${output_dir}/python-deps"

if [ -z "${file_list}" ] && [ -s ".morpheus-file.txt" ]; then
  file_list="$(pwd)/.morpheus-file.txt"
fi
if [ -z "${filter_list}" ] && [ -s ".morpheus-filter.txt" ]; then
  filter_list="$(pwd)/.morpheus-filter.txt"
fi

if [ -n "${groups_extension}" ] && [[ "${groups_extension}" != /* ]]; then
  groups_extension="${repo_root}/${groups_extension#./}"
fi

if [ -n "${extra_edges_file}" ] && [[ "${extra_edges_file}" != /* ]]; then
  extra_edges_file="${repo_root}/${extra_edges_file#./}"
fi

filter_mounts=()
if [ -n "${inline_filters}" ]; then
  while IFS= read -r item; do
    [ -n "${item}" ] || continue
    filter_mounts+=("${item}")
  done <<< "${inline_filters}"
elif [ -n "${filter_list}" ] && [ -s "${filter_list}" ]; then
  while IFS= read -r item; do
    [ -n "${item}" ] || continue
    filter_mounts+=("${item}")
  done < "${filter_list}"
fi

mkdir -p "${output_dir}" "${build_dir}"
mkdir -p "${python_deps_dir}"
[ -n "${llbase_contract}" ] || {
  echo "llcg exec requires --llbase-contract so the managed run uses the shared llbase container runtime" >&2
  exit 1
}

cache_file="${build_dir}/CMakeCache.txt"
if [ -f "${cache_file}" ] && ! grep -q "^CMAKE_HOME_DIRECTORY:INTERNAL=${tool_root}$" "${cache_file}"; then
  rm -rf "${build_dir}"
  mkdir -p "${build_dir}"
fi

if [ -n "${MORPHEUS_LLCG_LLBIC_JSON:-}" ] && [ -f "${MORPHEUS_LLCG_LLBIC_JSON}" ]; then
  read -r kernel_version llbic_source_dir < <(
    node - "${MORPHEUS_LLCG_LLBIC_JSON}" <<'EOF'
const fs = require("fs");
const payload = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
process.stdout.write(`${String(payload.kernel_version || "")}\t${String(payload.source_dir || "")}\n`);
EOF
  )
fi

runtime_helper="$(
  node - "${llbase_contract}" "${runtime_helper_default}" <<'EOF'
const fs = require("fs");
const [contractPath, fallbackPath] = process.argv.slice(2);
const contract = JSON.parse(fs.readFileSync(contractPath, "utf8"));
process.stdout.write(String(contract.helperScripts?.runtime || fallbackPath));
EOF
)"
source "${runtime_helper}"
llbase_prepare_runtime "${llbase_contract}" "${kernel_version}" "${clang}"

if [ -n "${generator}" ]; then
  [ -n "${source_dir}" ] || {
    echo "llcg exec with --generator requires --source-dir" >&2
    exit 1
  }
  case "${generator}" in
    files)
      cmd=("${legacy}" genmutator files "--source-dir" "${source_dir}" "--output" "${output_dir}" "--json")
      [ -n "${MORPHEUS_LLCG_SCOPE_NAME:-}" ] && cmd+=("--scope-name" "${MORPHEUS_LLCG_SCOPE_NAME}")
      [ -n "${MORPHEUS_LLCG_ARCH:-}" ] && cmd+=("--arch" "${MORPHEUS_LLCG_ARCH}")
      if [ -n "${inline_files}" ]; then
        while IFS= read -r item; do
          [ -n "${item}" ] || continue
          cmd+=("--file" "${item}")
        done <<< "${inline_files}"
      elif [ -n "${file_list}" ] && [ -s "${file_list}" ]; then
        while IFS= read -r item; do
          [ -n "${item}" ] || continue
          cmd+=("--file" "${item}")
        done < "${file_list}"
      else
        echo "llcg exec with generator=files requires at least one --file" >&2
        exit 1
      fi
      ;;
    interfaces)
      interfaces="${MORPHEUS_LLCG_INTERFACES:-}"
      [ -n "${interfaces}" ] || { echo "llcg exec with generator=interfaces requires --interfaces" >&2; exit 1; }
      cmd=("${legacy}" genmutator interfaces "--source-dir" "${source_dir}" "--interfaces" "${interfaces}" "--output" "${output_dir}" "--json")
      [ -n "${scope_list}" ] && cmd+=("--scope-list" "${scope_list}")
      [ -n "${MORPHEUS_LLCG_ARCH:-}" ] && cmd+=("--arch" "${MORPHEUS_LLCG_ARCH}")
      ;;
    groups)
      cmd=("${legacy}" genmutator groups "--source-dir" "${source_dir}" "--output" "${output_dir}" "--json")
      [ -n "${MORPHEUS_LLCG_SCOPE_NAME:-}" ] && cmd+=("--scope-name" "${MORPHEUS_LLCG_SCOPE_NAME}")
      [ -n "${scope_list}" ] && cmd+=("--scope-list" "${scope_list}")
      [ -n "${groups_extension}" ] && cmd+=("--groups-extension" "${groups_extension}")
      [ -n "${MORPHEUS_LLCG_ARCH:-}" ] && cmd+=("--arch" "${MORPHEUS_LLCG_ARCH}")
      if [ -n "${inline_files}" ]; then
        while IFS= read -r item; do
          [ -n "${item}" ] || continue
          cmd+=("--file" "${item}")
        done <<< "${inline_files}"
      elif [ -n "${file_list}" ] && [ -s "${file_list}" ]; then
        while IFS= read -r item; do
          [ -n "${item}" ] || continue
          cmd+=("--file" "${item}")
        done < "${file_list}"
      elif [ -z "${scope_list}" ]; then
        echo "llcg exec with generator=groups requires --scope-list or at least one --file" >&2
        exit 1
      fi
      ;;
    *)
      echo "unsupported llcg generator: ${generator}" >&2
      exit 1
      ;;
  esac

  tmp_json="$(mktemp)"
  tmp_err="$(mktemp)"
  trap 'rm -f "${tmp_json}" "${tmp_err}"' EXIT
  set +e
  llbase_exec_in_container \
    "${tool_root}" \
    "${build_dir}" \
    "${tool_root}" \
    "${output_dir}" \
    "${python_deps_dir}" \
    "${source_dir}" \
    "${groups_extension}" \
    "${llbase_contract}" \
    "${file_list}" \
    "${scope_list}" \
    -- \
    bash -lc 'export PYTHONPATH="$1${PYTHONPATH:+:$PYTHONPATH}"; python3 -c "import kconfiglib" 2>/dev/null || python3 -m pip install --target "$1" --break-system-packages kconfiglib >/dev/null; shift; exec "$@"' bash "${python_deps_dir}" "${cmd[@]}" \
    > "${tmp_json}" 2> "${tmp_err}"
  llcg_rc=$?
  set -e
  node - "${tmp_json}" "${tmp_err}" "${result_file}" "${output_dir}" "${llcg_rc}" <<'EOF'
const fs = require("fs");
const path = require("path");

const jsonPath = path.resolve(process.argv[2]);
const errPath = path.resolve(process.argv[3]);
const resultFile = path.resolve(process.argv[4]);
const outputDir = path.resolve(process.argv[5]);
const rawExitCode = Number(process.argv[6] || "1");
const rawStdout = fs.readFileSync(jsonPath, "utf8");
const rawStderr = fs.readFileSync(errPath, "utf8");
let payload = null;
let jsonText = rawStdout.trim();
const jsonStart = rawStdout.lastIndexOf("\n{");
if (jsonStart >= 0) {
  jsonText = rawStdout.slice(jsonStart + 1).trim();
}
try {
  payload = JSON.parse(jsonText);
} catch {
  payload = {
    status: "error",
    exit_code: rawExitCode || 1,
    summary: "llcg mutator generation failed before emitting JSON",
    details: {
      stdout: rawStdout,
      stderr: rawStderr,
    },
  };
}
const artifacts = Array.isArray(payload.artifacts)
  ? payload.artifacts
      .filter((entry) => entry && typeof entry.key === "string" && typeof entry.resolved_path === "string")
      .map((entry) => ({ path: entry.key, location: entry.resolved_path }))
  : [];
artifacts.push({ path: "output-dir", location: outputDir });
fs.writeFileSync(
  resultFile,
  JSON.stringify({
    summary: payload.summary || "generated llcg mutator artifacts",
    details: {
      ...(payload.details || {}),
      output: outputDir,
      llbase_contract: process.env.MORPHEUS_LLCG_LLBASE_CONTRACT || "",
      ...(payload.error ? { error: payload.error } : {}),
      ...(rawStderr ? { stderr: rawStderr } : {}),
    },
    artifacts,
  }, null, 2) + "\n",
  "utf8",
);
if (payload.status !== "success") {
  process.stderr.write(JSON.stringify({
    summary: payload.summary || "llcg mutator generation failed",
    details: {
      ...(payload.details || {}),
      ...(payload.error ? { error: payload.error } : {}),
    },
  }, null, 2) + "\n");
}
process.exit(payload.status === "success" ? 0 : Number(payload.exit_code || rawExitCode || 1));
EOF
  exit $?
fi

cmd=("${legacy}" run "--output" "${output_dir}" "--clang" "${clang}" "--json")
[ -n "${MORPHEUS_LLCG_BITCODE_LIST:-}" ] && cmd+=("--bitcode-list" "${MORPHEUS_LLCG_BITCODE_LIST}")
[ -n "${MORPHEUS_LLCG_LLBIC_JSON:-}" ] && cmd+=("--llbic-json" "${MORPHEUS_LLCG_LLBIC_JSON}")
[ -n "${MORPHEUS_LLCG_ALL_BC_LIST:-}" ] && cmd+=("--all-bc-list" "${MORPHEUS_LLCG_ALL_BC_LIST}")
[ -n "${extra_edges_file}" ] && cmd+=("--extra-edges-file" "${extra_edges_file}")
[ -n "${MORPHEUS_LLCG_SCOPE_NAME:-}" ] && cmd+=("--scope-name" "${MORPHEUS_LLCG_SCOPE_NAME}")

if [ -n "${inline_filters}" ]; then
  while IFS= read -r item; do
    [ -n "${item}" ] || continue
    cmd+=("--filter" "${item}")
  done <<< "${inline_filters}"
elif [ -n "${filter_list}" ] && [ -s "${filter_list}" ]; then
  while IFS= read -r item; do
    [ -n "${item}" ] || continue
    cmd+=("--filter" "${item}")
  done < "${filter_list}"
fi

tmp_json="$(mktemp)"
tmp_err="$(mktemp)"
trap 'rm -f "${tmp_json}" "${tmp_err}"' EXIT
set +e
llbase_exec_in_container \
  "${tool_root}" \
  "${tool_root}" \
  "${build_dir}" \
  "${output_dir}" \
  "${llbase_contract}" \
  "${filter_list}" \
  "${filter_mounts[@]}" \
  "${extra_edges_file}" \
  "${MORPHEUS_LLCG_BITCODE_LIST:-}" \
  "${MORPHEUS_LLCG_LLBIC_JSON:-}" \
  "${MORPHEUS_LLCG_ALL_BC_LIST:-}" \
  "${llbic_source_dir}" \
  -- \
  env \
  "LLCG_BUILD_DIR=${build_dir}" \
  "LLCG_JOBS=${jobs}" \
  "${cmd[@]}" \
  > "${tmp_json}" 2> "${tmp_err}"
llcg_rc=$?
set -e
node - "${tmp_json}" "${tmp_err}" "${result_file}" "${output_dir}" "${llcg_rc}" <<'EOF'
const fs = require("fs");
const path = require("path");

const jsonPath = path.resolve(process.argv[2]);
const errPath = path.resolve(process.argv[3]);
const resultFile = path.resolve(process.argv[4]);
const outputDir = path.resolve(process.argv[5]);
const rawExitCode = Number(process.argv[6] || "1");
const rawStdout = fs.readFileSync(jsonPath, "utf8");
const rawStderr = fs.readFileSync(errPath, "utf8");
let payload = null;
let jsonText = rawStdout.trim();
const jsonStart = rawStdout.lastIndexOf("\n{");
if (jsonStart >= 0) {
  jsonText = rawStdout.slice(jsonStart + 1).trim();
}
try {
  payload = JSON.parse(jsonText);
} catch {
  payload = {
    status: "error",
    exit_code: rawExitCode || 1,
    summary: "llcg callgraph generation failed before emitting JSON",
    details: {
      stdout: rawStdout,
      stderr: rawStderr,
    },
  };
}
const exitCode = Number(payload.exit_code || rawExitCode || "1");
const pathEntries = payload.paths && typeof payload.paths === "object" ? payload.paths : {};
function stablePath(filePath) {
  const relative = path.relative(outputDir, filePath);
  return relative && !relative.startsWith("..") && !path.isAbsolute(relative)
    ? relative
    : filePath;
}
function pathView(filePath) {
  return {
    path: stablePath(filePath),
    resolved_path: filePath,
    exists: fs.existsSync(filePath),
  };
}
if (payload.status === "success") {
  if (!payload.details || typeof payload.details !== "object") {
    payload.details = {};
  }
  if (payload.paths && typeof payload.paths === "object") {
    payload.paths = pathEntries;
  }
  const manifestPath = path.resolve(outputDir, "llcg-manifest.json");
  if (fs.existsSync(manifestPath)) {
    fs.writeFileSync(manifestPath, JSON.stringify(payload, null, 2) + "\n", "utf8");
  }
}
const artifacts = Object.entries(pathEntries)
  .filter(([, entry]) => entry && typeof entry.resolved_path === "string")
  .map(([artifactPath, entry]) => ({ path: artifactPath, location: entry.resolved_path }));
artifacts.push({ path: "output-dir", location: outputDir });
const details = {
  ...(payload.details || {}),
  output: outputDir,
  llbase_contract: process.env.MORPHEUS_LLCG_LLBASE_CONTRACT || "",
};
if (Array.isArray(payload.failures) && payload.failures.length > 0) {
  details.failures = payload.failures;
}
if (Array.isArray(payload.warnings) && payload.warnings.length > 0) {
  details.warnings = payload.warnings;
}
if (payload.error && !details.error) {
  details.error = payload.error;
}
if (rawStderr && !details.stderr) {
  details.stderr = rawStderr;
}
fs.writeFileSync(
  resultFile,
  JSON.stringify({
    summary: payload.summary || "generated llcg callgraph artifacts",
    details,
    artifacts,
  }, null, 2) + "\n",
  "utf8",
);
if (payload.status !== "success") {
  process.stderr.write(JSON.stringify({ summary: payload.summary || "", details }, null, 2) + "\n");
}
process.exit(payload.status === "success" ? 0 : exitCode || 1);
EOF
