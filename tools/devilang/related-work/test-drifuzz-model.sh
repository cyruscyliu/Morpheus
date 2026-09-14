#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
model="${repo_root}/tools/devilang/related-work/drifuzz_golden_seed_device_interface.state"
tmpdir="$(mktemp -d)"
trap 'rm -rf "${tmpdir}"' EXIT

python3 "${repo_root}/tools/devilang/scripts/compile_state.py" \
  --input "${model}" \
  --output-c "${tmpdir}/drifuzz.c" \
  --output-h "${tmpdir}/drifuzz.h" \
  --symbol-prefix drifuzz_related_work

cc -std=c11 -Wall -Wextra -Werror -fsyntax-only \
  -I "${tmpdir}" "${tmpdir}/drifuzz.c"

grep -q 'dma_event(op=alloc' "${model}"
grep -q 'dma_event(op=unmap' "${model}"
grep -q 'external_interrupt_injected' "${tmpdir}/drifuzz.c"
grep -q 'configure_device' "${tmpdir}/drifuzz.c"
grep -q 'call ignore_driver_mmio_write' "${model}"
grep -q 'call fill_mutated_dma_payload' "${model}"

printf '%s\n' "Drifuzz-related Devilang model compiled successfully"
