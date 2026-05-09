#!/usr/bin/env bash
set -euo pipefail

install_dir="${MORPHEUS_NQC2_INSTALL_DIR:?}"
coverage_output="${MORPHEUS_NQC2_COVERAGE_OUTPUT:?}"
output_dir="${MORPHEUS_NQC2_OUTPUT:?}"
title="${MORPHEUS_NQC2_TITLE:-NQC2 Coverage}"
result_file="${MORPHEUS_NQC2_RESULT_FILE:-${MORPHEUS_SCRIPT_RESULT_FILE:?}}"

if ! command -v genhtml >/dev/null 2>&1; then
  echo "missing genhtml; run tools/nqc2/scripts/install-dependencies.sh" >&2
  exit 1
fi

mkdir -p "${output_dir}"
args=(
  --output-directory "${output_dir}"
  --title "${title}"
  --ignore-errors source
  --ignore-errors inconsistent
  --ignore-errors unsupported
  --ignore-errors unused
  --synthesize-missing
)
args+=("${coverage_output}")

genhtml "${args[@]}"

cat > "${result_file}" <<EOF
{"details":{"coverage_output":"${coverage_output}","output":"${output_dir}","title":"${title}"}}
EOF
