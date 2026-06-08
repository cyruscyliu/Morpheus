#!/usr/bin/env bash
set -euo pipefail

tool_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
runtime_helper_default="$(cd "${tool_root}/../llbase/scripts" && pwd)/runtime.sh"
result_file="${MORPHEUS_LLCG_RESULT_FILE:-${MORPHEUS_SCRIPT_RESULT_FILE:?}}"
build_dir="${MORPHEUS_LLCG_BUILD_DIR:-${tool_root}/build}"
clang="${MORPHEUS_LLCG_CLANG:-15}"
llbase_contract="${MORPHEUS_LLCG_LLBASE_CONTRACT:-}"

mkdir -p "${build_dir}"
[ -n "${llbase_contract}" ] || {
  echo "llcg build requires --llbase-contract so the managed run uses the shared llbase container runtime" >&2
  exit 1
}

cache_file="${build_dir}/CMakeCache.txt"
if [ -f "${cache_file}" ] && ! grep -q "^CMAKE_HOME_DIRECTORY:INTERNAL=${tool_root}$" "${cache_file}"; then
  rm -rf "${build_dir}"
  mkdir -p "${build_dir}"
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
  bash -lc "cmake -S '${tool_root}' -B '${build_dir}' -DCLANG_VERSION='${clang}' -DLLVM_DIR='/usr/lib/llvm-${clang}/lib/cmake/llvm' >/dev/null && cmake --build '${build_dir}' --parallel --target build >/dev/null" \
  2> "${tmp_err}"
llcg_rc=$?
set -e

node - "${result_file}" "${build_dir}" "${llcg_rc}" "${clang}" "${tmp_err}" <<'EOF'
const fs = require("fs");
const path = require("path");

const [resultFileArg, buildDirArg, rawExitCodeArg, clangArg, errPathArg] = process.argv.slice(2);
const resultFile = path.resolve(resultFileArg);
const buildDir = path.resolve(buildDirArg);
const rawExitCode = Number(rawExitCodeArg || "1");
const rawStderr = fs.readFileSync(errPathArg, "utf8");
const artifacts = [
  { path: "build-dir", location: buildDir },
  { path: "kallgraph-bin", location: path.join(buildDir, "kallgraph", "bin", "KallGraph") },
  { path: "callgraph-pass", location: path.join(buildDir, "llvm-cg", "libDevilang.so") },
];
const payload = {
  summary: rawExitCode === 0 ? "built llcg native artifacts" : "llcg native build failed",
  details: {
    build_dir: buildDir,
    clang: String(clangArg || ""),
    llbase_contract: process.env.MORPHEUS_LLCG_LLBASE_CONTRACT || "",
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
