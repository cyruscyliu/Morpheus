# VIA Device-Interface Model

This directory contains a Devilang re-framing of the device-interface
interaction described by Hetzelt et al. in:

> Felicitas Hetzelt et al., "VIA: Analyzing Device Interfaces of Protected
> Virtual Machines", arXiv:2109.10660.

The model is intentionally about device behavior and interface ordering. It
does not encode the paper's threat model, exploit classes, or security
findings.

## Re-framing

The paper describes a driver and a virtual device communicating through three
observable channels:

1. MMIO or PIO carries control and configuration operations.
2. DMA carries descriptor and payload buffers.
3. Interrupts notify the driver that device-side work is available.

The Devilang model represents these channels as follows:

| Paper concept | Devilang representation |
| --- | --- |
| Device specialization | Synthetic addresses in the interaction traces |
| MMIO register access | `read32` and `write32` in interaction traces |
| Streaming DMA map/sync/unmap | `dma_event` with `map`, `sync_*`, and `unmap` |
| Coherent DMA access | `dma_event` with `map` and `bidirectional`/`from_device` |
| Device notification | Emulation-only queue notification write |
| Interrupt injection | External observation,
  `interrupt_event`, and built-in `inject_interrupt` |
| DMA map/sync observation | External signal
  `observe_map_sync` in the DMA traces |
| DMA unmap observation | `dma_event(op=unmap)` followed by the external
  `unmap_passthrough_dma_buffers` signal in `external_dma_unmapped` |
| Driver unload observation | External entry trace
  `external_driver_unloaded` |
| External operation declaration | Top-level `extern name;` declaration |
| External signal occurrence | `extern name(args);` inside an entry trace |
| Passthrough behavior | Separate interception traces for read and write |
| Emulated behavior | `notify_*` followed by an `irq_*_emulated` trace |

The core grammar has a first-class `interrupt_event(vector=...)` instruction.
The interrupt injection trace still remains an entry trace because the
external scheduler selects when it is activated. Its body separates the
external observation, the interrupt event, and the built-in injection action.
The handler remains a separate trace that records the MMIO and DMA
observations made after delivery.

## Models

VIA is split into two independent models:

- `via_passthrough_mmio_dma.state`
- `via_emulation_mmio_dma.state`

Both use a small VirtIO-like device because it provides all three channels
without adding non-grammar extensions.

### Passthrough

`via_passthrough_mmio_dma.state` models PCI and Platform passthrough:

- device-to-driver MMIO and PIO reads match any address at the observed
  access width and are supplied from the fuzzer input;
- driver-to-device MMIO and PIO writes match any address at the observed
  access width, then are intercepted and ignored;
- driver-to-device DMA is intercepted but not interpreted;
- device-to-driver DMA is matched as an untyped buffer, with bytes supplied
  from VIA's mutated serialized input stream and filled at the CPU
  synchronization point;
- interrupt delivery is initiated by the harness.

This model does not claim that VIA constructs a formal device state machine.
Its states describe only driver lifecycle phases: initialization, interaction,
and uninitialization. DMA mapping observations and interrupt injection are
external signals and do not represent device state transitions. The paper's
device-side passthrough behavior is deliberately stateless. The generic
passthrough interception traces therefore use `unknown` for the address
expression. This is address fuzziness, not value fuzziness: the runtime still
distinguishes read from write and checks the access width. The interrupt
handler is different: its status and acknowledge registers are deterministic
for a given driver/device pair, so `handle_interrupt` uses fixed,
analysis-derived offsets. VIA does not specify those offsets; the `0x60` and
`0x64` values in this example are synthetic placeholders that should be
recovered from the target driver's interrupt path. The current event format
does not carry a separate MMIO-versus-PIO bus tag, so the model keeps those
operations as separate conceptual traces while matching their observed event
direction and width.

Its driver lifecycle is:

```text
driver_uninitialized
  -> driver_initialized
  -> interaction_active
  -> stopped
```

The driver unload and DMA unmap events are external lifecycle observations.
They are not modeled as device-side passthrough operations.

The `extern` declarations are intentional integration boundaries. Devilang
emits only C `extern` prototypes for these operations; it does not provide
their implementations. The harness or Library-OS supplies them:

- `initialize_driver` and `unload_driver` perform the external driver
  lifecycle operations issued by the harness;
- `return_input_stream_value` supplies the next serialized input bytes as the
  return value of an intercepted MMIO/PIO read;
- the built-in `ignore_driver_mmio_write`,
  `ignore_driver_pio_write`, and `ignore_driver_to_device_dma` actions record
  that passthrough discards driver-to-device data;
- the built-in `fill_mutated_dma_payload` action supplies the mutated bytes
  for a device-to-driver DMA transfer;
