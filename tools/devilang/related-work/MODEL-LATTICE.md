# Related-Work Model Lattice

This document compares the current Devilang re-framings. It is a comparison
of the models we wrote, not a ranking of the papers' security contributions or
fuzzing effectiveness.

## 1. What "Progress" Means

A model is not better merely because it has more states, more fields, or a
newer publication date. We compare observable device-interface behavior.

Let a model be a tuple:

```text
M = (C, R, W, D, I, S, X)
```

where:

- `C` is the set of interface channels;
- `R` is the read-value source information;
- `W` is the write-side semantics;
- `D` is the DMA lifecycle and direction information;
- `I` is interrupt generation and delivery information;
- `S` is ordering or device-state information;
- `X` is the external-signal boundary.

For two models with the same target scope, define:

```text
A <= B
```

when every observable behavior expressed by `A` is preserved by `B`, and `B`
adds at least one interface distinction or constraint. This is the
refinement/progress relation.

The relation is deliberately conservative:

- replacing a concrete value with an unconstrained input is not progress;
- replacing an interpreted write with an ignored write is a regression;
- adding a state that does not correspond to an interface lifecycle is not
  progress;
- adding coverage, corpus, repair, or fuzzer-feedback states does not count;
- different device scopes can be incomparable even when one has more fields.

The models form a product lattice only after their dimensions are normalized.
The order is component-wise:

```text
(C1, R1, W1, D1, I1, S1, X1) <=
(C2, R2, W2, D2, I2, S2, X2)
```

means that every component on the right refines the corresponding component
on the left.

## 2. Dimension Orders

### Channels `C`

Channels are sets, ordered by inclusion:

```text
MMIO, PIO, PCI-config, DMA, IRQ
```

PCI configuration is listed separately because it has a different role in the
papers, even though the current grammar represents it with memory operations.

### Read sources `R`

The useful source distinctions are ordered by information preservation:

```text
unclassified
  < input-stream
  < constrained-input
```

The following sources are orthogonal specializations rather than one linear
order:

```text
concrete-device-value
probe-model-value
generated-device-value
```

For example, a probe-model value is not "more random" than an input-stream
value. It carries a different provenance and should be compared as a labeled
source.

### Write semantics `W`

```text
absent
  < observed/ignored
  < interpreted device-side write
```

An ignored write still records direction, width, address matching, and the
fact that the driver's effect is discarded. It is therefore stronger than no
write model, but weaker than an emulated write.

### DMA `D`

The lifecycle order is:

```text
absent
  < map
  < map + direction
  < map + sync + data action
  < map + sync + data action + unmap/cleanup
```

The data action is labeled, not ranked:

```text
fill_mutated_dma_payload
ignore_driver_to_device_dma
device-side emulation
```

`data_kind=any` is the correct top-level representation when the paper does
not establish a payload schema. A guessed schema is not a refinement.

The lifecycle order above is about *observable DMA phases*.  The *hook layer*
(where those phases are intercepted) is orthogonal.  See Section 3.5 for the
per-model hook implementation.

### Interrupts `I`

```text
absent
  < handler observation
  < externally selected injection
  < device-side generated interrupt
```

The last two are different sources. An emulation model with a device-side
interrupt is not automatically a refinement of a passthrough model with an
external interrupt scheduler.

### Ordering and state `S`

```text
event-only
  < lifecycle/order
  < protocol state machine
```

This dimension only increases when the additional state constrains or
explains interface traces. Workflow states for compilation, coverage,
mutation, or repair are outside this order.

### External boundary `X`

`X` is a set of separately implemented operations. Useful labels include:

```text
driver lifecycle
syscall
DMA observation/cleanup
input source
snapshot/restore
interrupt scheduler
```

The order is set inclusion only when the additional signal is an actual
interface boundary and does not duplicate a Devilang event.

## 3. Current Feature Vectors

Notation:

- `M`, `P`, `PCI`, `D`, `I` mean MMIO, PIO, PCI configuration, DMA, and IRQ;
- `S` means serialized input stream;
- `K` means constrained input;
- `C` means concrete value;
- `PM` means learned probe-model value;
- `G` means generated-device value;
- `O` means observed/ignored write;
- `T` means interpreted device-side write;
- `H` means handler only;
- `E` means externally injected interrupt;
- `V` means device-side generated interrupt;
- `L` means lifecycle/order state;
- `Q` means protocol/queue state;
- `F` means full DMA lifecycle;
- `-` means absent.

| Model | `C` | `R` | `W` | `D` | `I` | `S` |
| --- | --- | --- | --- | --- | --- | --- |
| DrFuzz | M* | S | - | F | - | L |
| PCIconfuzz | M, PCI | C, S | O | - | H | L |
| DevFuzz | M, P | PM, S | O | F | E | L |
| PrIntFuzz | M, PCI | C, S | O | F | E | L |
| VirtFuzz | M | C, S | O | F | E | Q |
| DevGen | M, PCI | C, G, S | T | - | E | L |
| VIA passthrough | M, P | S | O | F | E | L |
| VIA emulation | M | G | T | F | V | Q |

`M*` means device-related input reads in a device-free validation model. It
does not claim that DrFuzz provides a physical MMIO interception layer.

The `X` component is intentionally omitted from the compact table because it
is best read from the state files. All revised models keep lifecycle,
input-source, or DMA/interrupt integration signals separate from interface
events where the paper requires them.

### 3.5 DMA hook implementation vectors

This table complements the `D` column.  `D` says which DMA lifecycle phases
are modeled; this table says *where* the fuzzer observes or injects them.

