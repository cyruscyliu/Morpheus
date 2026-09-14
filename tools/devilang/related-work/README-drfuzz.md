# DrFuzz Device-Input Model

This directory contains a neutral Devilang re-framing of:

> Wenjia Zhao, Kangjie Lu, Qiushi Wu, and Yong Qi, "Semantic-Informed Driver
> Fuzzing Without Both the Hardware Devices and the Emulators," NDSS 2022.

Paper:
<https://www.ndss-symposium.org/wp-content/uploads/2022-345-paper.pdf>

The authors' implementation is openly available at
<https://github.com/secsysresearch/DRFuzz>. It is a patch-based
LLVM/KVM/QEMU integration, not a standalone device emulator.

DrFuzz supplies device-related input directly to a driver without requiring
a physical device or a complete emulator. The state file describes the
device-input reads and the ordering of the validation chain.

## Model

The adaptor intercepts MMIO and PIO reads and supplies fuzzer-generated values
from the input stream. Writes are forwarded to the adaptor but have no
device-side model, so the passthrough action ignores them.

When a target driver uses streaming DMA, the model represents the adaptor
observation with an external signal plus `dma_event(op=map)`; device-to-driver
buffers are filled and driver-to-device buffers are ignored. When a target
driver uses coherent DMA, the same signal pattern is represented with
`dma_event(op=alloc)`, without explicit synchronization. The DrFuzz paper does
not claim a universal DMA API choice, so these are interface alternatives,
not a claim that every DrFuzz target exercises both. Both paths remain
untyped (`data_kind=any`).

Open, ioctl, read, write, driver initialization, and unload are external
control-plane signals. DrFuzz does not redirect them to a QEMU virtual device;
the QEMU adaptor is only the fake I/O/DMA/interrupt boundary. Validation
reporting and coverage feedback are intentionally absent.

## Implementation check

In `Fuzzer/QEMU-PT/pt/interface.c`, the adaptor creates shared-memory BARs
for the program and payload. In `Fuzzer/QEMU-PT/pt/hypercall.c`,
`KVM_EXIT_KAFL_GET_PAYLOAD` and `KVM_EXIT_KAFL_NEXT_PAYLOAD` copy fuzzer data
into guest memory through `write_virtual_memory`. The repository contains no
`dma_alloc_coherent`, `dma_map_*`, or DMA synchronization hook, and its
`irq_filter` property is empty. Therefore the model's DMA and interrupt
entries describe the paper's adaptor interface, rather than a concrete Linux
DMA implementation supplied by the repository.

## Verification

```sh
tools/devilang/related-work/test-drfuzz-model.sh
```
