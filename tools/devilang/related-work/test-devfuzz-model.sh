#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
model="${repo_root}/tools/devilang/related-work/devfuzz_automatic_device_model.state"
tmpdir="$(mktemp -d)"
trap 'rm -rf "${tmpdir}"' EXIT

python3 "${repo_root}/tools/devilang/scripts/compile_state.py" \
  --input "${model}" \
  --output-c "${tmpdir}/devfuzz.c" \
  --output-h "${tmpdir}/devfuzz.h" \
  --symbol-prefix devfuzz_related_work

cc -std=c11 -Wall -Wextra -Werror -fsyntax-only \
  -I "${tmpdir}" \
  "${tmpdir}/devfuzz.c"

grep -q 'probe_pio_access' "${tmpdir}/devfuzz.c"
grep -q 'runtime_mmio_access' "${tmpdir}/devfuzz.c"
grep -q 'device_to_driver_dma' "${tmpdir}/devfuzz.c"
grep -q 'coherent_dma_alloc' "${tmpdir}/devfuzz.c"
grep -q 'timer_interrupt' "${tmpdir}/devfuzz.c"
grep -q 'interrupt_event' "${model}"
grep -q 'return_input_stream_value' "${tmpdir}/devfuzz.c"
! grep -q 'coverage_start\|coverage_stop\|reuse_device_model' "${model}"
! grep -Eq '75[[:space:]]*(mmio|MMIO)|every[[:space:]]+75' "${model}"
grep -q 'dma_event(op=alloc' "${model}"
grep -q 'dma_event(op=map' "${model}"

printf '%s\n' "DevFuzz-related Devilang model compiled successfully"
