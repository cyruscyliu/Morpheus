# VirtFuzz Universal VirtIO Model

This directory contains a neutral Devilang re-framing of:

> Soenke Huster, Matthias Hollick, and Jiska Classen, "To Boldly Go Where
> No Fuzzer Has Gone Before: Finding Bugs in Linux' Wireless Stacks through
> VirtIO Devices," IEEE Symposium on Security and Privacy, 2024.

Paper:
<https://www.uni-goettingen.de/de/document/download/6b0d1e9d8e2fb7f57cc1a2fab1b071e7.pdf/huster_S%26P24.pdf>

The model describes the universal VirtIO device interface. Proxy traffic,
seed collection, mutation, coverage, comparison observation, and crash
deduplication are outside the state file.

## Models

The two runtime configurations are represented separately:

* `virtfuzz_fuzzing.state`: LibAFL seed/mutated input fills the RX buffer.
* `virtfuzz_proxy.state`: RX data comes from the external device through the
  proxy.

Both configurations share the QEMU VirtIO transport behavior. The legacy
interface view is intentionally not retained as a third model.

## Model

The transport exposes concrete device identity and feature values, queue
selection/setup writes, queue notifications, and opaque DMA buffers. Device
identity and negotiated feature reads use `return_concrete_value(value,
length)`. The model does not invent device-specific emulation: the paper says
the universal device “does not need to implement device-specific behavior”.

VirtFuzz's buffers are VirtIO virtqueue scatter-gather buffers forwarded by
QEMU. They are not Linux `dma_alloc_coherent` allocations and are not
streaming DMA-API mappings. The model therefore records them as abstract
physical-buffer events, without adding allocation or synchronization claims.

Virtqueue buffers are untyped. Device-to-driver buffers use:

```text
buffer event -> fill_mutated_dma_payload
```

Driver-to-device buffers use:

```text
buffer event -> ignore_driver_to_device_dma
```

The corresponding unmap and external buffer cleanup are explicit. No
`data_type` or `data_field` is inferred for a VirtIO frame.

The interrupt handler reads and acknowledges status separately. Interrupt
scheduling is outside this universal buffer-forwarding model.

## Verification

```sh
tools/devilang/related-work/test-virtfuzz-model.sh
```
