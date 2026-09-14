# DevGen Virtual-Device Interface Model

This directory contains a neutral Devilang re-framing of:

> Mingyu Wang et al., "Bridging Kernel Drivers and Virtual Device Models
> with LLM-Powered Automation," ACL 2026.

Paper:
<https://aclanthology.org/2026.acl-demo.24.pdf>

DevGen's source analysis, LLM synthesis, compilation, repair loop, and
deployment are outside the device-interface state. The state file describes
the interface implemented by the generated virtual device.

## Model

The generated device exposes:

- concrete PCI identity and BAR reads;
- generated MMIO reads and writes;
- generated interrupt status and acknowledgement;
- externally selected interrupt delivery;
- external driver and generated-model lifecycle signals.

PCI identity and BAR values use `return_concrete_value(value, length)`.
This expresses a fixed device configuration, not a random input or a finite
enum. Values that the generated device computes use
`return_generated_device_value(value, length)`. A separate
`generated_mmio_input` trace shows where generic input can be supplied when
the generated model leaves a read unconstrained.

Writes are not marked as ignored. DevGen generates device-side behavior for
writes, so each write is followed by the external generated-device handler.
The paper does not define a universal register state machine or a universal
MMIO value; those details are synthesized from the target driver's extracted
context and repaired using compiler/runtime feedback.

Interrupt delivery is represented in three layers: an external scheduler
signal, `interrupt_event`, and the built-in `inject_interrupt` action.

## Verification

```sh
tools/devilang/related-work/test-devgen-model.sh
```
