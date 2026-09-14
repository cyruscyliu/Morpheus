#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
model="${repo_root}/tools/devilang/related-work/printfuzz_mmio_dma_interrupt.state"
tmpdir="$(mktemp -d)"
trap 'rm -rf "${tmpdir}"' EXIT

python3 "${repo_root}/tools/devilang/scripts/compile_state.py" \
  --input "${model}" \
  --output-c "${tmpdir}/printfuzz.c" \
  --output-h "${tmpdir}/printfuzz.h" \
  --symbol-prefix printfuzz_related_work

cc -std=c11 -Wall -Wextra -Werror -fsyntax-only \
  -I "${tmpdir}" \
  "${tmpdir}/printfuzz.c"

grep -q 'device_to_driver_dma' "${tmpdir}/printfuzz.c"
grep -q 'driver_to_device_dma' "${tmpdir}/printfuzz.c"
grep -q 'external_interrupt_injected' "${tmpdir}/printfuzz.c"
grep -q 'external_initialization_fault' "${tmpdir}/printfuzz.c"
grep -q 'DL_STEP_INTERRUPT' "${tmpdir}/printfuzz.c"

grep -q 'op=alloc' "${model}"
if grep -Eq 'op=map|observe_map_sync|op=unmap|dma_unmapped' "${model}"; then
    echo "PrIntFuzz model unexpectedly models streaming DMA mapping" >&2
    exit 1
fi
grep -q 'data_kind=any' "${model}"
if grep -Eq 'data_type=|data_field=|printfuzz_(rx|tx)_buffer' "${model}"; then
    echo "PrIntFuzz model unexpectedly infers a DMA payload schema" >&2
    exit 1
fi

for external in \
    observe_dma_event \
    initialize_driver \
    unload_driver \
    return_concrete_value \
    observe_interrupt_injection \
    inject_initialization_fault; do
    grep -q "extern void ${external}(" "${tmpdir}/printfuzz.c"
done

for builtin in \
    fill_mutated_dma_payload \
    ignore_driver_mmio_write \
    ignore_driver_to_device_dma \
    inject_interrupt; do
    grep -q "call ${builtin}" "${model}"
    if grep -Eq "^extern void ${builtin}\\(" "${tmpdir}/printfuzz.c"; then
        echo "builtin unexpectedly has an external declaration: ${builtin}" >&2
        exit 1
    fi
done

printf '%s\n' "PrIntFuzz-related Devilang model compiled successfully"
