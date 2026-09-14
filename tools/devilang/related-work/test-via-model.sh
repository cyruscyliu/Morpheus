#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
tmpdir="$(mktemp -d)"
trap 'rm -rf "${tmpdir}"' EXIT

compile_model() {
    local model="$1"
    local name="$2"

    python3 "${repo_root}/tools/devilang/scripts/compile_state.py" \
      --input "${repo_root}/tools/devilang/related-work/${model}" \
      --output-c "${tmpdir}/${name}.c" \
      --output-h "${tmpdir}/${name}.h" \
      --symbol-prefix "${name}_related_work"

    cc -std=c11 -Wall -Wextra -Werror -fsyntax-only \
      -I "${tmpdir}" \
      "${tmpdir}/${name}.c"
}

compile_model via_passthrough_mmio_dma.state via_passthrough
compile_model via_emulation_mmio_dma.state via_emulation

grep -q 'intercept_mmio_read' "${tmpdir}/via_passthrough.c"
grep -q 'intercept_pio_write' "${tmpdir}/via_passthrough.c"
grep -q 'external_interrupt_injected' "${tmpdir}/via_passthrough.c"
grep -q 'DL_STEP_INTERRUPT' "${tmpdir}/via_passthrough.c"
grep -q 'observe_interrupt_injection(interrupt_marker)' \
    "${repo_root}/tools/devilang/related-work/via_passthrough_mmio_dma.state"
grep -q 'interrupt_event(vector=interrupt_marker)' \
    "${repo_root}/tools/devilang/related-work/via_passthrough_mmio_dma.state"
grep -q 'call inject_interrupt(interrupt_marker)' \
    "${repo_root}/tools/devilang/related-work/via_passthrough_mmio_dma.state"
grep -q 'irq_status = read32(mmio_base + 0x60)' \
    "${repo_root}/tools/devilang/related-work/via_passthrough_mmio_dma.state"
grep -q 'write32(irq_status, mmio_base + 0x64)' \
    "${repo_root}/tools/devilang/related-work/via_passthrough_mmio_dma.state"
if sed -n '/trace handle_interrupt/,/trace external_driver_unloaded/p' \
    "${repo_root}/tools/devilang/related-work/via_passthrough_mmio_dma.state" |
    grep -q 'read32(unknown)'; then
    echo "interrupt handler still uses an unknown status-register address" >&2
    exit 1
fi
if grep -q 'harness_inject_interrupt' \
    "${repo_root}/tools/devilang/related-work/via_passthrough_mmio_dma.state"; then
    echo "passthrough model still conflates external interrupt observation with injection" >&2
    exit 1
fi
grep -q 'external_dma_unmapped' "${tmpdir}/via_passthrough.c"
grep -q 'dma_event(op=unmap' \
    "${repo_root}/tools/devilang/related-work/via_passthrough_mmio_dma.state"
grep -q 'external_driver_unloaded' "${tmpdir}/via_passthrough.c"
grep -q 'intercept_device_to_driver_dma' "${tmpdir}/via_passthrough.c"
grep -q 'DL_EXPR_ANY' "${tmpdir}/via_passthrough.c"
if grep -Eq 'via_passthrough_input_stream|serialized_bytes|data_type=' \
    "${repo_root}/tools/devilang/related-work/via_passthrough_mmio_dma.state"; then
    echo "passthrough model unexpectedly infers a DMA payload type" >&2
    exit 1
fi
if grep -q 'via_passthrough_packet' "${tmpdir}/via_passthrough.c"; then
    echo "unused passthrough packet schema was generated" >&2
    exit 1
fi

for external in \
    initialize_driver \
    observe_map_sync \
    observe_dma_event \
    unmap_passthrough_dma_buffers \
    observe_interrupt_injection \
    unload_driver \
    return_input_stream_value; do
    grep -q "extern void ${external}(" "${tmpdir}/via_passthrough.c"
    if grep -Eq "^void ${external}\\(" "${tmpdir}/via_passthrough.c"; then
        echo "external operation unexpectedly has an implementation: ${external}" >&2
        exit 1
    fi
done

grep -q 'observe_map_sync(1, dma_addr, dma_len)' \
    "${repo_root}/tools/devilang/related-work/via_passthrough_mmio_dma.state"
grep -q 'observe_map_sync(2, dma_addr, dma_len)' \
    "${repo_root}/tools/devilang/related-work/via_passthrough_mmio_dma.state"
grep -q 'observe_map_sync(3, dma_addr, dma_len)' \
    "${repo_root}/tools/devilang/related-work/via_passthrough_mmio_dma.state"
grep -q 'dma_event(op=alloc' \
    "${repo_root}/tools/devilang/related-work/via_passthrough_mmio_dma.state"
grep -q 'dma_event(op=alloc' \
    "${repo_root}/tools/devilang/related-work/via_emulation_mmio_dma.state"

for builtin in \
    ignore_driver_mmio_write \
    ignore_driver_pio_write \
    ignore_driver_to_device_dma \
    fill_mutated_dma_payload; do
    grep -q "call ${builtin}" \
        "${repo_root}/tools/devilang/related-work/via_passthrough_mmio_dma.state"
    if grep -Eq "^extern void ${builtin}\\(" "${tmpdir}/via_passthrough.c"; then
        echo "builtin unexpectedly has an external declaration: ${builtin}" >&2
        exit 1
    fi
done

if sed -n '/trace initialize_driver/,/trace intercept_mmio_read/p' \
    "${repo_root}/tools/devilang/related-work/via_passthrough_mmio_dma.state" |
    grep -q 'read32'; then
    echo "driver initialization unexpectedly contains an MMIO/PIO read" >&2
    exit 1
fi

grep -q 'emulated_mmio_write' "${tmpdir}/via_emulation.c"
grep -q 'observe_map_sync(1, dma_addr, dma_len)' \
    "${repo_root}/tools/devilang/related-work/via_emulation_mmio_dma.state"
grep -q 'data_kind=any' \
    "${repo_root}/tools/devilang/related-work/via_emulation_mmio_dma.state"
for external in observe_map_sync emulated_mmio_read emulated_mmio_write \
    emulated_pio_read emulated_pio_write emulated_dma_to_device \
    emulated_dma_from_device; do
    grep -q "extern void ${external}(" "${tmpdir}/via_emulation.c"
done
if grep -Eq 'data_type=|data_field=' \
    "${repo_root}/tools/devilang/related-work/via_emulation_mmio_dma.state"; then
    echo "emulation model overclaims payload schemas or invented processing APIs" >&2
    exit 1
fi

printf '%s\n' "VIA passthrough and emulation Devilang models compiled successfully"
