#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
tmpdir="$(mktemp -d)"
trap 'rm -rf "${tmpdir}"' EXIT

for config in virtfuzz_fuzzing virtfuzz_proxy; do
  model="${repo_root}/tools/devilang/related-work/${config}.state"
  python3 "${repo_root}/tools/devilang/scripts/compile_state.py" \
    --input "${model}" \
    --output-c "${tmpdir}/${config}.c" \
    --output-h "${tmpdir}/${config}.h" \
    --symbol-prefix "${config}"

  cc -std=c11 -Wall -Wextra -Werror -fsyntax-only \
    -I "${tmpdir}" \
    "${tmpdir}/${config}.c"

  grep -q 'intercept_device_to_driver_dma' "${tmpdir}/${config}.c"
  grep -q 'intercept_driver_to_device_dma' "${tmpdir}/${config}.c"
  grep -q 'intercept_pio_read' "${tmpdir}/${config}.c"
  ! grep -q 'coverage_start\|observe_comparisons\|corpus' "${model}"
done

grep -q 'call ignore_driver_to_device_dma' \
  "${repo_root}/tools/devilang/related-work/virtfuzz_fuzzing.state"
grep -q 'call fill_mutated_dma_payload' \
  "${repo_root}/tools/devilang/related-work/virtfuzz_fuzzing.state"
grep -q 'proxy_device_rx' \
  "${repo_root}/tools/devilang/related-work/virtfuzz_proxy.state"

# Every interface event must be followed by a signal or processing action.

# The grammar contract requires every read/write/DMA/interrupt event to have
# a following signal or processing operation in its sequence.
awk '
  /read(8|16|32)\(|write(8|16|32)\(|dma_event\(|interrupt_event\(/ {
    getline nextline;
    if (nextline !~ /extern |call |dma_event\(|write(8|16|32)\(|interrupt_event\(/) {
      print "event missing follow-up operation: " $0 > "/dev/stderr";
      bad = 1;
    }
  }
  END { exit bad }
' "${model}"

printf '%s\n' "VirtFuzz-related Devilang model compiled successfully"
