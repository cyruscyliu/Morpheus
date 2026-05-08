#!/usr/bin/env bash
set -euo pipefail

install_dir="${MORPHEUS_NQC2_INSTALL_DIR:?}"
trace_path="${MORPHEUS_NQC2_TRACE:?}"
elf_path="${MORPHEUS_NQC2_ELF:-}"
trace_output="${MORPHEUS_NQC2_TRACE_OUTPUT:-}"
coverage_output="${MORPHEUS_NQC2_COVERAGE_OUTPUT:-}"
coverage_format="${MORPHEUS_NQC2_COVERAGE_FORMAT:-none}"
wait_seconds="${MORPHEUS_NQC2_WAIT_SECONDS:-0}"
jobs="${MORPHEUS_NQC2_JOBS:-4}"
result_file="${MORPHEUS_NQC2_RESULT_FILE:-${MORPHEUS_SCRIPT_RESULT_FILE:?}}"
cli="${install_dir}/bin/nqc2"

if [ ! -x "${cli}" ]; then
  echo "missing NQC2 CLI: ${cli}" >&2
  exit 1
fi

if [ "${wait_seconds}" != "0" ]; then
  sleep "${wait_seconds}"
fi

args=(--trace "${trace_path}")
args+=(-j "${jobs}")
if [ -n "${elf_path}" ]; then
  args+=(--elf "${elf_path}")
fi
if [ -n "${trace_output}" ]; then
  args+=(--trace-output "${trace_output}")
fi
if [ -n "${coverage_output}" ]; then
  args+=(--coverage-output "${coverage_output}")
fi
if [ -n "${coverage_format}" ]; then
  args+=(--coverage-format "${coverage_format}")
fi

"${cli}" postprocess "${args[@]}"

cat > "${result_file}" <<EOF
{"details":{"trace":"${trace_path}","elf":"${elf_path}","trace_output":"${trace_output}","coverage_output":"${coverage_output}","coverage_format":"${coverage_format}"}}
EOF
