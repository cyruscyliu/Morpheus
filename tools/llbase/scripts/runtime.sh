#!/usr/bin/env bash

llbase_is_gvisor() {
  grep -qi 'gvisor' /proc/sys/kernel/osrelease 2>/dev/null || \
    grep -qi 'gvisor' /proc/version 2>/dev/null
}

llbase_prepare_runtime() {
  local contract_path="$1"
  local kernel_version="${2:-}"
  local requested_clang="${3:-}"

  [ -f "${contract_path}" ] || {
    echo "missing llbase runtime contract: ${contract_path}" >&2
    return 1
  }

  eval "$(
    node - "${contract_path}" "${kernel_version}" "${requested_clang}" <<'EOF'
const fs = require("fs");

const [contractPath, kernelVersionArg, requestedClangArg] = process.argv.slice(2);
const contract = JSON.parse(fs.readFileSync(contractPath, "utf8"));
const dockerFamilies = contract.docker && contract.docker.families
  ? contract.docker.families
  : {};
const defaults = contract.defaults && contract.defaults.kernelEraToFamily
  ? contract.defaults.kernelEraToFamily
  : {};
const requestedClang = String(requestedClangArg || "");
const kernelVersion = String(kernelVersionArg || "");

function shell(name, value) {
  return `export ${name}=${JSON.stringify(String(value ?? ""))}`;
}

function familyFromKernel(version) {
  const match = /^([0-9]+)(?:\.([0-9]+))?/.exec(version);
  if (!match) {
    return "";
  }
  const major = match[1];
  const minor = match[2] ? `${major}.${match[2]}` : "";
  return defaults[minor] || defaults[major] || "";
}

function familySupportsClang(familyName, clang) {
  if (!familyName || !clang) {
    return false;
  }
  const family = dockerFamilies[familyName];
  if (!family || !Array.isArray(family.clang_versions)) {
    return false;
  }
  return family.clang_versions.map(String).includes(String(clang));
}

let familyName = familyFromKernel(kernelVersion);
if (!familyName || !dockerFamilies[familyName]) {
  familyName = "";
}
if (requestedClang && familyName && !familySupportsClang(familyName, requestedClang)) {
  familyName = "";
}
if (!familyName && requestedClang) {
  for (const candidate of Object.keys(dockerFamilies)) {
    if (familySupportsClang(candidate, requestedClang)) {
      familyName = candidate;
      break;
    }
  }
}
if (!familyName) {
  familyName = Object.keys(dockerFamilies)[0] || "";
}

const family = familyName ? dockerFamilies[familyName] : {};
const lines = [
  shell("LLBASE_RUNTIME_FAMILY", familyName),
  shell("LLBASE_RUNTIME_IMAGE", family.image || ""),
  shell("LLBASE_RUNTIME_REQUESTED_CLANG", requestedClang || contract.build?.clangVersion || ""),
  shell("LLBASE_IRDUMPER_HOST_ROOT", contract.irdumper?.localBuildRoot || contract.irdumper?.installRoot || ""),
  shell("LLBASE_IRDUMPER_CONTAINER_ROOT", contract.irdumper?.installRoot || ""),
  shell("LLBASE_HELPER_INSTALL_RUST_ENV", contract.helperScripts?.installRustEnv || ""),
  shell("LLBASE_HELPER_RUSTC_WRAPPER", contract.helperScripts?.rustcWrapper || ""),
  shell("LLBASE_HELPER_RUNTIME", contract.helperScripts?.runtime || ""),
];

for (const [key, value] of Object.entries(dockerFamilies)) {
  if (!value || !value.image) {
    continue;
  }
  lines.push(shell(`LLBIC_RUNTIME_IMAGE_${key.toUpperCase()}`, value.image));
}
process.stdout.write(lines.join("\n"));
EOF
  )"

  [ -n "${LLBASE_RUNTIME_IMAGE:-}" ] || {
    echo "llbase runtime contract does not define a docker image" >&2
    return 1
  }
}

llbase_mount_path() {
  local candidate="${1:-}"
  local mount_root=""

  [ -n "${candidate}" ] || return 0
  if [ -d "${candidate}" ]; then
    mount_root="$(realpath "${candidate}")"
  elif [ -e "${candidate}" ]; then
    mount_root="$(realpath "$(dirname "${candidate}")")"
  else
    mount_root="$(realpath -m "$(dirname "${candidate}")")"
  fi
  printf '%s\n' "${mount_root}"
}

llbase_docker_runner() {
  if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
    printf '%s\n' docker
    return 0
  fi
  if command -v docker >/dev/null 2>&1 && sudo docker info >/dev/null 2>&1; then
    printf '%s\n' "sudo docker"
    return 0
  fi
  printf '%s\n' docker
}

llbase_udocker_bin() {
  local candidate=""

  for candidate in \
    "${LLBASE_UDOCKER_BIN:-}" \
    /usr/local/bin/udocker-llbase \
    /usr/local/lib/llbase-udocker-venv/bin/udocker \
    /tmp/udocker-venv/bin/udocker \
    "$(command -v udocker 2>/dev/null || true)"; do
    [ -n "${candidate}" ] || continue
    [ -x "${candidate}" ] || continue
    printf '%s\n' "${candidate}"
    return 0
  done

  return 1
}

