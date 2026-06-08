#!/usr/bin/env bash
set -euo pipefail

tool_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
legacy="${tool_root}/bin/llcg"
runtime_helper_default="$(cd "${tool_root}/../llbase/scripts" && pwd)/runtime.sh"
result_file="${MORPHEUS_LLCG_RESULT_FILE:-${MORPHEUS_SCRIPT_RESULT_FILE:?}}"
output_dir="${MORPHEUS_LLCG_OUTPUT:?}"
build_dir="${MORPHEUS_LLCG_BUILD_DIR:-${tool_root}/build}"
generator="${MORPHEUS_LLCG_GENERATOR:?}"
source_dir="${MORPHEUS_LLCG_SOURCE_DIR:?}"
file_list="${MORPHEUS_LLCG_FILE_FILE:-}"
inline_files="${MORPHEUS_LLCG_FILE:-}"
llbase_contract="${MORPHEUS_LLCG_LLBASE_CONTRACT:-}"

if [ -z "${file_list}" ] && [ -s ".morpheus-file.txt" ]; then
  file_list="$(pwd)/.morpheus-file.txt"
fi

mkdir -p "${output_dir}" "${build_dir}"
[ -n "${llbase_contract}" ] || {
  echo "llcg build requires --llbase-contract so the managed run uses the shared llbase container runtime" >&2
  exit 1
}

runtime_helper="$(
  node - "${llbase_contract}" "${runtime_helper_default}" <<'EOF'
const fs = require("fs");
const [contractPath, fallbackPath] = process.argv.slice(2);
const contract = JSON.parse(fs.readFileSync(contractPath, "utf8"));
process.stdout.write(String(contract.helperScripts?.runtime || fallbackPath));
EOF
)"
source "${runtime_helper}"
llbase_prepare_runtime "${llbase_contract}" "" "${MORPHEUS_LLCG_CLANG:-15}"

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
      echo "llcg build with generator=files requires at least one --file" >&2
      exit 1
    fi
    ;;
  interfaces)
    interfaces="${MORPHEUS_LLCG_INTERFACES:-}"
    [ -n "${interfaces}" ] || { echo "llcg build with generator=interfaces requires --interfaces" >&2; exit 1; }
    cmd=("${legacy}" genmutator interfaces "--source-dir" "${source_dir}" "--interfaces" "${interfaces}" "--output" "${output_dir}" "--json")
    [ -n "${MORPHEUS_LLCG_ARCH:-}" ] && cmd+=("--arch" "${MORPHEUS_LLCG_ARCH}")
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
  "${source_dir}" \
  "${llbase_contract}" \
  "${file_list}" \
  -- \
  bash -lc 'python3 -c "import kconfiglib" 2>/dev/null || python3 -m pip install --user --break-system-packages kconfiglib >/dev/null; exec "$@"' bash "${cmd[@]}" \
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
