#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/../../_shared/scripts/state.sh"

source_dir="${MORPHEUS_LIBAFL_SOURCE:?}"
seed_dir="${MORPHEUS_LIBAFL_SEED_DIR:-}"
git_url="${MORPHEUS_LIBAFL_GIT_URL:-https://github.com/AFLplusplus/LibAFL.git}"
build_version="${MORPHEUS_LIBAFL_BUILD_VERSION:-}"
result_file="${MORPHEUS_LIBAFL_RESULT_FILE:-${MORPHEUS_SCRIPT_RESULT_FILE:?}}"
state_file="${source_dir}/.morpheus-fetch.json"

mkdir -p "$(dirname "${result_file}")"

detect_version() {
  if [ -d "${source_dir}/.git" ]; then
    git -C "${source_dir}" rev-parse HEAD
  else
    printf '%s' "${build_version}"
  fi
}

mkdir -p "$(dirname "${source_dir}")"

mode="git"
resolved_revision=""
resolve_git_revision() {
  if [ -z "${build_version}" ]; then
    git ls-remote "${git_url}" HEAD | awk 'NR==1{print $1}'
    return
  fi
  if [[ "${build_version}" =~ ^[0-9a-f]{40}$ ]]; then
    printf '%s\n' "${build_version}"
    return
  fi
  git ls-remote "${git_url}" \
    "refs/heads/${build_version}" \
    "refs/tags/${build_version}" \
    "${build_version}" \
    | awk 'NR==1{print $1}'
}
resolved_revision="$(resolve_git_revision || true)"
if [ -z "${resolved_revision}" ]; then
  resolved_revision="${build_version}"
fi
input_fingerprint="$(printf '%s\n%s\n' "${git_url}" "${resolved_revision}" | sha256sum | awk '{print $1}')"
if [ -n "${seed_dir}" ]; then
  mode="seed"
  input_fingerprint="$(morpheus_hash_tree "${seed_dir}")"
fi

if [ -f "${source_dir}/Cargo.toml" ] && [ -d "${source_dir}/crates" ] \
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
    "resolved_revision" "${resolved_revision}" \
    "git_url" "${git_url}"
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

morpheus_write_state_json \
  "${state_file}" \
  "fetchedAt" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  "mode" "git" \
  "input_fingerprint" "${input_fingerprint}" \
  "git_url" "${git_url}" \
  "build_version" "${build_version}" \
  "resolved_revision" "${resolved_revision}"

cat > "${result_file}" <<EOF
{"details":{"fetched_source":true,"git_url":"${git_url}","build_version":"${build_version}","version":"$(detect_version)"}}
EOF