| Model | Hook layer | Coherent DMA | Streaming DMA | Driver-to-device handling | Evidence quality |
| --- | --- | --- | --- | --- | --- |
| Drifuzz | Kernel DMA API + QEMU PCI command channel | `dma_alloc_attrs`/`dma_free_attrs` call `handle_const_dma_init/exit` | Declared; `STREAM_DMA_EXIT` fills buffer in QEMU | Consistent writes go to device mem; USB stream ignored | Full code |
| VIA | LKL wrapper / kernel access interface | Allocation event → fill at alloc | `map`/`sync_for_cpu`/`unmap` events → fill at sync | Ignored | Paper + model only |
| DrFuzz | VMM hypercall + shared payload | None | None | Same payload region reused | README + partial code |
| DevFuzz | QEMU-side MMIO write interception | None | DMA address inferred from MMIO write | Not tracked / ignored | Full code |
| PrIntFuzz | Kernel inline + host KVM hypercall | `dma_alloc_coherent` → `KVM_HC_ALLOC_DMA` | `KVM_HC_PREPARE_DATA` injects guest DMA buffer | Explicitly ignored in fake device | QEMU + Linux patches |
| VirtFuzz | VirtIO virtqueue layer | N/A (virtqueue buffers) | N/A | Forwarded to socket | QEMU patch + Rust code |
| PCIconfuzz | None | None | None | None | Paper only |
| DevGen | None | None | None | None | Paper + model only |

Hook-layer shorthand used below:

- `K` = kernel DMA API hook (`dma_alloc_*` / `dma_map_*`);
- `V` = VMM hypercall / QEMU command channel;
- `M` = MMIO-derived DMA address capture;
- `T` = transport / packet / payload layer;
- `-` = absent.

## 4. What the Table Says

There is no valid total order over the current models.

The current set is mostly an antichain:

- **DrFuzz** adds semantic validation order, but has no interrupt model and
  only a device-free input abstraction.  Its DMA path is a transport/payload
  injection (`T`) rather than a DMA lifecycle hook.
- **PCIconfuzz** adds concrete-versus-fuzzed PCI configuration phases and
  snapshot boundaries, but has no DMA lifecycle or DMA hook.
- **DevFuzz** adds both PIO and DMA to MMIO and learns a distinct probe-value
  source.  Its DMA hook is MMIO-derived (`M`); it does not modify the kernel
  DMA API.
- **PrIntFuzz** adds concrete configuration, DMA, and interrupt injection.
  Its DMA hook is kernel-DMA-API plus VMM hypercall (`K+V`).  It does not
  provide PIO in the current paper-specific model.
- **VirtFuzz** adds a queue-oriented protocol state and full opaque DMA
  movement, but is specialized to the universal VirtIO transport.  Its hook
  is the virtqueue transport layer (`T`).
- **DevGen** adds generated device-side write/read semantics and generated
  device values, but does not model DMA in this re-framing.
- **VIA passthrough** has broad interception coverage and explicit external
  DMA/interrupt integration, but intentionally does not interpret writes.
  Its DMA hook is an LKL/kernel access-interface wrapper (`K`).
- **VIA emulation** adds device-side protocol state and generated behavior,
  but changes the responsibility boundary from passthrough to emulation.
  It keeps the same DMA hook layer as VIA passthrough.

Therefore, publication order does not establish:

```text
DrFuzz <= PCIconfuzz <= DevFuzz <= PrIntFuzz <= VirtFuzz <= DevGen
```

That chain is invalid. The rows improve different coordinates.

## 5. Meets and Joins

For normalized feature vectors:

```text
meet(A, B) = common observable behavior
join(A, B) = the least synthetic model containing both behaviors
```

Examples:

```text
meet(VIA-passthrough, DevFuzz)
    = generic MMIO/PIO interception
      + ignored driver writes
      + opaque DMA lifecycle
      + externally selected interrupt

join(PCIconfuzz, VirtFuzz)
    = concrete/fuzzed PCI configuration
      + VirtIO queue protocol
      + opaque DMA lifecycle
      + interrupt delivery
```

The join is not a claim that either paper implements the combined model. It
is a useful target specification for a future Devilang model.

For the two VIA models:

```text
meet(VIA-passthrough, VIA-emulation)
    = MMIO interaction
      + DMA lifecycle
      + interrupt handler

join(VIA-passthrough, VIA-emulation)
    = an explicit hybrid model with selectable passthrough/emulation
      responsibility
```

The join should not silently merge `ignore_driver_*` and emulated writes.
Those are alternative semantics and require a mode or separate traces.

## 6. Progress Checklist

When a new paper model is added, compare it in this order:

1. Does it add a genuinely new channel: PIO, PCI configuration, DMA, or IRQ?
2. Does it distinguish read from write and driver-to-device from
   device-to-driver direction?
3. Does it identify the value source as concrete, learned, generated, or
   serialized input?
4. Does it add a real DMA lifecycle: map, sync, fill/ignore, unmap?
5. Does it add or change a DMA hook layer (kernel API, VMM hypercall,
   MMIO-derived, transport/payload)?
6. Does it separate external observation from Devilang events and actions?
7. Does it add an interrupt source and delivery path?
8. Does its state constrain interface ordering, or only describe workflow?
9. Does it preserve every behavior already represented by the nearest model?

Only a "yes" to the last question plus at least one meaningful earlier
addition establishes strict progress. Otherwise the result is a different
point on the lattice or a regression in a specific coordinate.
