#!/usr/bin/env bash
set -euo pipefail

install_dir="${MORPHEUS_NQC2_INSTALL_DIR:?}"
trace_path="${MORPHEUS_NQC2_TRACE:?}"
elf_path="${MORPHEUS_NQC2_ELF:-}"
trace_output="${MORPHEUS_NQC2_TRACE_OUTPUT:-}"
coverage_output="${MORPHEUS_NQC2_COVERAGE_OUTPUT:-}"
coverage_format="${MORPHEUS_NQC2_COVERAGE_FORMAT:-none}"
wait_seconds="${MORPHEUS_NQC2_WAIT_SECONDS:-0}"
result_file="${MORPHEUS_NQC2_RESULT_FILE:-${MORPHEUS_SCRIPT_RESULT_FILE:?}}"
cli="${install_dir}/bin/nqc2"

if [ ! -x "${cli}" ]; then
  echo "missing nqc2 CLI: ${cli}" >&2
  exit 1
fi

if [ "${wait_seconds}" != "0" ]; then
  sleep "${wait_seconds}"
fi

tmp_dir="$(mktemp -d)"
trap 'rm -rf "${tmp_dir}"' EXIT

canonical_trace="${tmp_dir}/trace.etrace"
cp "${trace_path}" "${canonical_trace}"

# Clear the TB-chaining info flag so qemu-etrace accepts the trace for coverage.
printf '\0\0\0\0\0\0\0\0' | dd of="${canonical_trace}" bs=1 seek=8 conv=notrunc status=none

args=(--trace "${canonical_trace}")
if [ -n "${elf_path}" ]; then
  args+=(--elf "${elf_path}")
fi
if [ -n "${trace_output}" ] && [ "${trace_output}" != "none" ]; then
  args+=(--trace-output "${trace_output}")
else
  args+=(--trace-output /dev/null --trace-out-format none)
fi
if [ -n "${coverage_output}" ]; then
  if [ "${coverage_format}" = "lcov" ]; then
    raw_coverage="${tmp_dir}/raw.info"
    normalized_coverage="${tmp_dir}/normalized.info"
    canonical_coverage="${tmp_dir}/canonical.info"
    merged_coverage="${tmp_dir}/merged.info"
    args+=(--coverage-output "${raw_coverage}")
  else
    args+=(--coverage-output "${coverage_output}")
  fi
fi
if [ -n "${coverage_format}" ]; then
  args+=(--coverage-format "${coverage_format}")
fi

"${cli}" "${args[@]}"

if [ -n "${coverage_output}" ] && [ "${coverage_format}" = "lcov" ]; then
  lcov \
    --ignore-errors inconsistent,corrupt,unsupported,count \
    --add-tracefile "${raw_coverage}" \
    --output-file "${normalized_coverage}" >/dev/null
  perl -pe 'if (/^SF:/) { s#/\./#/#g; s#^SF:\./#SF:#; }' \
    "${normalized_coverage}" > "${canonical_coverage}"
  lcov \
    --ignore-errors inconsistent,corrupt,unsupported,count \
    --add-tracefile "${canonical_coverage}" \
    --output-file "${merged_coverage}" >/dev/null
  mv "${merged_coverage}" "${coverage_output}"
fi

cat > "${result_file}" <<EOF
{"details":{"trace":"${trace_path}","elf":"${elf_path}","trace_output":"${trace_output}","coverage_output":"${coverage_output}","coverage_format":"${coverage_format}"}}
EOF