- `observe_map_sync(op, dma_addr, dma_len)` reports that the external DMA
  layer observed a DMA API operation. Its operation codes are `1` for `map`,
  `2` for `sync_for_cpu`, and `3` for `unmap`;
- `unmap_passthrough_dma_buffers` performs the external passthrough DMA
  buffer cleanup after the corresponding `dma_event(op=unmap)`;
- `observe_interrupt_injection` reports that the external scheduler selected an
  interrupt injection;
- `interrupt_event(vector=...)` records the interrupt event in the trace;
- the built-in `inject_interrupt(...)` actively delivers the interrupt;

These signals do not advance the passthrough device model. In particular,
`observe_map_sync` is the external DMA-layer observation, while `dma_event`
describes the corresponding DMA operation and its direction. The two appear
together in the DMA traces, followed by the external `fill` or `ignore`
operation. The unmap trace records its `dma_event(op=unmap)`, the matching
`observe_map_sync(3, ...)`, and then the external buffer cleanup. Interrupt
injection is different from the
interrupt-handler trace that consumes the resulting MMIO status. The external
observation and the built-in injection action are intentionally separate:
the former is supplied by the harness, while the latter is a Devilang action.

### Emulation

`via_emulation_mmio_dma.state` models a stateful emulated device:

- driver-to-device writes are interpreted by named emulation calls;
- queue notification leads to device-side processing;
- device processing updates DMA-visible data;
- device state raises TX or RX interrupts;
- the driver then reads and acknowledges the interrupt.

Its transmit flow is:

```text
reset
  -> configured
  -> tx_submitted
  -> tx_processing
  -> tx_irq_pending
  -> configured
```

The receive flow is:

```text
configured
  -> waiting_rx
  -> rx_processing
  -> rx_irq_pending
  -> rx_ready
```

The emulation model has a separate stateful device-side flow. Its automatic
interrupt is represented as the explicit `raise_*_interrupt` device event
trace, while the passthrough model uses `interrupt_event` for externally
selected injection.

### Input value sources

The passthrough model distinguishes the source of each value:

| Value | Source |
| --- | --- |
| Generic MMIO/PIO addresses and interrupt marker | Synthetic trace constants
  or `unknown` for generic interception |
| Interrupt status/ack addresses | Fixed offsets inferred from the target
  driver's interrupt path; synthetic in this VIA example |
| MMIO read return value | Mutated libFuzzer byte stream |
| PIO read return value | Mutated libFuzzer byte stream |
| Device-to-driver DMA payload | Untyped bytes from VIA's mutated serialized
  input stream |
| Driver MMIO/PIO writes | Driver-generated value, then ignored |
| Driver-to-device DMA contents | Driver-generated buffer, not interpreted |
| Interrupt delivery | External observation followed by
  `interrupt_event` and built-in `inject_interrupt` |

The paper describes serialized input bytes consumed as device-to-driver memory
transfers. Reads consume their input by default. VIA does not infer a semantic
payload type such as an Ethernet frame from the DMA buffer. The
`extern return_input_stream_value(value, length)` signal identifies the value returned
by a particular read and the number of bytes consumed from the serialized
stream. The length is expressed in bytes, so a `read32` uses `4`. The
The built-in `fill_mutated_dma_payload` action identifies the bytes supplied
to a device-to-driver DMA transfer. It is an implemented Devilang operation,
not an external signal. These are data-supply actions, not
coverage feedback operations. The paper does not define a general semantic
enum for passthrough register responses. A finite enum should only be
introduced for a device-specific protocol constraint; it would not accurately
describe VIA's generic passthrough input. The passthrough DMA events therefore
use `data_kind=any` and omit `data_type` and `data_field`. Those fields are
Devilang schema annotations, not fields inferred or emitted by VIA.

`initialize_driver` is intentionally not a sequence of synthetic MMIO/PIO
reads. In VIA, the harness invokes driver initialization through the Linux
system-call interface. The resulting MMIO/PIO reads occur in the separate
interception traces as the driver executes. This keeps the syscall, the
interception event, and the external input-supply signal distinct.

The passthrough model does not attach a payload schema to either DMA
direction. Driver-to-device DMA is ignored, while device-to-driver DMA is
filled by the external mutated input source. Passthrough does not interpret
either buffer as a protocol-level object.

Both models show the relevant DMA lifecycle:

- descriptor and packet buffers are mapped before device use;
- streaming buffers are synchronized for the device and CPU;
- device-produced data is observed as `from_device`;
- completion is followed by unmapping.

This is a behavioral abstraction, not a complete VirtIO specification. It
does not claim that every driver uses the same register sequence or DMA
lifetime.

## Verification

Compile both models with:

```sh
tools/devilang/related-work/test-via-model.sh
```
