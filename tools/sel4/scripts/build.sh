#!/usr/bin/env bash
set -euo pipefail

source_dir="${MORPHEUS_SEL4_PATH:-${MORPHEUS_SEL4_SOURCE:?}}"
result_file="${MORPHEUS_SEL4_RESULT_FILE:-${MORPHEUS_SCRIPT_RESULT_FILE:?}}"
seed_dir="${MORPHEUS_SEL4_SEED_DIR:-}"
archive_url="${MORPHEUS_SEL4_ARCHIVE_URL:-}"
build_version="${MORPHEUS_SEL4_BUILD_VERSION:-}"

if [ ! -f "${source_dir}/VERSION" ]; then
  if [ -n "${seed_dir}" ] || [ -n "${archive_url}" ] || [ -n "${build_version}" ]; then
    "$(dirname "$0")/fetch.sh"
  fi
fi

if [ ! -f "${source_dir}/VERSION" ]; then
  echo "missing seL4 source tree: ${source_dir}" >&2
  exit 1
fi

cat > "${result_file}" <<EOF
{"details":{"built":true,"version":"$(tr -d '\n' < "${source_dir}/VERSION")"}}
EOF
