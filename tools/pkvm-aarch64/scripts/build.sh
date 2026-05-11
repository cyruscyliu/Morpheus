#!/usr/bin/env bash
set -euo pipefail

source_dir="${MORPHEUS_PKVM_AARCH64_SOURCE:?}"
build_dir="${MORPHEUS_PKVM_AARCH64_BUILD_DIR:?}"
build_target="${MORPHEUS_PKVM_AARCH64_BUILD_TARGET:-all}"
platform="${MORPHEUS_PKVM_AARCH64_PLATFORM:-virt}"
qemu="${MORPHEUS_PKVM_AARCH64_QEMU:-}"
make_arg_file="${MORPHEUS_PKVM_AARCH64_MAKE_ARG_FILE:-}"
result_file="${MORPHEUS_PKVM_AARCH64_RESULT_FILE:-${MORPHEUS_SCRIPT_RESULT_FILE:?}}"
seed_dir="${MORPHEUS_PKVM_AARCH64_SEED_DIR:-}"
build_version="${MORPHEUS_PKVM_AARCH64_BUILD_VERSION:-}"
git_url="${MORPHEUS_PKVM_AARCH64_GIT_URL:-https://github.com/vrosendahl/pkvm-aarch64.git}"
reuse_build_dir="${MORPHEUS_PKVM_AARCH64_REUSE_BUILD_DIR:-false}"

export PATH="${PATH}:/usr/sbin:/usr/bin:/sbin:/bin"

if [ ! -f "${source_dir}/Makefile" ]; then
  if [ -n "${seed_dir}" ] || [ -n "${git_url}" ] || [ -n "${build_version}" ]; then
    "$(dirname "$0")/fetch.sh"
  fi
fi

if [ ! -f "${source_dir}/Makefile" ]; then
  echo "missing pKVM source tree: ${source_dir}" >&2
  exit 1
fi

for bin in make git python3 aarch64-linux-gnu-gcc qemu-aarch64-static mkfs.ext4 parted qemu-img; do
  if ! command -v "${bin}" >/dev/null 2>&1; then
    echo "missing host dependency: ${bin}; run tools/pkvm-aarch64/scripts/install-dependencies.sh" >&2
    exit 1
  fi
done

if ! python3 - <<'PY'
import importlib
import sys

try:
    importlib.import_module("mako")
except Exception:
    print("missing python dependency: mako", file=sys.stderr)
    raise SystemExit(1)
PY
then
  echo "run tools/pkvm-aarch64/scripts/install-dependencies.sh" >&2
  exit 1
fi

mkdir -p "${build_dir}"

if [ -n "${qemu}" ]; then
  export PATH="$(dirname "${qemu}"):${PATH}"
  export QEMU_HOST="${qemu}"
fi

make_args=()
if [ -n "${make_arg_file}" ] && [ -s "${make_arg_file}" ]; then
  mapfile -t make_args < "${make_arg_file}"
else
  make_args=(-j4)
fi

pkvm_jobs=4
for index in "${!make_args[@]}"; do
  arg="${make_args[$index]}"
  case "${arg}" in
    -j[0-9]*)
      pkvm_jobs="${arg#-j}"
      ;;
    -j)
      next_index=$((index + 1))
      if [ "${next_index}" -lt "${#make_args[@]}" ] && [[ "${make_args[$next_index]}" =~ ^[0-9]+$ ]]; then
        pkvm_jobs="${make_args[$next_index]}"
      fi
      ;;
  esac
done

manifest_file="${build_dir}/manifest.json"
artifact_parent="${source_dir}"
work_dir="${PWD}"

check_target_up_to_date() {
  local target="$1"
  local rc=0
  set +e
  make -C "${source_dir}" "PLATFORM=${platform}" -q "${target}" >/dev/null 2>&1
  rc="$?"
  return "${rc}"
}

reuse_ready=false
if [ "${reuse_build_dir}" = "true" ] && [ -f "${manifest_file}" ]; then
  reuse_targets=()
  if [ "${build_target}" = "all" ]; then
    reuse_targets=(tools qemu-user host-kernel ubuntu-template hostimage guest-kernel guestimage)
  else
    reuse_targets=(tools "${build_target}")
  fi
  reuse_ready=true
  for target in "${reuse_targets[@]}"; do
    set +e
    check_target_up_to_date "${target}"
    rc="$?"
    set -e
    if [ "${rc}" = "0" ]; then
      continue
    fi
    if [ "${rc}" = "1" ]; then
      reuse_ready=false
      break
    fi
    exit "${rc}"
  done
  if [ "${reuse_ready}" = "true" ]; then
    artifacts_json="$(
      node - "${artifact_parent}" "${build_dir}" <<'NODE'
const fs = require("fs");
const path = require("path");
const source = process.argv[2];
const buildDir = process.argv[3];
const candidates = [
  ["source-dir", source],
  ["build-dir", buildDir],
  ["host-image", path.join(source, "images", "host", "ubuntuhost.qcow2")],
  ["guest-image", path.join(source, "images", "guest", "ubuntuguest.qcow2")],
  ["host-kernel", path.join(source, "linux-host", "arch", "arm64", "boot", "Image")],
  ["guest-kernel", path.join(source, "linux", "arch", "arm64", "boot", "Image")],
];
const artifacts = candidates
  .filter(([, location]) => location && fs.existsSync(location))
  .map(([pathName, location]) => ({ path: pathName, location }));
