# Drifuzz Golden-Seed Device Interface Model

This model covers Zekun Shen, Ritik Roongta, and Brendan Dolan-Gavitt,
“Drifuzz: Harvesting Bugs in Device Drivers from Golden Seeds,” USENIX
Security 2022.

Paper: <https://www.usenix.org/system/files/sec22-shen-zekun.pdf>

Drifuzz runs an emulated PCI or USB peripheral, but does not implement its
device behavior. QEMU forwards MMIO/PIO reads to the fuzzer and ignores
writes. Consistent DMA is registered as an MMIO region at allocation;
streaming DMA is filled with fuzzing input when deallocated. Interrupts are
periodically triggered for PCI fuzzing. Device identifiers and the emulated
peripheral setup are external control-plane operations.

The model intentionally leaves buffers untyped and does not invent a device
state machine.

## Verification

```sh
tools/devilang/related-work/test-drifuzz-model.sh
```
