#!/usr/bin/env bash
set -euo pipefail

# The bridge source follows the same fetch contract as the native QEMU tool.
# Keep this adapter separate so the bridge is independently configurable and
# can later carry CCA-specific patches without changing tools/qemu.
repo_root="${MORPHEUS_REPO_ROOT:?missing MORPHEUS_REPO_ROOT}"
provider_base_ref="${MORPHEUS_QEMU_LIBAFL_BRIDGE_PROVIDER_BASE_REF:-${MORPHEUS_QEMU_LIBAFL_BRIDGE_BASE_VERSION:-6e9a825c1d4e7b62d072e99a89ecd1a74c7f0d55}}"
provider_base_version="${MORPHEUS_QEMU_LIBAFL_BRIDGE_PROVIDER_BASE_VERSION:-11.0.1}"

env \
  MORPHEUS_QEMU_SOURCE="${MORPHEUS_QEMU_LIBAFL_BRIDGE_SOURCE:?missing bridge source}" \
  MORPHEUS_QEMU_SEED_DIR="${MORPHEUS_QEMU_LIBAFL_BRIDGE_SEED_DIR:-}" \
  MORPHEUS_QEMU_ARCHIVE_URL="${MORPHEUS_QEMU_LIBAFL_BRIDGE_ARCHIVE_URL:-}" \
  MORPHEUS_QEMU_GIT_URL="${MORPHEUS_QEMU_LIBAFL_BRIDGE_GIT_URL:-}" \
  MORPHEUS_QEMU_GIT_REF="${MORPHEUS_QEMU_LIBAFL_BRIDGE_GIT_REF:-}" \
  MORPHEUS_QEMU_FETCH_SUBMODULES="${MORPHEUS_QEMU_LIBAFL_BRIDGE_FETCH_SUBMODULES:-false}" \
  MORPHEUS_QEMU_DOWNLOADS_DIR="${MORPHEUS_QEMU_LIBAFL_BRIDGE_DOWNLOADS_DIR:-}" \
  MORPHEUS_QEMU_BUILD_VERSION="${MORPHEUS_QEMU_LIBAFL_BRIDGE_BUILD_VERSION:-}" \
  MORPHEUS_QEMU_RESULT_FILE="${MORPHEUS_QEMU_LIBAFL_BRIDGE_RESULT_FILE:-${MORPHEUS_SCRIPT_RESULT_FILE:?missing result file}}" \
  "${repo_root}/tools/qemu/scripts/fetch.sh"

source_dir="${MORPHEUS_QEMU_LIBAFL_BRIDGE_SOURCE:?missing bridge source}"
if [[ "${source_dir}" != /* ]]; then
  source_dir="${repo_root}/${source_dir#./}"
fi
if ! git -C "${source_dir}" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "bridge provider fetch did not create a git checkout: ${source_dir}" >&2
  exit 1
fi

# A shallow provider clone is enough for normal operation, but patching needs
# the provider's QEMU base commit in the object database to compute the exact
# LibAFL delta.  Fetch it explicitly and fail here if the selected provider
# does not contain that base.
if ! git -C "${source_dir}" cat-file -e "${provider_base_ref}^{commit}" 2>/dev/null; then
  git -C "${source_dir}" fetch --quiet --no-tags --depth=1 origin "${provider_base_ref}" || {
    echo "bridge provider does not contain configured base commit ${provider_base_ref}" >&2
    exit 1
  }
fi
git -C "${source_dir}" cat-file -e "${provider_base_ref}^{commit}" 2>/dev/null || {
  echo "bridge provider is missing configured base commit ${provider_base_ref}" >&2
  exit 1
}
