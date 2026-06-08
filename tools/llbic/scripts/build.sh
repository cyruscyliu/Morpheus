#!/usr/bin/env bash
set -euo pipefail

tool_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
legacy="${tool_root}/llbic"
runtime_helper_default="$(cd "${tool_root}/../llbase/scripts" && pwd)/runtime.sh"
result_file="${MORPHEUS_LLBIC_RESULT_FILE:-${MORPHEUS_SCRIPT_RESULT_FILE:?}}"
build_version="${MORPHEUS_LLBIC_BUILD_VERSION:?}"
sources_dir="${MORPHEUS_LLBIC_SOURCE:?}"
output_dir="${MORPHEUS_LLBIC_OUTPUT:?}"
conf_path="${MORPHEUS_LLBIC_CONF:-${sources_dir}/sources.conf}"
llbase_contract="${MORPHEUS_LLBIC_LLBASE_CONTRACT:-}"
force_irdumper="${MORPHEUS_LLBIC_FORCE_IRDUMPER:-false}"
kconfig_file="${MORPHEUS_LLBIC_KCONFIG_FILE:-}"
kconfig_inline="${MORPHEUS_LLBIC_KCONFIG:-}"
file_file="${MORPHEUS_LLBIC_FILE_FILE:-}"
file_inline="${MORPHEUS_LLBIC_FILE:-}"
rust_target_file="${MORPHEUS_LLBIC_RUST_TARGET_FILE:-}"
rust_target_inline="${MORPHEUS_LLBIC_RUST_TARGET:-}"

mkdir -p "${sources_dir}" "${output_dir}"

cmd=("${legacy}" build "${build_version}" "--output" "${output_dir}" "--json")
[ -n "${MORPHEUS_LLBIC_CLANG:-}" ] && cmd+=("--clang" "${MORPHEUS_LLBIC_CLANG}")
[ -n "${MORPHEUS_LLBIC_ARCH:-}" ] && cmd+=("--arch" "${MORPHEUS_LLBIC_ARCH}")
[ -n "${MORPHEUS_LLBIC_CROSS:-}" ] && cmd+=("--cross" "${MORPHEUS_LLBIC_CROSS}")
[ -n "${MORPHEUS_LLBIC_DEFCONFIG:-}" ] && cmd+=("--defconfig" "${MORPHEUS_LLBIC_DEFCONFIG}")
[ "${MORPHEUS_LLBIC_OUT_OF_TREE:-false}" = "true" ] && cmd+=("--out-of-tree")
[ "${MORPHEUS_LLBIC_INTREE:-false}" = "true" ] && cmd+=("--intree")
[ "${MORPHEUS_LLBIC_RUST:-false}" = "true" ] && cmd+=("--rust")
[ "${MORPHEUS_LLBIC_VERBOSE:-false}" = "true" ] && cmd+=("--verbose")

if [ -n "${kconfig_inline}" ]; then
  while IFS= read -r item; do
    [ -n "${item}" ] || continue
    cmd+=("--kconfig" "${item}")
  done <<< "${kconfig_inline}"
elif [ -n "${kconfig_file}" ] && [ -s "${kconfig_file}" ]; then
  while IFS= read -r item; do
    [ -n "${item}" ] || continue
    cmd+=("--kconfig" "${item}")
  done < "${kconfig_file}"
fi

if [ -n "${file_inline}" ]; then
  while IFS= read -r item; do
    [ -n "${item}" ] || continue
    cmd+=("--file" "${item}")
  done <<< "${file_inline}"
elif [ -n "${file_file}" ] && [ -s "${file_file}" ]; then
  while IFS= read -r item; do
    [ -n "${item}" ] || continue
    cmd+=("--file" "${item}")
  done < "${file_file}"
fi

if [ -n "${rust_target_inline}" ]; then
  while IFS= read -r item; do
    [ -n "${item}" ] || continue
    cmd+=("--rust-target" "${item}")
  done <<< "${rust_target_inline}"
elif [ -n "${rust_target_file}" ] && [ -s "${rust_target_file}" ]; then
  while IFS= read -r item; do
    [ -n "${item}" ] || continue
    cmd+=("--rust-target" "${item}")
  done < "${rust_target_file}"
fi

tmp_json="$(mktemp)"
trap 'rm -f "${tmp_json}"' EXIT