process.stdout.write(JSON.stringify(artifacts));
NODE
)"
    cat > "${result_file}" <<EOF
{"details":{"built":true,"source":"${source_dir}","build_dir":"${build_dir}","build_target":"${build_target}","platform":"${platform}","manifest":"${manifest_file}","reused":true},"artifacts":${artifacts_json}}
EOF
    exit 0
  fi
fi

cd "${source_dir}"

# The upstream bootstrap initializes every declared submodule, including the
# optional private pkvm-debug-tools repo. Point it at a local empty git repo so
# submodule init succeeds without external credentials.
dummy_repo="${build_dir}/pkvm-debug-tools-dummy-repo"
if [ -f "${source_dir}/.gitmodules" ] && git config -f "${source_dir}/.gitmodules" --get submodule.pkvm-debug-tools.path >/dev/null 2>&1; then
  if [ ! -d "${dummy_repo}" ]; then
    git init --bare "${dummy_repo}" >/dev/null 2>&1
  fi
  git config submodule.pkvm-debug-tools.url "${dummy_repo}"
fi

# Keep the managed bootstrap lighter and more reproducible by preferring
# shallow submodule fetches for the large upstream trees.
for submodule in crosvm linux linux-host qemu oss/binutils-gdb oss/gcc oss/glibc oss/qemu pkvm-debug-tools; do
  git config "submodule.${submodule}.shallow" true || true
done
git config submodule.fetchJobs 4 || true

run_target() {
  local target="$1"
  local rc=0
  make "PLATFORM=${platform}" "NJOBS=${pkvm_jobs}" "${make_args[@]}" "${target}" || rc="$?"
  return "${rc}"
}

prepare_sources() {
  local rc=0
  git submodule sync --recursive || rc="$?"
  if [ "${rc}" != "0" ]; then
    return "${rc}"
  fi

  git submodule update --init --depth 1 \
    crosvm \
    linux \
    linux-host \
    qemu \
    oss/binutils-gdb \
    oss/gcc \
    oss/glibc \
    oss/qemu || rc="$?"
  if [ "${rc}" != "0" ]; then
    return "${rc}"
  fi

  if [ -d "${source_dir}/crosvm/.git" ] || [ -f "${source_dir}/crosvm/.git" ]; then
    git -C crosvm submodule sync --recursive || rc="$?"
    if [ "${rc}" != "0" ]; then
      return "${rc}"
    fi
    git -C crosvm submodule update --init --depth 1 || rc="$?"
  fi
  return "${rc}"
}

exit_code=0
prepare_sources || exit_code="$?"
if [ "${exit_code}" != "0" ]; then
  cd "${work_dir}"
  exit "${exit_code}"
fi

if [ "${build_target}" = "all" ]; then
  ordered_targets=(
    tools
    qemu-user
    host-kernel
    ubuntu-template
    hostimage
    guest-kernel
    guestimage
  )
  for target in "${ordered_targets[@]}"; do
    run_target "${target}" || exit_code="$?"
    if [ "${exit_code}" != "0" ]; then
      break
    fi
  done
else
  run_target tools || exit_code="$?"
  if [ "${exit_code}" = "0" ]; then
    run_target "${build_target}" || exit_code="$?"
  fi
fi
cd "${work_dir}"

if [ "${exit_code}" != "0" ]; then
  exit "${exit_code}"
fi

artifacts_json="$(
  node - "${artifact_parent}" "${build_dir}" <<'NODE'
const fs = require("fs");
const path = require("path");
const source = process.argv[2];
const buildDir = process.argv[3];
const candidates = [
  ["source-dir", source],
  ["build-dir", buildDir],
  ["host-image", path.join(source, "images", "host", "ubuntuhost.qcow2")],
  ["guest-image", path.join(source, "images", "guest", "ubuntuguest.qcow2")],
  ["host-kernel", path.join(source, "linux-host", "arch", "arm64", "boot", "Image")],
  ["guest-kernel", path.join(source, "linux", "arch", "arm64", "boot", "Image")],
];
const artifacts = candidates
  .filter(([, location]) => location && fs.existsSync(location))
  .map(([pathName, location]) => ({ path: pathName, location }));
process.stdout.write(JSON.stringify(artifacts));
NODE
)"

cat > "${manifest_file}" <<EOF
{"schemaVersion":1,"tool":"pkvm-aarch64","command":"build","status":"success","source":"${source_dir}","build_dir":"${build_dir}","build_target":"${build_target}","platform":"${platform}"}
EOF

cat > "${result_file}" <<EOF
{"details":{"built":true,"source":"${source_dir}","build_dir":"${build_dir}","build_target":"${build_target}","platform":"${platform}","manifest":"${manifest_file}","reused":false},"artifacts":${artifacts_json}}
EOF
