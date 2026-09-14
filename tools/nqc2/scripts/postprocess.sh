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

trace_files=()
if [ -d "${trace_path}" ]; then
  while IFS= read -r -d '' candidate; do
    [ -s "${candidate}" ] || continue
    trace_files+=("${candidate}")
  done < <(
    find "${trace_path}" -type f -name 'morpheus-nqc2.trace' -print0 | sort -z
  )
else
  if [ ! -f "${trace_path}" ]; then
    echo "missing NQC2 trace or trace directory: ${trace_path}" >&2
    exit 1
  fi
  trace_files+=("${trace_path}")
fi

if [ "${#trace_files[@]}" -eq 0 ]; then
  echo "no non-empty NQC2 traces found under ${trace_path}" >&2
  exit 1
fi

# The root-level runtime trace is a copy of the last replay. Deduplicate by
# content so a directory input does not process that copy twice.
declare -A seen_trace_hashes=()
unique_trace_files=()
for candidate in "${trace_files[@]}"; do
  trace_hash="$(sha256sum "${candidate}" | awk '{print $1}')"
  if [ -n "${seen_trace_hashes[${trace_hash}]+present}" ]; then
    continue
  fi
  seen_trace_hashes[${trace_hash}]=1
  unique_trace_files+=("${candidate}")
done
trace_files=("${unique_trace_files[@]}")

if [ -n "${coverage_output}" ]; then
  mkdir -p "$(dirname "${coverage_output}")"
fi

if [ "${#trace_files[@]}" -gt 1 ] &&
   [ -n "${trace_output}" ] && [ "${trace_output}" != "none" ]; then
  echo "--trace-output is only supported for a single NQC2 trace" >&2
  exit 1
fi

raw_coverages=()
trace_index=0
for trace_file in "${trace_files[@]}"; do
  canonical_trace="${tmp_dir}/trace-${trace_index}.etrace"
  trace_magic="$(od -An -tx1 -N2 "${trace_file}" | tr -d ' \n')"
  if [ "${trace_magic}" = "1f8b" ]; then
    if ! command -v gzip >/dev/null 2>&1; then
      echo "gzip is required to process compressed NQC2 trace: ${trace_file}" >&2
      exit 1
    fi
    if ! gzip -cd -- "${trace_file}" > "${canonical_trace}"; then
      echo "failed to decompress NQC2 trace: ${trace_file}" >&2
      exit 1
    fi
  else
    cp "${trace_file}" "${canonical_trace}"
  fi

  # Clear the TB-chaining info flag so qemu-etrace accepts the trace for
  # coverage. Each QEMU process writes its own header.
  printf '\0\0\0\0\0\0\0\0' |
    dd of="${canonical_trace}" bs=1 seek=8 conv=notrunc status=none

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
      raw_coverage="${tmp_dir}/raw-${trace_index}.info"
      raw_coverages+=("${raw_coverage}")
      args+=(--coverage-output "${raw_coverage}")
    else
      args+=(--coverage-output "${coverage_output}")
    fi
  fi
  if [ -n "${coverage_format}" ]; then
    args+=(--coverage-format "${coverage_format}")
  fi

  "${cli}" "${args[@]}"
  trace_index=$((trace_index + 1))
done

if [ -n "${coverage_output}" ] && [ "${coverage_format}" = "lcov" ]; then
  merged_coverage="${tmp_dir}/merged.info"
  cp "${raw_coverages[0]}" "${merged_coverage}"
  merge_index=1
  for raw_coverage in "${raw_coverages[@]:1}"; do
    next_merged="${tmp_dir}/merged-${merge_index}.info"
    lcov \
      --ignore-errors inconsistent,corrupt,unsupported,count \
      --add-tracefile "${merged_coverage}" \
      --add-tracefile "${raw_coverage}" \
      --output-file "${next_merged}" >/dev/null
    merged_coverage="${next_merged}"
    merge_index=$((merge_index + 1))
  done

  normalized_coverage="${tmp_dir}/normalized.info"
  canonical_coverage="${tmp_dir}/canonical.info"
  lcov \
    --ignore-errors inconsistent,corrupt,unsupported,count \
    --add-tracefile "${merged_coverage}" \
    --output-file "${normalized_coverage}" >/dev/null
  perl -pe 'if (/^SF:/) { s#/\./#/#g; s#^SF:\./#SF:#; }' \
    "${normalized_coverage}" > "${canonical_coverage}"
  lcov \
    --ignore-errors inconsistent,corrupt,unsupported,count \
    --add-tracefile "${canonical_coverage}" \
    --output-file "${coverage_output}" >/dev/null
fi

result_artifacts=""
if [ -n "${coverage_output}" ] && [ -f "${coverage_output}" ]; then
  result_artifacts=",\"artifacts\":[{\"path\":\"coverage-info\",\"location\":\"${coverage_output}\"}]"
fi

cat > "${result_file}" <<EOF
{"details":{"trace":"${trace_path}","trace_count":${#trace_files[@]},"elf":"${elf_path}","trace_output":"${trace_output}","coverage_output":"${coverage_output}","coverage_format":"${coverage_format}"}${result_artifacts}}
EOF