[ -n "${llbase_contract}" ] || {
  echo "llbic build requires --llbase-contract so the managed run uses the shared llbase container runtime" >&2
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
llbase_prepare_runtime "${llbase_contract}" "${build_version}" "${MORPHEUS_LLBIC_CLANG:-}"

if [ "${force_irdumper}" = "true" ]; then
  force_irdumper_env="LLBIC_FORCE_IRDUMPER=1"
else
  force_irdumper_env=""
fi

set +e
container_cmd=(
  env
  "LLBIC_SOURCES=${sources_dir}"
  "LLBIC_OUTPUT=$(dirname "${output_dir}")"
  "LLBIC_CONF=${conf_path}"
  "LLBIC_IRDUMPER_ROOT=${LLBASE_IRDUMPER_CONTAINER_ROOT:-/opt/IRDumper}"
)
[ -n "${force_irdumper_env}" ] && container_cmd+=("${force_irdumper_env}")
container_cmd+=("${cmd[@]}")
llbase_exec_in_container \
  "${tool_root}" \
  "${tool_root}" \
  "${sources_dir}" \
  "${output_dir}" \
  "${conf_path}" \
  "${llbase_contract}" \
  "${kconfig_file}" \
  "${file_file}" \
  "${rust_target_file}" \
  -- \
  "${container_cmd[@]}" \
  > "${tmp_json}"
llbic_rc=$?
set -e

node - "${output_dir}" "${sources_dir}" "${result_file}" "${llbic_rc}" "${tmp_json}" <<'EOF'
const fs = require("fs");
const path = require("path");
const cp = require("child_process");

const outputDir = path.resolve(process.argv[2]);
const sourcesDir = path.resolve(process.argv[3]);
const resultFile = path.resolve(process.argv[4]);
const legacyExitCode = Number(process.argv[5] || "1");
const legacyOutputPath = path.resolve(process.argv[6]);
const manifestPath = path.join(outputDir, "llbic.json");
const payload = fs.existsSync(manifestPath)
  ? JSON.parse(fs.readFileSync(manifestPath, "utf8"))
  : {};
const bitcodeListPath = path.join(outputDir, "bitcode_files.txt");
const fallbackKernelSourceDir = path.join(
  sourcesDir,
  `linux-${process.env.MORPHEUS_LLBIC_BUILD_VERSION || ""}`,
);
const kernelSourceDir = typeof payload.source_dir === "string" && payload.source_dir
  ? payload.source_dir
  : fs.existsSync(fallbackKernelSourceDir)
    ? fallbackKernelSourceDir
  : "";

function isLlvmBitcode(candidate) {
  try {
    const out = cp.execFileSync("file", [candidate], { encoding: "utf8" });
    return out.includes("LLVM IR bitcode");
  } catch {
    return false;
  }
}

function collectBitcode(rootDir) {
  const results = [];
  const stack = [rootDir];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || !fs.existsSync(current)) {
      continue;
    }
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const nextPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(nextPath);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith(".bc")) {
        continue;
      }
      if (isLlvmBitcode(nextPath)) {
        results.push(nextPath);
      }
    }
  }
  results.sort((left, right) => left.localeCompare(right));
  return results;
}

let bitcodeFiles = [];
if (fs.existsSync(bitcodeListPath)) {
  bitcodeFiles = fs.readFileSync(bitcodeListPath, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((entry) => path.isAbsolute(entry)
      ? entry
      : path.join(kernelSourceDir || outputDir, entry));
}
bitcodeFiles = bitcodeFiles.filter((candidate) => fs.existsSync(candidate));
if (bitcodeFiles.length === 0 && kernelSourceDir) {
  bitcodeFiles = collectBitcode(kernelSourceDir);
}
if (bitcodeFiles.length === 0) {
  bitcodeFiles = collectBitcode(outputDir);
}
if (bitcodeFiles.length > 0) {
  const relative = bitcodeFiles.map((candidate) => {
    if (kernelSourceDir && candidate.startsWith(`${kernelSourceDir}${path.sep}`)) {
      return path.relative(kernelSourceDir, candidate);
    }
    if (candidate.startsWith(`${outputDir}${path.sep}`)) {
      return path.relative(outputDir, candidate);
    }
    return candidate;
  });
  fs.writeFileSync(bitcodeListPath, `${relative.join("\n")}\n`, "utf8");
}

const recovered = legacyExitCode !== 0 && bitcodeFiles.length > 0;
const details = {
  source: kernelSourceDir || payload.source_dir || "",
  output: outputDir,
  kernel_version: payload.kernel_version || "",
  arch: payload.arch || "",
  bitcode_count: bitcodeFiles.length,
  llbase_contract: process.env.MORPHEUS_LLBIC_LLBASE_CONTRACT || "",
};
if (recovered) {
  details.recovered_from_legacy_failure = true;
}
const artifacts = [
  ["source-dir", kernelSourceDir || payload.source_dir || ""],
  ["output-dir", outputDir],
  ["llbic-json", manifestPath],
  ["bitcode-files", bitcodeListPath],
  ["llbic-log", path.join(outputDir, "llbic.log")],
  ["kernel-build-log", path.join(outputDir, "kernel-build.log")],
].filter(([, location]) => location && fs.existsSync(location))
  .map(([artifactPath, location]) => ({ path: artifactPath, location }));
if (bitcodeFiles.length > 0) {
  const kconfigFragments = Array.isArray(payload.kconfig_fragments)
    ? payload.kconfig_fragments.filter((fragment) =>
        typeof fragment === "string" &&
        fragment &&
        fs.existsSync(fragment))
    : [];
  const updatedPayload = {
    ...payload,
    status: "success",
    exit_code: 0,
    source_dir: kernelSourceDir || payload.source_dir || "",
    output_dir: outputDir,
    kernel_version: payload.kernel_version || process.env.MORPHEUS_LLBIC_BUILD_VERSION || "",
    strategy: process.env.MORPHEUS_LLBIC_FORCE_IRDUMPER === "true"
      ? "irdumper"
      : (payload.strategy || ""),
    bitcode_count: bitcodeFiles.length,
    bitcode_list_file: bitcodeListPath,
    kconfig_fragments: kconfigFragments,
    kconfig_fragments_count: kconfigFragments.length,
  };
  if (recovered) {
    updatedPayload.recovered_from_legacy_failure = true;
  }
  fs.writeFileSync(manifestPath, JSON.stringify(updatedPayload, null, 2) + "\n", "utf8");
}
fs.writeFileSync(
  resultFile,
  JSON.stringify({ details, artifacts }, null, 2) + "\n",
  "utf8",
);
if (bitcodeFiles.length === 0 && legacyExitCode !== 0 && fs.existsSync(legacyOutputPath)) {
  const legacyOutput = fs.readFileSync(legacyOutputPath, "utf8").trim();
  if (legacyOutput) {
    process.stderr.write(`${legacyOutput}\n`);
  }
}
process.exit(bitcodeFiles.length > 0 ? 0 : legacyExitCode || 1);
EOF
