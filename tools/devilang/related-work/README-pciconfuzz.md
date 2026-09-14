# PCIconfuzz PCIe Configuration Model

This directory contains a neutral Devilang re-framing of:

> Kyungwook Boo and Byoungyoung Lee, "Finding Device Driver Bugs With
> Fuzzing PCIe Configuration Input," IEEE Access, 2025.

Paper:
<https://doi.org/10.1109/ACCESS.2025.3596641>

The model focuses on PCIe configuration input and the driver's probe path.
It does not model DMA, Redqueen, coverage, or crash processing.

## Model

Enumeration reads a concrete PCI identity, class value, and BAR value so the
endpoint can be discovered and the driver can bind. These reads use
`return_concrete_value(value, length)`. The exact values are device-specific;
the model's values are placeholders, not a universal device definition.

Probe reads use `return_input_stream_value(value, length)`, including
configuration, capability-chain, BAR, and BAR-backed MMIO values. This
represents the fuzzed configuration stream; it does not claim that the
values are random, constants, or enums without a driver-specific constraint.
The paper explicitly excludes DMA modeling.

MMIO reads and writes are separate. Probe writes are ignored by the abstract
device model. The interrupt responsiveness check is modeled as a driver MMIO
write followed by the virtual device's interrupt response; the paper states
that the virtual device triggers an interrupt upon receiving that write.

Snapshot and restore are external harness signals. They establish the
repeated probe boundary but are not device state transitions.

## Verification

```sh
tools/devilang/related-work/test-pciconfuzz-model.sh
```
