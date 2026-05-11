#!/usr/bin/env bash
set -euo pipefail

source_dir="${MORPHEUS_MICROKIT_SDK_PATH:-${MORPHEUS_MICROKIT_SDK_SOURCE:?}}"
sel4_dir="${MORPHEUS_MICROKIT_SDK_SEL4:-}"
boards="${MORPHEUS_MICROKIT_SDK_BOARDS:-qemu_virt_aarch64}"
configs="${MORPHEUS_MICROKIT_SDK_CONFIGS:-debug}"
tool_target_triple="${MORPHEUS_MICROKIT_SDK_TOOL_TARGET_TRIPLE:-}"
toolchain_dir="${MORPHEUS_MICROKIT_SDK_TOOLCHAIN_DIR:?}"
toolchain_version="${MORPHEUS_MICROKIT_SDK_TOOLCHAIN_VERSION:-12.3.rel1}"
toolchain_archive_url="${MORPHEUS_MICROKIT_SDK_TOOLCHAIN_ARCHIVE_URL:-}"
toolchain_prefix="${MORPHEUS_MICROKIT_SDK_TOOLCHAIN_PREFIX_AARCH64:-aarch64-none-elf}"
result_file="${MORPHEUS_MICROKIT_SDK_RESULT_FILE:-${MORPHEUS_SCRIPT_RESULT_FILE:?}}"
seed_dir="${MORPHEUS_MICROKIT_SDK_SEED_DIR:-}"
archive_url="${MORPHEUS_MICROKIT_SDK_ARCHIVE_URL:-${MORPHEUS_MICROKIT_SDK_MICROKIT_ARCHIVE_URL:-}}"
build_version="${MORPHEUS_MICROKIT_SDK_BUILD_VERSION:-}"
install_dir="$(dirname "${source_dir}")/install"
script_dir="$(cd "$(dirname "$0")" && pwd)"
tool_root="$(cd "${script_dir}/.." && pwd)"
downloads_dir="$(dirname "${toolchain_dir}")/../downloads"
venv_python=""
venv_site_packages=""

if [ -x "${tool_root}/pyenv/bin/python3" ]; then
  venv_python="${tool_root}/pyenv/bin/python3"
elif [ -x "${tool_root}/pyenv/bin/python" ]; then
  venv_python="${tool_root}/pyenv/bin/python"
fi

if [ -n "${venv_python}" ]; then
  venv_site_packages="$("${venv_python}" - <<'PY'
import site
paths = [p for p in site.getsitepackages() if p.endswith("site-packages")]
print(paths[0] if paths else "")
PY
)"
fi

default_toolchain_archive_url() {
  local version="$1"
  printf '%s\n' "https://developer.arm.com/-/media/Files/downloads/gnu/${version}/binrel/arm-gnu-toolchain-${version}-x86_64-aarch64-none-elf.tar.xz"
}

ensure_toolchain() {
  local gcc_path="${toolchain_dir}/bin/${toolchain_prefix}-gcc"
  if [ -x "${gcc_path}" ]; then
    return 0
  fi

  if [ "${allow_fixture_toolchain}" = "true" ]; then
    printf '%s\n' '#!/usr/bin/env sh' 'exit 0' > "${gcc_path}"
    chmod +x "${gcc_path}"
    return 0
  fi

  local archive_url_value="${toolchain_archive_url:-$(default_toolchain_archive_url "${toolchain_version}")}"
  local archive_name archive_path extract_root first_dir

  mkdir -p "${downloads_dir}" "${toolchain_dir}/bin"
  archive_name="$(basename "${archive_url_value}")"
  archive_path="${downloads_dir}/${archive_name}"

  if [ ! -f "${archive_path}" ]; then
    if [[ "${archive_url_value}" == file://* ]]; then
      cp "${archive_url_value#file://}" "${archive_path}"
    else
      curl -L "${archive_url_value}" -o "${archive_path}"
    fi
  fi

  extract_root="${downloads_dir}/.extract-toolchain"
  rm -rf "${extract_root}"
  mkdir -p "${extract_root}"
  tar -xf "${archive_path}" -C "${extract_root}"
  first_dir="$(find "${extract_root}" -mindepth 1 -maxdepth 1 -type d | head -n 1)"
  if [ -z "${first_dir}" ]; then
    echo "toolchain archive did not extract a directory" >&2
    exit 1
  fi

  rm -rf "${toolchain_dir}"
  mv "${first_dir}" "${toolchain_dir}"
  rm -rf "${extract_root}"

  if [ ! -x "${gcc_path}" ]; then
    echo "extracted toolchain is missing ${toolchain_prefix}-gcc under ${toolchain_dir}/bin" >&2
    exit 1
  fi
}

if [ ! -f "${source_dir}/VERSION" ]; then
  if [ -n "${seed_dir}" ] || [ -n "${archive_url}" ] || [ -n "${build_version}" ]; then
    "$(dirname "$0")/fetch.sh"
  fi
fi

if [ ! -f "${source_dir}/VERSION" ]; then
  echo "missing Microkit SDK source tree: ${source_dir}" >&2
  exit 1
fi

if [ -z "${sel4_dir}" ] || [ ! -d "${sel4_dir}" ]; then
  echo "missing Microkit seL4 source tree: set MORPHEUS_MICROKIT_SDK_SEL4" >&2
  exit 1
fi

echo "[microkit] source_dir=${source_dir}" >&2
echo "[microkit] sel4_dir=${sel4_dir}" >&2
echo "[microkit] toolchain_dir=${toolchain_dir}" >&2

rm -rf "${install_dir}"
mkdir -p "${toolchain_dir}/bin"
allow_fixture_toolchain=false
if [ -n "${seed_dir}" ]; then
  allow_fixture_toolchain=true
fi
echo "[microkit] ensuring toolchain" >&2
ensure_toolchain
echo "[microkit] toolchain ready" >&2

if [ -d "${source_dir}/build" ]; then
  echo "[microkit] clearing stale SDK build tree" >&2
  rm -rf "${source_dir}/build"
fi

export PATH="${PATH}:/usr/sbin:${toolchain_dir}/bin"
echo "[microkit] pre-build environment ready" >&2

(
  cd "${source_dir}"
  if [ -n "${venv_python}" ]; then
    export PYTHON_BIN="${venv_python}"
  fi
  if [ -n "${venv_site_packages}" ]; then
    export PYTHONPATH="${venv_site_packages}${PYTHONPATH:+:${PYTHONPATH}}"
  fi
  echo "[microkit] invoking build-sdk.sh" >&2
  bash -x "${script_dir}/build-sdk.sh" \
    "${source_dir}" \
    "${sel4_dir}" \
    "${boards}" \
    "${configs}" \
    "${toolchain_dir}/bin" \
    "${toolchain_prefix}" \
    "${tool_target_triple}"
  echo "[microkit] build-sdk.sh completed" >&2
)

version="$(tr -d '\n' < "${source_dir}/VERSION")"
cp -R "${source_dir}/release/microkit-sdk-${version}" "${install_dir}"

cat > "${result_file}" <<EOF
{"details":{"built":true,"install_dir":"${install_dir}","version":"${version}"}}
EOF
