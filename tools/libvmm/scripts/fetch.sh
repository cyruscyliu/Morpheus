#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/../../_shared/scripts/state.sh"

source_dir="${MORPHEUS_LIBVMM_SOURCE:?}"
seed_dir="${MORPHEUS_LIBVMM_SEED_DIR:-}"
git_url="${MORPHEUS_LIBVMM_GIT_URL:-}"
build_version="${MORPHEUS_LIBVMM_BUILD_VERSION:-}"
result_file="${MORPHEUS_LIBVMM_RESULT_FILE:-${MORPHEUS_SCRIPT_RESULT_FILE:?}}"
state_file="${source_dir}/.morpheus-fetch.json"

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

mode="empty"
input_fingerprint=""
if [ -n "${seed_dir}" ]; then
  mode="seed"
  input_fingerprint="$(morpheus_hash_tree "${seed_dir}")"
elif [ -n "${git_url}" ]; then
  mode="git"
  input_fingerprint="$(printf '%s\n%s\n' "${git_url}" "${build_version}" | sha256sum | awk '{print $1}')"
fi

if [ -f "${source_dir}/VERSION" ] \
  && morpheus_state_matches "${state_file}" "mode" "${mode}" \
  && morpheus_state_matches "${state_file}" "input_fingerprint" "${input_fingerprint}"; then
  cat > "${result_file}" <<EOF
{"details":{"reused":true,"fetched_source":false,"build_version":"${build_version}","version":"$(detect_version)"}}
EOF
  exit 0
fi

if [ -n "${seed_dir}" ]; then
  rm -rf "${source_dir}"
  cp -R "${seed_dir}" "${source_dir}"
  morpheus_write_state_json \
    "${state_file}" \
    "fetchedAt" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    "mode" "seed" \
    "input_fingerprint" "${input_fingerprint}" \
    "seed_dir" "${seed_dir}" \
    "build_version" "${build_version}" \
    "git_url" "${git_url}"
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
  morpheus_write_state_json \
    "${state_file}" \
    "fetchedAt" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    "mode" "git" \
    "input_fingerprint" "${input_fingerprint}" \
    "git_url" "${git_url}" \
    "build_version" "${build_version}"
  cat > "${result_file}" <<EOF
{"details":{"fetched_source":true,"git_url":"${git_url}","build_version":"${build_version}","version":"$(detect_version)"}}
EOF
  exit 0
fi

echo "fetch requires MORPHEUS_LIBVMM_SEED_DIR or MORPHEUS_LIBVMM_GIT_URL when the source tree is missing" >&2
exit 1
