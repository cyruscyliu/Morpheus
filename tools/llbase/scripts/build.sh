#!/usr/bin/env bash
set -euo pipefail

source_dir="${MORPHEUS_LLBASE_SOURCE:?}"
output_dir="${MORPHEUS_LLBASE_OUTPUT:?}"
family="${MORPHEUS_LLBASE_FAMILY:-all}"
clang_version="${MORPHEUS_LLBASE_CLANG_VERSION:-18}"
image_tag="${MORPHEUS_LLBASE_IMAGE_TAG:-}"
prepare_irdumper="${MORPHEUS_LLBASE_PREPARE_IRDUMPER:-false}"
build_image="${MORPHEUS_LLBASE_BUILD_IMAGE:-false}"
pull_image="${MORPHEUS_LLBASE_PULL_IMAGE:-true}"
result_file="${MORPHEUS_LLBASE_RESULT_FILE:-${MORPHEUS_SCRIPT_RESULT_FILE:?}}"
contract_path="${output_dir}/runtime-contract.json"
irdumper_root="${output_dir}/irdumper"

mkdir -p "${output_dir}"

if [ ! -d "${source_dir}/docker" ]; then
  echo "missing llbase source directory: ${source_dir}" >&2
  exit 1
fi

docker_runner=(docker)
if ! docker info >/dev/null 2>&1 && sudo docker info >/dev/null 2>&1; then
  docker_runner=(sudo docker)
fi

selected_families=()
case "${family}" in
  all) selected_families=(latest mid legacy) ;;
  latest|mid|legacy) selected_families=("${family}") ;;
  *)
    echo "llbase build requires family=all|latest|mid|legacy (got ${family})" >&2
    exit 1
    ;;
esac
if [ -n "${image_tag}" ] && [ "${#selected_families[@]}" -ne 1 ]; then
  echo "llbase image-tag requires a single family selection" >&2
  exit 1
fi

if [ "${build_image}" = "true" ]; then
  for selected_family in "${selected_families[@]}"; do
    dockerfile="docker/Dockerfile"
    resolved_tag="${image_tag:-ghcr.io/cyruscyliu/llbase:${selected_family}}"
    case "${selected_family}" in
      latest) dockerfile="docker/Dockerfile" ;;
      mid) dockerfile="docker/Dockerfile.mid" ;;
      legacy) dockerfile="docker/Dockerfile.legacy" ;;
    esac
    echo "[llbase] docker build family=${selected_family} tag=${resolved_tag}" >&2
    "${docker_runner[@]}" build -f "${source_dir}/${dockerfile}" -t "${resolved_tag}" "${source_dir}"
  done
elif [ "${pull_image}" = "true" ]; then
  if docker info >/dev/null 2>&1 || sudo docker info >/dev/null 2>&1; then
    for selected_family in "${selected_families[@]}"; do
      resolved_tag="${image_tag:-ghcr.io/cyruscyliu/llbase:${selected_family}}"
      echo "[llbase] docker pull family=${selected_family} tag=${resolved_tag}" >&2
      "${docker_runner[@]}" pull "${resolved_tag}"
    done
  else
    echo "[llbase] skipping image pull because no usable docker daemon is available" >&2
  fi
fi

if [ "${prepare_irdumper}" = "true" ]; then
  export PATH="/usr/lib/llvm-${clang_version}/bin:${PATH}"
  make -C "${source_dir}/IRDumper" clean dumper LLVM_BUILD="/usr/lib/llvm-${clang_version}"
  mkdir -p "${irdumper_root}/${clang_version}"
  cp "${source_dir}/IRDumper/build/lib/libDumper.so" "${irdumper_root}/${clang_version}/libDumper.so"
fi

node - "${source_dir}" "${contract_path}" "${family}" "${clang_version}" "${image_tag}" "${build_image}" "${pull_image}" "${prepare_irdumper}" "${irdumper_root}" "${result_file}" <<'EOF'
const fs = require("fs");
const path = require("path");

const [sourceDirArg, contractPathArg, familyArg, clangVersionArg, imageTagArg, buildImageArg, pullImageArg, prepareIrdumperArg, irdumperRootArg, resultFileArg] = process.argv.slice(2);
const sourceDir = path.resolve(sourceDirArg);
const contractPath = path.resolve(contractPathArg);
const resultFile = path.resolve(resultFileArg);
const family = String(familyArg || "all");
const clangVersion = String(clangVersionArg || "18");
const buildImage = String(buildImageArg || "false") === "true";
const pullImage = String(pullImageArg || "true") === "true";
const prepareIrdumper = String(prepareIrdumperArg || "false") === "true";
const irdumperRoot = path.resolve(irdumperRootArg);
const images = {
  latest: {
    image: imageTagArg || "ghcr.io/cyruscyliu/llbase:latest",
    dockerfile: path.join(sourceDir, "docker", "Dockerfile"),
    clang_versions: [14, 15, 16, 18],
  },
  mid: {
    image: imageTagArg || "ghcr.io/cyruscyliu/llbase:mid",
    dockerfile: path.join(sourceDir, "docker", "Dockerfile.mid"),
    clang_versions: [8, 9, 10, 11, 12],
  },
  legacy: {
    image: imageTagArg || "ghcr.io/cyruscyliu/llbase:legacy",
    dockerfile: path.join(sourceDir, "docker", "Dockerfile.legacy"),
    clang_versions: ["6.0", 7, 8],
  },
};
const contract = {
  schemaVersion: 1,
  kind: "llbase-runtime-contract",
  provider: "llbase",
  sourceDir,
  helperScripts: {
    installRustEnv: path.join(sourceDir, "scripts", "install_rust_env.sh"),
    rustcWrapper: path.join(sourceDir, "scripts", "rustc-llbic-wrapper.sh"),
    runtime: path.join(sourceDir, "scripts", "runtime.sh"),
  },
  irdumper: {
    sourceDir: path.join(sourceDir, "IRDumper"),
    installRoot: "/opt/IRDumper",
    localBuildRoot: prepareIrdumper ? irdumperRoot : "",
    clangVersion,
  },
  docker: {
    runtimeHelper: path.join(sourceDir, "scripts", "runtime.sh"),
    families: family === "all" ? images : { [family]: images[family] },
  },
  defaults: {
    kernelEraToFamily: {
      "6": "latest",
      "7": "latest",
      "4": "mid",
      "5": "mid",
      "3": "legacy",
      "2.6": "legacy",
    },
  },
  build: {
    family,
    buildImage,
    pullImage,
    prepareIrdumper,
    clangVersion,
    imageTag: imageTagArg || "",
  },
};
fs.mkdirSync(path.dirname(contractPath), { recursive: true });
fs.writeFileSync(contractPath, JSON.stringify(contract, null, 2) + "\n", "utf8");
fs.writeFileSync(resultFile, JSON.stringify({
  details: {
    source: sourceDir,
    output: path.dirname(contractPath),
    family,
    build_image: buildImage,
    pull_image: pullImage,
    prepare_irdumper: prepareIrdumper,
    clang_version: clangVersion,
    runtime_contract: contractPath,
  },
  artifacts: [
    { path: "source-dir", location: sourceDir },
    { path: "output-dir", location: path.dirname(contractPath) },
    { path: "runtime-contract", location: contractPath },
  ],
}, null, 2) + "\n", "utf8");
EOF
