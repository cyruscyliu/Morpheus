#!/usr/bin/env bash
set -euo pipefail

# Placeholder build for sdg-extractor.
# The real extractor is expected to be a Python/LLVM tool. This build step
# only creates a manifest so the Morpheus managed runner has a build-dir
# artifact to reference.

tool_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
build_dir="${MORPHEUS_SDG_EXTRACTOR_BUILD_DIR:-${tool_root}/build}"
result_file="${MORPHEUS_SDG_EXTRACTOR_RESULT_FILE:-${MORPHEUS_SCRIPT_RESULT_FILE:?}}"

mkdir -p "${build_dir}"

printf '%s' "built" > "${build_dir}/status.txt"

cat > "${build_dir}/manifest.json" <<EOF
{
  "command": "build",
  "status": "success",
  "summary": "sdg-extractor build placeholder",
  "details": {
    "build_dir": "${build_dir}"
  },
  "paths": {
    "build-dir": {
      "portable": "build",
      "runtime_path": "${build_dir}",
      "resolved_path": "${build_dir}"
    }
  },
  "artifacts": {
    "build-dir": true
  }
}
EOF

cat > "${result_file}" <<EOF
{
  "summary": "built sdg-extractor placeholder artifacts",
  "details": {
    "build_dir": "${build_dir}"
  },
  "artifacts": [
    { "path": "build-dir", "location": "${build_dir}" }
  ]
}
EOF
