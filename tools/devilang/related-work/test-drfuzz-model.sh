#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
model="${repo_root}/tools/devilang/related-work/drfuzz_device_free_validation.state"
tmpdir="$(mktemp -d)"
trap 'rm -rf "${tmpdir}"' EXIT

python3 "${repo_root}/tools/devilang/scripts/compile_state.py" \
  --input "${model}" \
  --output-c "${tmpdir}/drfuzz.c" \
  --output-h "${tmpdir}/drfuzz.h" \
  --symbol-prefix drfuzz_related_work

cc -std=c11 -Wall -Wextra -Werror -fsyntax-only \
  -I "${tmpdir}" \
  "${tmpdir}/drfuzz.c"

grep -q 'intercept_mmio_read' "${tmpdir}/drfuzz.c"
grep -q 'coherent_device_to_driver_dma' "${tmpdir}/drfuzz.c"
grep -q 'external_user_ioctl' "${tmpdir}/drfuzz.c"
grep -q 'handle_interrupt' "${tmpdir}/drfuzz.c"
grep -q 'fill_mutated_dma_payload' "${model}"
grep -q 'return_input_stream_value' "${tmpdir}/drfuzz.c"
! grep -q 'report_validation_error\|record_coverage' "${model}"
grep -q 'dma_event(op=map' "${model}"
grep -q 'dma_event(op=alloc' "${model}"

printf '%s\n' "DrFuzz-related Devilang model compiled successfully"
