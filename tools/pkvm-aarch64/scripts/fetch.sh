#!/usr/bin/env bash
set -euo pipefail

source_dir="${MORPHEUS_PKVM_AARCH64_SOURCE:?}"
seed_dir="${MORPHEUS_PKVM_AARCH64_SEED_DIR:-}"
build_version="${MORPHEUS_PKVM_AARCH64_BUILD_VERSION:-}"
git_url="${MORPHEUS_PKVM_AARCH64_GIT_URL:-https://github.com/vrosendahl/pkvm-aarch64.git}"
fetch_submodules="${MORPHEUS_PKVM_AARCH64_FETCH_SUBMODULES:-false}"
result_file="${MORPHEUS_PKVM_AARCH64_RESULT_FILE:-${MORPHEUS_SCRIPT_RESULT_FILE:?}}"
marker_file="${source_dir}/.morpheus-fetch-complete"
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "${script_dir}/../../.." && pwd)"
override_dir="${repo_root}/tools/pkvm-aarch64/overrides"

apply_overrides() {
  if [ ! -d "${override_dir}" ]; then
    return 0
  fi

  find "${override_dir}" -type f -print0 | while IFS= read -r -d '' file; do
    rel="${file#${override_dir}/}"
    install -D -m 0755 "${file}" "${source_dir}/${rel}"
  done
}

adjust_source_tree() {
  local virt_makefile="${source_dir}/platform/virt/Makefile"
  if [ -f "${virt_makefile}" ]; then
    sed -i 's/hostfwd=tcp:$(WAYOUT):$(PORT)-192.168.7.2:22/hostfwd=tcp:127.0.0.1:$(PORT)-192.168.7.2:22/' "${virt_makefile}"
  fi
}

detect_version() {
  if [ -d "${source_dir}/.git" ]; then
    git -C "${source_dir}" rev-parse HEAD
  elif [ -f "${source_dir}/VERSION" ]; then
    tr -d '\n' < "${source_dir}/VERSION"
  else
    printf '%s' "${build_version}"
  fi
}

mkdir -p "$(dirname "${source_dir}")"

apply_overrides
adjust_source_tree

if [ -f "${marker_file}" ]; then
  cat > "${result_file}" <<EOF
{"details":{"reused":true,"fetched_source":false,"source":"${source_dir}","build_version":"${build_version}","version":"$(detect_version)"}}
EOF
  exit 0
fi

rm -rf "${source_dir}"

if [ -n "${seed_dir}" ]; then
  cp -R "${seed_dir}" "${source_dir}"
else
  if [ -n "${build_version}" ] && [[ "${build_version}" =~ ^[0-9a-f]{40}$ ]]; then
    git clone "${git_url}" "${source_dir}"
    git -C "${source_dir}" checkout "${build_version}"
  elif [ -n "${build_version}" ]; then
    git clone --depth 1 --branch "${build_version}" "${git_url}" "${source_dir}"
  else
    git clone --depth 1 "${git_url}" "${source_dir}"
  fi
  if [ "${fetch_submodules}" = "true" ] && [ -f "${source_dir}/.gitmodules" ]; then
    git -C "${source_dir}" submodule update --init --recursive || true
  fi
fi

apply_overrides
adjust_source_tree

if [ ! -f "${source_dir}/Makefile" ]; then
  echo "missing pKVM source tree: ${source_dir}" >&2
  exit 1
fi

cat > "${result_file}" <<EOF
{"details":{"fetched_source":true,"source":"${source_dir}","seed_dir":"${seed_dir}","git_url":"${git_url}","build_version":"${build_version}","version":"$(detect_version)"}}
EOF
touch "${marker_file}"
