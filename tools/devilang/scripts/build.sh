#!/usr/bin/env bash
set -euo pipefail

tool_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "${tool_root}/../_shared/scripts/parallelism.sh"
runtime_helper_default="$(cd "${tool_root}/../llbase/scripts" && pwd)/runtime.sh"
result_file="${MORPHEUS_DEVILANG_RESULT_FILE:-${MORPHEUS_SCRIPT_RESULT_FILE:?}}"
build_dir="${MORPHEUS_DEVILANG_BUILD_DIR:-${tool_root}/build}"
clang="${MORPHEUS_DEVILANG_CLANG:-15}"
llbase_contract="${MORPHEUS_DEVILANG_LLBASE_CONTRACT:-}"
jobs="${MORPHEUS_DEVILANG_JOBS:-$(morpheus_default_jobs)}"

mkdir -p "${build_dir}"
[ -n "${llbase_contract}" ] || {
  echo "devilang build requires --llbase-contract so the managed run uses the shared llbase container runtime" >&2
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
llbase_prepare_runtime "${llbase_contract}" "" "${clang}"

tmp_err="$(mktemp)"
trap 'rm -f "${tmp_err}"' EXIT
set +e
llbase_exec_in_container \
  "${tool_root}" \
  "${tool_root}" \
  "${build_dir}" \
  "${llbase_contract}" \
  -- \
  bash -lc "cmake -S '${tool_root}' -B '${build_dir}' -DLLVM_DIR='/usr/lib/llvm-${clang}/lib/cmake/llvm' >/dev/null && cmake --build '${build_dir}' --parallel '${jobs}' >/dev/null" \
  2> "${tmp_err}"
devilang_rc=$?
set -e

node - "${result_file}" "${build_dir}" "${devilang_rc}" "${clang}" "${tmp_err}" <<'EOF'
const fs = require("fs");
const path = require("path");

const [resultFileArg, buildDirArg, rawExitCodeArg, clangArg, errPathArg] = process.argv.slice(2);
const resultFile = path.resolve(resultFileArg);
const buildDir = path.resolve(buildDirArg);
const rawExitCode = Number(rawExitCodeArg || "1");
const rawStderr = fs.readFileSync(errPathArg, "utf8");
const artifacts = [
  { path: "build-dir", location: buildDir },
  { path: "devilang-bin", location: path.join(buildDir, "bin", "devilang") },
  { path: "devilang-pass", location: path.join(buildDir, "lib", "devilang-pass.so") },
];
const payload = {
  summary: rawExitCode === 0 ? "built devilang native artifacts" : "devilang native build failed",
  details: {
    build_dir: buildDir,
    clang: String(clangArg || ""),
    llbase_contract: process.env.MORPHEUS_DEVILANG_LLBASE_CONTRACT || "",
    ...(rawStderr ? { stderr: rawStderr } : {}),
  },
  artifacts,
};
fs.writeFileSync(resultFile, JSON.stringify(payload, null, 2) + "\n", "utf8");
if (rawExitCode !== 0) {
  process.stderr.write(JSON.stringify(payload, null, 2) + "\n");
}
process.exit(rawExitCode);
EOF
