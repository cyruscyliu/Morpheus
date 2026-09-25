#!/usr/bin/env bash
set -euo pipefail

# Build the sdg-extractor C++ LLVM pass and SdgSvfCore library.
# Expects MORPHEUS_SDG_EXTRACTOR_BUILD_DIR from the managed runner.

tool_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
build_dir="${MORPHEUS_SDG_EXTRACTOR_BUILD_DIR:-${tool_root}/builds/default/build}"
result_file="${MORPHEUS_SDG_EXTRACTOR_RESULT_FILE:-${MORPHEUS_SCRIPT_RESULT_FILE:?}}"

plugin="${build_dir}/src/llvm-pass/SDGExtractPass.so"

mkdir -p "${build_dir}"

# Force a fresh CMake configuration if the project layout has changed.
rm -rf "${build_dir}/CMakeCache.txt" "${build_dir}/CMakeFiles"

# Build SVF if it has not been built yet.
svf_install="${tool_root}/third_party/SVF/install"
if [ ! -f "${svf_install}/lib/cmake/SVF/SVFConfig.cmake" ]; then
  "${tool_root}/third_party/SVF/build-svf.sh"
fi

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