llbase_udocker_home() {
  printf '%s\n' "${LLBASE_UDOCKER_HOME:-/var/tmp/llbase-udocker-home}"
}

llbase_udocker_init() {
  local udocker_bin=""
  local udocker_home=""

  udocker_bin="$(llbase_udocker_bin)" || {
    echo "llbase udocker backend requested but no udocker binary is available" >&2
    return 1
  }
  udocker_home="$(llbase_udocker_home)"
  mkdir -p "${udocker_home}"

  if [ ! -d "${udocker_home}/.udocker" ]; then
    HOME="${udocker_home}" "${udocker_bin}" --allow-root install >/dev/null
  fi
}

llbase_udocker_image_name() {
  local image="$1"
  local image_hash=""

  image_hash="$(printf '%s' "${image}" | sha256sum | cut -c1-16)"
  printf 'llbase-%s\n' "${image_hash}"
}

llbase_udocker_pull_image() {
  local image="$1"
  local udocker_bin=""
  local udocker_home=""

  llbase_udocker_init
  udocker_bin="$(llbase_udocker_bin)"
  udocker_home="$(llbase_udocker_home)"
  echo "[llbase] udocker pull image=${image}" >&2
  HOME="${udocker_home}" "${udocker_bin}" --allow-root pull "${image}"
}

llbase_exec_in_udocker() {
  local workdir="$1"
  local image="$2"
  shift 2

  local -a mount_inputs=()
  while [ "$#" -gt 0 ] && [ "$1" != "--" ]; do
    mount_inputs+=("$1")
    shift
  done
  [ "$#" -gt 0 ] || {
    echo "llbase_exec_in_udocker requires -- before the command" >&2
    return 1
  }
  shift

  llbase_udocker_init

  local udocker_bin=""
  local udocker_home=""
  local container_name=""
  local mount_root=""
  local -A seen=()
  local -a udocker_cmd=()

  udocker_bin="$(llbase_udocker_bin)"
  udocker_home="$(llbase_udocker_home)"
  container_name="$(llbase_udocker_image_name "${image}")"

  if ! HOME="${udocker_home}" "${udocker_bin}" --allow-root inspect "${container_name}" >/dev/null 2>&1; then
    HOME="${udocker_home}" "${udocker_bin}" --allow-root create --name="${container_name}" "${image}" >/dev/null
  fi
  HOME="${udocker_home}" "${udocker_bin}" --allow-root setup --execmode=P1 "${container_name}" >/dev/null 2>&1 || true

  udocker_cmd=(
    env "HOME=${udocker_home}"
    "${udocker_bin}" --allow-root run
    --workdir="${workdir}"
    --nobanner
  )

  for candidate in "${mount_inputs[@]}"; do
    mount_root="$(llbase_mount_path "${candidate}")"
    [ -n "${mount_root}" ] || continue
    if [ -n "${seen[${mount_root}]:-}" ]; then
      continue
    fi
    seen["${mount_root}"]=1
    mkdir -p "${mount_root}"
    udocker_cmd+=("--volume=${mount_root}:${mount_root}")
  done

  udocker_cmd+=("${container_name}")
  udocker_cmd+=("$@")
  "${udocker_cmd[@]}"
}

llbase_exec_in_container() {
  local workdir="$1"
  shift

  local image="${LLBASE_RUNTIME_IMAGE:?}"
  if llbase_is_gvisor; then
    llbase_exec_in_udocker "${workdir}" "${image}" "$@"
    return $?
  fi
  local runner_text
  runner_text="$(llbase_docker_runner)"
  local -a runner=()
  case "${runner_text}" in
    "sudo docker") runner=(sudo docker) ;;
    *) runner=(docker) ;;
  esac
  local -a mount_inputs=()
  while [ "$#" -gt 0 ] && [ "$1" != "--" ]; do
    mount_inputs+=("$1")
    shift
  done
  [ "$#" -gt 0 ] || {
    echo "llbase_exec_in_container requires -- before the command" >&2
    return 1
  }
  shift

  local -A seen=()
  local mount_root=""
  local -a docker_cmd=(
    "${runner[@]}" run --rm
    -u "$(id -u):$(id -g)"
    -e "HOME=${HOME:-/tmp}"
    -e "USER=${USER:-$(id -un)}"
  )

  for candidate in "${mount_inputs[@]}"; do
    mount_root="$(llbase_mount_path "${candidate}")"
    [ -n "${mount_root}" ] || continue
    if [ -n "${seen[${mount_root}]:-}" ]; then
      continue
    fi
    seen["${mount_root}"]=1
    mkdir -p "${mount_root}"
    docker_cmd+=(-v "${mount_root}:${mount_root}")
  done

  docker_cmd+=(-w "${workdir}" "${image}")
  docker_cmd+=("$@")
  "${docker_cmd[@]}"
}
