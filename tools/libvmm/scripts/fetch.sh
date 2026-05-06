#!/usr/bin/env bash
set -euo pipefail

source_dir="${MORPHEUS_LIBVMM_SOURCE:?}"
seed_dir="${MORPHEUS_LIBVMM_SEED_DIR:-}"
git_url="${MORPHEUS_LIBVMM_GIT_URL:-}"
build_version="${MORPHEUS_LIBVMM_BUILD_VERSION:-}"
result_file="${MORPHEUS_LIBVMM_RESULT_FILE:-${MORPHEUS_SCRIPT_RESULT_FILE:?}}"

mkdir -p "$(dirname "${source_dir}")"

if [ -f "${source_dir}/VERSION" ]; then
  cat > "${result_file}" <<EOF
{"details":{"reused":true,"fetched_source":false,"build_version":"${build_version}","version":"$(tr -d '\n' < "${source_dir}/VERSION")"}}
EOF
  exit 0
fi

if [ -n "${seed_dir}" ]; then
  rm -rf "${source_dir}"
  cp -R "${seed_dir}" "${source_dir}"
  cat > "${result_file}" <<EOF
{"details":{"fetched_source":true,"seed_dir":"${seed_dir}","build_version":"${build_version}","version":"$(tr -d '\n' < "${source_dir}/VERSION")"}}
EOF
  exit 0
fi

if [ -n "${git_url}" ]; then
  rm -rf "${source_dir}"
  git clone --depth 1 ${build_version:+--branch "${build_version}"} "${git_url}" "${source_dir}"
  cat > "${result_file}" <<EOF
{"details":{"fetched_source":true,"git_url":"${git_url}","build_version":"${build_version}","version":"$(tr -d '\n' < "${source_dir}/VERSION")"}}
EOF
  exit 0
fi

echo "fetch requires MORPHEUS_LIBVMM_SEED_DIR or MORPHEUS_LIBVMM_GIT_URL when the source tree is missing" >&2
exit 1
