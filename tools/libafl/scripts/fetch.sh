#!/usr/bin/env bash
set -euo pipefail

source_dir="${MORPHEUS_LIBAFL_SOURCE:?}"
seed_dir="${MORPHEUS_LIBAFL_SEED_DIR:-}"
git_url="${MORPHEUS_LIBAFL_GIT_URL:-https://github.com/AFLplusplus/LibAFL.git}"
build_version="${MORPHEUS_LIBAFL_BUILD_VERSION:-}"
result_file="${MORPHEUS_LIBAFL_RESULT_FILE:-${MORPHEUS_SCRIPT_RESULT_FILE:?}}"

mkdir -p "$(dirname "${result_file}")"

detect_version() {
  if [ -d "${source_dir}/.git" ]; then
    git -C "${source_dir}" rev-parse HEAD
  else
    printf '%s' "${build_version}"
  fi
}

mkdir -p "$(dirname "${source_dir}")"

if [ -f "${source_dir}/Cargo.toml" ] && [ -d "${source_dir}/crates" ]; then
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

cat > "${result_file}" <<EOF
{"details":{"fetched_source":true,"git_url":"${git_url}","build_version":"${build_version}","version":"$(detect_version)"}}
EOF
