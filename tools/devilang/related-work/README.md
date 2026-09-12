# Related-Work Device-Interface Models

This directory contains Devilang re-framings of device-interface behavior
from related research papers. The models focus on the interface events that
matter to Devilang:

- MMIO and PIO reads and writes;
- DMA mapping, synchronization, data movement, and unmapping;
- interrupt events and delivery;
- external driver and harness signals.

They do not attempt to encode a paper's security threat model, exploit
classification, driver code coverage, or fuzzer feedback mechanism unless
that information is directly needed to describe one of these interface
events.

## Modeling Principles

### Describe interface behavior, not every implementation detail

The model records what crosses the driver/device boundary. It does not
reconstruct the complete driver implementation or invent a device protocol
that the paper does not establish.

States are used only when they clarify an interface lifecycle or a
paper-defined device behavior. A passthrough model can therefore be
stateless with respect to the device while still describing driver
initialization, active interaction, and unload.

### Separate direction and access type

MMIO and PIO are modeled as separate conceptual channels. Reads and writes
are always separate operations:

```devilang
value = read32(address);
write32(value, address);
```

For generic interception, `unknown` means that the model does not impose a
protocol-level address constraint. It does not erase the distinction between
read and write, or between access widths.

When a driver path has a deterministic register address, the model should
use that address instead. Interrupt status and acknowledge registers are
typical examples. If the address is inferred from driver analysis rather
than specified by the paper, the model must mark it as an analysis-derived
synthetic value.

### Distinguish external signals, events, and actions

The model uses three layers:

```text
extern signal
    -> Devilang event
    -> built-in action
```

`extern` is reserved for operations implemented by the harness, Library OS,
DMA layer, or another integration component. Devilang emits a C prototype
but does not implement these operations.

An event describes an interface occurrence in the model. A built-in action
describes an operation whose semantics are provided by Devilang.

For example, interrupt injection is represented as:

```devilang
extern observe_interrupt_injection(vector);
interrupt_event(vector=vector);
call inject_interrupt(vector);
```

The external signal says that the scheduler selected the injection. The
event records the interrupt. The built-in action delivers it to the driver.
The interrupt handler is a separate trace.

### Treat input sources explicitly

Values supplied by a mutator or serialized input stream should be identified
at the point where the driver observes them:

```devilang
value = read32(address);
extern return_input_stream_value(value, 4);
```

The read itself consumes the value by default. The explicit external signal
records its source and byte length. This avoids adding a redundant
``consume`` call and avoids confusing input supply with fuzzer feedback.

The model does not assume that a random input value is a constant or an enum.
Use constants and finite choices only when the driver/device contract or
paper establishes such a constraint.

### Model DMA in layers

DMA needs more structure than a generic MMIO or PIO access. A DMA operation
is represented by:

1. an external observation of the DMA API operation;
2. a `dma_event` describing operation, direction, path, address, and length;
3. a data action such as `fill` or `ignore`.

Example:

```devilang
extern observe_map_sync(1, dma_addr, dma_len);
dma_event(
    op=map,
    dir=from_device,
    path=dma_api,
    addr=dma_addr,
    len=dma_len,
    data_kind=any
);
call fill_mutated_dma_payload(dma_addr, dma_len);
```

The operation code is part of the external integration contract. In the VIA
passthrough model, `1` means `map`, `2` means `sync_for_cpu`, and `3` means
`unmap`.

DMA mapping is a lifecycle, not an isolated data transfer:

```text
map
    -> sync
    -> fill or ignore
    -> unmap
    -> buffer cleanup
```

The `dma_event` and external observation are intentionally separate. The
former is Devilang's event description; the latter reports what an external
DMA implementation observed.

### Do not infer payload schemas without evidence

`data_type` and `data_field` are Devilang schema annotations. They should be
used only when the source paper or driver analysis supports a concrete
payload type and field.

For an untyped passthrough buffer, use:

```devilang
data_kind=any
```

Do not label it as an Ethernet frame, descriptor, or protocol structure just
because the surrounding device happens to use one in a different model.

### Keep passthrough and emulation distinct

Passthrough and emulation describe different responsibilities:

```text
passthrough:
    forward or supply intercepted values
    ignore driver-to-device effects

emulation:
    interpret writes
    update device behavior
    produce DMA results
    raise interrupts from device state
```

A passthrough model should not acquire a speculative device state machine
merely because the corresponding emulation model has one.

## Models

| Model | Description |
| --- | --- |
| [VIA](README-via.md) | VIA passthrough and emulation device-interface models |
| [VIA passthrough](via_passthrough_mmio_dma.state) |
  Intercepted MMIO/PIO/DMA and externally selected interrupt injection |
| [VIA emulation](via_emulation_mmio_dma.state) |
  Stateful emulated MMIO/DMA behavior and device-side interrupts |
| [DevFuzz](README-devfuzz.md) | Automatic device-model behavior |
| [DevGen](README-devgen.md) | LLM-generated virtual-device behavior |
| [DrFuzz](README-drfuzz.md) | Device-free driver validation |
| [PCIconfuzz](README-pciconfuzz.md) |
  PCIe configuration and interrupt-related behavior |
| [PrIntFuzz](README-printfuzz.md) | Automated virtual-device simulation |
| [VirtFuzz](README-virtfuzz.md) | Universal VirtIO device behavior |

## Verification

Run the model-specific tests:

```sh
for script in tools/devilang/related-work/test-*-model.sh; do
    bash "${script}"
done
```
