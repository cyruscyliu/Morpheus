#!/usr/bin/env bash
set -euo pipefail

# Build the sdg-extractor C++ LLVM pass and SdgSvfCore library.
# Expects MORPHEUS_SDG_EXTRACTOR_BUILD_DIR from the managed runner.

tool_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "${tool_root}/../_shared/scripts/lock.sh"
build_dir="${MORPHEUS_SDG_EXTRACTOR_BUILD_DIR:-${tool_root}/builds/default/build}"
result_file="${MORPHEUS_SDG_EXTRACTOR_RESULT_FILE:-${MORPHEUS_SCRIPT_RESULT_FILE:?}}"
build_dir_key="${MORPHEUS_SDG_EXTRACTOR_BUILD_DIR_KEY:-default}"
morpheus_lock_acquire "${MORPHEUS_SDG_EXTRACTOR_SOURCE:-${tool_root}}.morpheus.lock"
morpheus_build_lock sdg-extractor "${build_dir_key}"
trap morpheus_lock_release EXIT INT TERM

plugin="${build_dir}/src/llvm-pass/SDGExtractPass.so"

mkdir -p "${build_dir}"

log() {
  printf '%s\n' "$*" >&2
}

# Force a fresh CMake configuration if the project layout has changed.
rm -rf "${build_dir}/CMakeCache.txt" "${build_dir}/CMakeFiles"

# Build SVF if it has not been built yet. The networking memcpy field-bounds
# patch lives in the parent repo, is auto-applied for the SVF build, and is
# reverted afterwards so the SVF submodule always ends clean at its recorded
# commit. The install directory keeps the patched build; the stamp records
# the patch fingerprint so repeated builds skip the rebuild.
svf_install="${tool_root}/third_party/SVF/install"
svf_stamp="${svf_install}/.sdg-patches-applied"
svf_patch_file="${tool_root}/patches/svf-networking-memcpy-field-bounds.patch"
# Hash patch content only: relative paths keep the fingerprint stable across
# checkouts, so a moved worktree does not force an SVF rebuild.
svf_patch_fingerprint="$(cd "${tool_root}" && sha256sum \
  third_party/SVF/patches/*.patch \
  patches/svf-networking-memcpy-field-bounds.patch | sha256sum | cut -d' ' -f1)"

svf_patch_applied() {
  patch -R -p1 -d "${tool_root}/third_party/SVF" -s -f --dry-run < "${svf_patch_file}" >/dev/null 2>&1
}

svf_revert_patch() {
  if svf_patch_applied; then
    log "sdg-extractor: reverting SVF patch to leave the submodule clean"
    patch -R -p1 -d "${tool_root}/third_party/SVF" -s < "${svf_patch_file}"
  fi
}

# A failed SVF build must still leave the submodule clean, so the revert
# belongs to the exit path rather than to the success path alone.
trap 'svf_revert_patch; morpheus_lock_release' EXIT INT TERM

if [ ! -f "${svf_install}/lib/cmake/SVF/SVFConfig.cmake" ] ||
   [ ! -f "${svf_stamp}" ] ||
   [ "$(cat "${svf_stamp}" 2>/dev/null)" != "${svf_patch_fingerprint}" ]; then
  if svf_patch_applied; then
    log "sdg-extractor: SVF patch already applied"
  else
    log "sdg-extractor: applying SVF networking memcpy field-bounds patch"
    patch -p1 -d "${tool_root}/third_party/SVF" -s < "${svf_patch_file}"
  fi
  "${tool_root}/third_party/SVF/build-svf.sh"
  svf_revert_patch
  printf '%s\n' "${svf_patch_fingerprint}" > "${svf_stamp}"
fi
svf_revert_patch

cmake -S "${tool_root}" -B "${build_dir}" \
  -DCMAKE_BUILD_TYPE=Release \
  -DLLVM_DIR=/usr/lib/llvm-15/cmake \
  >/dev/null

make -C "${build_dir}" -j"$(nproc)"

if [ ! -f "${plugin}" ]; then
  echo "error: SDGExtractPass.so was not built" >&2
  exit 1
fi

cat > "${build_dir}/manifest.json" <<EOF
{
  "command": "build",
  "status": "success",
  "summary": "built sdg-extractor LLVM pass",
  "details": {
    "build_dir": "${build_dir}",
    "plugin": "${plugin}"
  },
  "paths": {
    "build-dir": {
      "portable": "build",
      "runtime_path": "${build_dir}",
      "resolved_path": "${build_dir}"
    },
    "plugin": {
      "portable": "src/llvm-pass/SDGExtractPass.so",
      "runtime_path": "${plugin}",
      "resolved_path": "${plugin}"
    }
  },
  "artifacts": {
    "build-dir": true,
    "plugin": true
  }
}
EOF

cat > "${result_file}" <<EOF
{
  "summary": "built sdg-extractor LLVM pass",
  "details": {
    "build_dir": "${build_dir}",
    "plugin": "${plugin}"
  },
  "artifacts": [
    { "path": "build-dir", "location": "${build_dir}" },
    { "path": "plugin", "location": "${plugin}" }
  ]
}
EOF
