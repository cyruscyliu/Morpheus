# PrIntFuzz Device Model

This directory contains a neutral Devilang re-framing of the device
simulation described by Ma et al. in:

> Zheyu Ma et al., "PrIntFuzz: Fuzzing Linux Drivers via Automated Virtual
> Device Simulation", ISSTA 2022.

Paper:
<https://doi.org/10.1145/3533767.3534226>

The model describes device-interface behavior and the external orchestration
signals needed to drive it. It does not encode exploit construction,
vulnerability classes, coverage feedback, or a security threat model.

## Model dimensions

PrIntFuzz models a virtual device using three information dimensions:

- **Data space**: values returned by device reads and constraints needed for
  probing to continue.
- **I/O and memory space**: MMIO or mapped resource regions used by the driver.
- **Configuration space**: identifiers and device configuration read during
  discovery.

The paper also describes runtime actions outside the device interface:

- injecting device data into registered DMA regions;
- raising an interrupt for a selected virtual device;
- coordinating those actions with system calls;
- injecting faults at selected initialization API calls.

The Devilang mapping is:

| PrIntFuzz concept | Devilang representation |
| --- | --- |
| Data-space read | `read32` assignment, optional `neqj` constraint, and
  explicit input-source signal when data is mutated |
| Read-order dependence | Ordered instructions in a trace |
| MMIO/I/O region | `op ... mmio` |
| PCI configuration space | MMIO ops with a configuration region |
| Coherent DMA allocation signal | `extern observe_dma_event(...)` plus
  `dma_event(op=alloc, ...)` |
| DMA data injection | Built-in `fill_mutated_dma_payload(...)` after a
  `from_device` allocation |
| Driver-to-device DMA | `dma_event(... dir=to_device ...)` plus built-in
  `ignore_driver_to_device_dma(...)` |
| Interrupt request | External observation, `interrupt_event`, and built-in
  `inject_interrupt` |
| Interrupt handler | Fixed status/ack MMIO accesses followed by DMA sync or
  unmap |
| Initialization fault position | External
  `inject_initialization_fault(...)` signal |
| User interaction | Separate `external_user_*` traces containing only
  external syscall signals |

PCI, fault, and user-system-call operations are integration boundaries in
this model. They are represented with `extern`; they are not confused with
MMIO, DMA, or interrupt events.

## Behavioral outline

```text
reset
  -> probe_vendor
  -> probe_device
  -> probe_resources
  -> ready
  -> waiting_irq
  -> irq_handled
```

The probe traces preserve the paper's flow-sensitive ordering requirement:
vendor and device identity are read before resources are configured. A
successful configuration then enables normal user interaction.

The interrupt traces represent the paper's active virtual-device behavior.
The external interrupt request, `interrupt_event`, and built-in injection are
separate. The handler then performs the modeled status/ack MMIO accesses.

The fault-position trace represents an external initialization-fault request.
It does not fabricate a device error or add a fault state machine.

The user-system-call traces are intentionally separate from device behavior.
They record that the external coordinator invoked open, ioctl, read, or write;
they do not turn those calls into MMIO or DMA operations.

## Verification

Run:

```sh
tools/devilang/related-work/test-printfuzz-model.sh
```
