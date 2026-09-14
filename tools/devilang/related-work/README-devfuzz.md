# DevFuzz Device-Interface Model

This directory contains a neutral Devilang re-framing of:

> Yilun Wu, Tong Zhang, Changhee Jung, and Dongyoon Lee, "DevFuzz:
> Automatic Device Model-Guided Device Driver Fuzzing," IEEE Symposium on
> Security and Privacy, 2023.

Paper:
<https://www3.cs.stonybrook.edu/~dongyoon/papers/SP-23-DevFuzz.pdf>

The state file describes the device-interface behavior exposed by DevFuzz.
It does not model symbolic execution, model selection, coverage, or fuzzer
feedback.

## Model

DevFuzz has two relevant input classes:

- probe accesses use values from a learned probe model;
- post-probe accesses use generic mutated input.

The probe model is represented by the external
`return_probe_model_value(value, length)` signal. It is not marked random:
the paper describes values learned for a particular driver path. Generic
post-probe reads use `return_input_stream_value(value, length)`.

MMIO and PIO reads and writes are separate traces. The address is `unknown`
because DevFuzz discovers the driver's accesses rather than requiring a
fixed register catalog. Driver writes are ignored by the abstract model.

DMA follows the paper's two API cases. Consistent (coherent) allocations use
an external allocation signal and `dma_event(op=alloc)`. Streaming buffers use
an external map signal and `dma_event(op=map)`. These events are an
interface-level description of the paper's DMA-API distinction; the released
runtime does not expose direct `dma_alloc_coherent`/`dma_map_single` callbacks.
Instead, `Stage2HWModel::captureDMARegistration()` records DMA addresses from
MMIO writes, `scanSecondaryDMABuffer()` discovers descriptor-referenced
regions, and `feedFuzzDMAData()` writes the fuzzer bytes to the resulting
scatter-gather list. No payload schema is inferred, and no unmap-time fill is
claimed.

The post-probing timer path is an externally selected interrupt. In the
released source, `ti_worker()` calls `ap_trigger_irq()` at the interval given
by `USE_IRQ`; `ap_trigger_irq()` first calls `ap_fill_dma_buffer()` and then
raises the IRQ with `sfp_set_irq(1)`. DevFuzz does not specify a fixed “every N
MMIO accesses” threshold (and the implementation has no 75-access rule):

```devilang
extern observe_interrupt_injection(irq_vector);
interrupt_event(vector=irq_vector);
call inject_interrupt(irq_vector);
```

Driver initialization and unload are lifecycle signals implemented outside
Devilang.

## Verification

```sh
tools/devilang/related-work/test-devfuzz-model.sh
```
