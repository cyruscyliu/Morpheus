#!/usr/bin/env bash
set -euo pipefail

source_dir="${MORPHEUS_LIBVMM_SOURCE:?}"
seed_dir="${MORPHEUS_LIBVMM_SEED_DIR:-}"
git_url="${MORPHEUS_LIBVMM_GIT_URL:-}"
build_version="${MORPHEUS_LIBVMM_BUILD_VERSION:-}"
result_file="${MORPHEUS_LIBVMM_RESULT_FILE:-${MORPHEUS_SCRIPT_RESULT_FILE:?}}"

detect_version() {
  if [ -f "${source_dir}/VERSION" ]; then
    tr -d '\n' < "${source_dir}/VERSION"
  elif [ -d "${source_dir}/.git" ]; then
    git -C "${source_dir}" rev-parse HEAD
  else
    printf '%s' "${build_version}"
  fi
}

mkdir -p "$(dirname "${source_dir}")"

if [ -f "${source_dir}/VERSION" ]; then
  cat > "${result_file}" <<EOF
{"details":{"reused":true,"fetched_source":false,"build_version":"${build_version}","version":"$(detect_version)"}}
EOF
  exit 0
fi

if [ -n "${seed_dir}" ]; then
  rm -rf "${source_dir}"
  cp -R "${seed_dir}" "${source_dir}"
  cat > "${result_file}" <<EOF
{"details":{"fetched_source":true,"seed_dir":"${seed_dir}","build_version":"${build_version}","version":"$(detect_version)"}}
EOF
  exit 0
fi

if [ -n "${git_url}" ]; then
  rm -rf "${source_dir}"
  if [ -n "${build_version}" ]; then
    if [[ "${build_version}" =~ ^[0-9a-f]{40}$ ]]; then
      git clone "${git_url}" "${source_dir}"
      git -C "${source_dir}" checkout "${build_version}"
    else
      git clone --depth 1 --branch "${build_version}" "${git_url}" "${source_dir}"
    fi
  else
    git clone --depth 1 "${git_url}" "${source_dir}"
  fi
  if [ -f "${source_dir}/.gitmodules" ]; then
    git -C "${source_dir}" submodule update --init --recursive
  fi
  cat > "${result_file}" <<EOF
{"details":{"fetched_source":true,"git_url":"${git_url}","build_version":"${build_version}","version":"$(detect_version)"}}
EOF
  exit 0
fi

echo "fetch requires MORPHEUS_LIBVMM_SEED_DIR or MORPHEUS_LIBVMM_GIT_URL when the source tree is missing" >&2
exit 1
