#!/usr/bin/env bash
set -euo pipefail

tool_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
legacy="${tool_root}/bin/llcg"
runtime_helper_default="$(cd "${tool_root}/../llbase/scripts" && pwd)/runtime.sh"
result_file="${MORPHEUS_LLCG_RESULT_FILE:-${MORPHEUS_SCRIPT_RESULT_FILE:?}}"
output_dir="${MORPHEUS_LLCG_OUTPUT:?}"
build_dir="${MORPHEUS_LLCG_BUILD_DIR:-${tool_root}/build}"
clang="${MORPHEUS_LLCG_CLANG:?}"
filter_list="${MORPHEUS_LLCG_FILTER_FILE:-}"
inline_filters="${MORPHEUS_LLCG_FILTER:-}"
llbase_contract="${MORPHEUS_LLCG_LLBASE_CONTRACT:-}"
kernel_version=""
llbic_source_dir=""

if [ -z "${filter_list}" ] && [ -s ".morpheus-filter.txt" ]; then
  filter_list="$(pwd)/.morpheus-filter.txt"
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

cmd=("${legacy}" run "--output" "${output_dir}" "--clang" "${clang}" "--json")
[ -n "${MORPHEUS_LLCG_BITCODE_LIST:-}" ] && cmd+=("--bitcode-list" "${MORPHEUS_LLCG_BITCODE_LIST}")
[ -n "${MORPHEUS_LLCG_LLBIC_JSON:-}" ] && cmd+=("--llbic-json" "${MORPHEUS_LLCG_LLBIC_JSON}")
[ -n "${MORPHEUS_LLCG_ALL_BC_LIST:-}" ] && cmd+=("--all-bc-list" "${MORPHEUS_LLCG_ALL_BC_LIST}")
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
  "${MORPHEUS_LLCG_BITCODE_LIST:-}" \
  "${MORPHEUS_LLCG_LLBIC_JSON:-}" \
  "${MORPHEUS_LLCG_ALL_BC_LIST:-}" \
  "${llbic_source_dir}" \
  -- \
  env \
  "LLCG_BUILD_DIR=${build_dir}" \
  bash -lc "cmake -S '${tool_root}' -B '${build_dir}' -DCLANG_VERSION='${clang}' -DLLVM_DIR='/usr/lib/llvm-${clang}/lib/cmake/llvm' >/dev/null && cmake --build '${build_dir}' --parallel --target build >/dev/null && exec \"\$@\"" bash "${cmd[@]}" \
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
