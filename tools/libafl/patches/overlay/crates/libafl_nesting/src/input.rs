use std::{fmt::Write, fs, path::Path};

use libafl::{Error, inputs::{HasTargetBytes, Input}};
use libafl_bolts::{HasLen, ownedref::OwnedSlice};
use serde::{Deserialize, Serialize};
use crate::encoding::{decode_scenario, encode_scenario};

/// Number of virtio-mmio window slots: 0x200 / 4.
pub const MMIO_WINDOW_SLOTS: usize = 128;

/// Maximum set-slot count for one streaming unit, bounded by the bitmap width.
/// One set slot is one 32-bit word, so one unit can cover up to 512 bytes.
pub const MAX_STREAM_UNIT_SLOTS: u32 = 128;

/// One seed payload sent to the consumer.
///
/// Boundary rule: skeleton metadata (`present` bitmaps) is fixed when the
/// grammar constructs the seed and is not mutated. Values and counts are the
/// LibAFL mutation surface. Any access beyond the modelled seed data falls
/// through to native behavior.
///
/// The consumer has only two surfaces: captured MMIO (`mmio.*` read tables)
/// and DMA telemetry commits (`dma.*`).
#[derive(Clone, Debug, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct ScenarioInput {
    /// virtio-mmio window plane (0x200 bytes, 128 4-byte slots).
    pub mmio: MmioSection,
    /// The two DMA surfaces.
    pub dma: DmaSection,
}

/// virtio-mmio window plane.
///
/// Slots are split by 4-byte words: bit k maps to slot k at offset 4k. A
/// driver may read the same slot repeatedly, so every modelled slot carries
/// a value sequence consumed by visit order.
#[derive(Clone, Debug, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct MmioSection {
    /// Skeleton bitmap: bit k means slot k is modelled. Mutation does not edit it.
    pub present: u128,
    /// len == popcount(present), in ascending slot order.
    pub word_model: Vec<WordModel>,
}

/// Access model for one slot: read visit v returns values[v]; v >= count is native.
#[derive(Clone, Debug, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct WordModel {
    /// Number of values, and therefore the consumption limit for this slot.
    pub count: u32,
    /// Slot values in visit order; guest reads use offset % 4 to select bytes.
    pub values: Vec<u32>,
}

/// DMA section.
#[derive(Clone, Debug, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct DmaSection {
    /// Coherent surface: each entry models one allocation. `addr` selects a
    /// runtime coherent-allocation table entry; guest accesses into the remap
    /// consume `word_model` by visit order.
    pub coherent: Vec<CoherentAlloc>,
    /// Streaming surface: each entry models one MAP. `addr` selects a runtime
    /// streaming-MAP table entry; `present` selects 32-bit slots at offset 4k.
    pub streaming: Vec<StreamUnit>,
}

/// Access model for one coherent allocation: one alloc, many reads/writes.
#[derive(Clone, Debug, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct CoherentAlloc {
    /// Zero-based index into the monitor's runtime coherent-allocation table.
    pub addr: u64,
    /// Skeleton bitmap: bit k means access visit k is modelled. Mutation does not edit it.
    pub present: u128,
    /// len == popcount(present), in access order; visit k injects values[k].
    pub word_model: Vec<u32>,
}

/// Streaming unit, represented sparsely by a bitmap of 32-bit slots.
#[derive(Clone, Debug, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct StreamUnit {
    /// Zero-based index into the monitor's runtime streaming-MAP table.
    pub addr: u64,
    /// Sparse bitmap: bit k maps to the 32-bit slot at region offset 4k. Mutation does not edit it.
    pub present: u128,
    /// One u32 per set slot, in ascending set-bit order.
    pub values: Vec<u32>,
}

impl WordModel {
    /// Build the returned value for (offset, visit); offset % 4 selects the byte position.
    #[must_use]
    pub fn answer(&self, offset: usize, visit: usize) -> Option<u32> {
        if visit >= self.values.len() {
            return None;
        }
        let shift = u32::try_from(offset % 4).ok()? * 8;
        Some(self.values[visit].rotate_right(shift))
    }
}

impl ScenarioInput {
    #[must_use]
    pub fn new(mmio: MmioSection, dma: DmaSection) -> Self {
        Self { mmio, dma }
    }

    /// Total modelled units: MMIO slots + coherent allocs + streaming entries.
    #[must_use]
    pub fn total_units(&self) -> usize {
        self.mmio.word_model.len() + self.dma.coherent.len() + self.dma.streaming.len()
    }

    /// Total action units for mutation/feedback: visit values plus set-slot words.
    #[must_use]
    pub fn total_actions(&self) -> usize {
        let mmio: usize = self.mmio.word_model.iter().map(|w| w.values.len()).sum();
        let coherent: usize = self
            .dma
            .coherent
            .iter()
            .map(|c| c.word_model.len())
            .sum();
        let streaming: usize = self
            .dma
            .streaming
            .iter()
            .map(|s| s.present.count_ones() as usize)
            .sum();
        mmio + coherent + streaming
    }

    /// Structural invariants: violating any of these makes the seed invalid.
    /// Modelled slots/entries must also be non-empty (`count >= 1` / `present != 0`).
    #[must_use]
    pub fn is_valid(&self) -> bool {
        if self.mmio.word_model.len() != self.mmio.present.count_ones() as usize {
            return false;
        }
        if self.mmio.word_model.iter().any(|w| {
            w.count == 0 || w.values.len() != w.count as usize
                || w.count as usize > MMIO_WINDOW_SLOTS
        }) {
            return false;
        }
        if self.dma.coherent.len() > MMIO_WINDOW_SLOTS {
            return false;
        }
        if self.dma.coherent.iter().any(|c| {
            c.present == 0 || c.word_model.len() != c.present.count_ones() as usize
        }) {
            return false;
        }
        if self
            .dma
            .streaming
            .iter()
            .any(|s| s.values.len() != s.present.count_ones() as usize)
        {
            return false;
        }
        true
    }
}

/// Render a decoded scenario in a stable human-readable form.
#[must_use]
pub fn format_scenario(scenario: &ScenarioInput) -> String {
    let mut rendered = String::new();
    let _ = writeln!(rendered, "mmio present=0x{:x}", scenario.mmio.present);
    for (index, model) in scenario.mmio.word_model.iter().enumerate() {
        let _ = write!(rendered, "  mmio[{index}] count={} values=", model.count);
        for (position, value) in model.values.iter().enumerate() {
            let _ = write!(rendered, "{}0x{value:x}", if position == 0 { "" } else { "," });
        }
        let _ = writeln!(rendered);
    }
    for (index, alloc) in scenario.dma.coherent.iter().enumerate() {
        let _ = write!(
            rendered,
            "  coherent[{index}] addr={} present=0x{:x} word_model=",
            alloc.addr, alloc.present
        );
        for (position, value) in alloc.word_model.iter().enumerate() {
            let _ = write!(rendered, "{}0x{value:x}", if position == 0 { "" } else { "," });
        }
        let _ = writeln!(rendered);
    }
    for (index, unit) in scenario.dma.streaming.iter().enumerate() {
        let _ = write!(
            rendered,
            "  streaming[{index}] addr={} present=0x{:x} values=",
            unit.addr, unit.present
        );
        for (position, value) in unit.values.iter().enumerate() {
            let _ = write!(rendered, "{}0x{value:x}", if position == 0 { "" } else { "," });
        }
        let _ = writeln!(rendered);
    }
    rendered
}

impl Input for ScenarioInput {
    /// Write the flat seed wire format; LibAFL does not filter or re-encode it.
    fn to_file<P: AsRef<Path>>(&self, path: P) -> Result<(), Error> {
        fs::write(path, encode_scenario(self))?;
        Ok(())
    }

    /// Accept only the seed wire format; reject any non-wire byte block.
    fn from_file<P: AsRef<Path>>(path: P) -> Result<Self, Error> {
        let bytes = fs::read(path)?;
        decode_scenario(&bytes)
    }
}

impl HasLen for ScenarioInput {
    fn len(&self) -> usize {
        self.total_units()
    }
}

impl HasTargetBytes for ScenarioInput {
    fn target_bytes(&self) -> OwnedSlice<'_, u8> {
        OwnedSlice::from(encode_scenario(self))
    }
}

#[cfg(all(test, feature = "std"))]
mod tests {
    use super::{
        CoherentAlloc, MmioSection, ScenarioInput, StreamUnit, WordModel, DmaSection,
    };
    use crate::encoding::encode_scenario;
    use libafl::inputs::Input;
    use std::{
        fs,
        time::{SystemTime, UNIX_EPOCH},
    };

    #[test]
    fn wire_file_round_trip_matches_ondisk_corpus() {
        let input = ScenarioInput::new(
            MmioSection {
                present: (1 << 68) | 0b100111,
                word_model: vec![
                    WordModel { count: 2, values: vec![0x7472_6976, 0xdead_beef] },
                    WordModel { count: 1, values: vec![2] },
                    WordModel { count: 1, values: vec![1] },
                    WordModel { count: 2, values: vec![0x0102_0304, 0] },
                    WordModel { count: 3, values: vec![0x0000_ab00, 0, 0] },
                ],
            },
            DmaSection {
                coherent: vec![CoherentAlloc { addr: 0, present: 0b111, word_model: vec![1, 0, 1] }],
                streaming: vec![StreamUnit {
                    addr: 0,
                    present: 0xFFFF,
                    values: vec![0xAA; 16],
                }],
            },
        );
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock should be valid")
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "libafl-nesting-input-roundtrip-{}-{nonce}",
            std::process::id()
        ));
        input.to_file(&path).expect("input should serialize");
        let bytes = fs::read(&path).expect("serialized input should be readable");
        let decoded = ScenarioInput::from_file(&path).expect("input should deserialize");
        fs::remove_file(&path).expect("temporary input should be removed");
        assert_eq!(bytes, encode_scenario(&input));
        assert_eq!(decoded, input);
        assert!(decoded.is_valid());
        assert_eq!(decoded.total_actions(), 9 + 3 + 16);
    }

    #[test]
    fn broken_invariants_fail_model_validation() {
        let mismatched = ScenarioInput::new(
            MmioSection {
                present: 1,
                word_model: vec![
                    WordModel { count: 2, values: vec![1] }, // count != values.len()
                ],
            },
            DmaSection::default(),
        );
        assert!(!mismatched.is_valid());

        let mismatched_stream = ScenarioInput::new(
            MmioSection::default(),
            DmaSection {
                streaming: vec![StreamUnit {
                    addr: 0,
                    present: 0b11,
                    values: vec![0; 1],
                }],
                ..Default::default()
            },
        );
        assert!(!mismatched_stream.is_valid());

        let empty_model = ScenarioInput::new(
            MmioSection {
                present: 1,
                word_model: vec![WordModel {
                    count: 0,
                    values: Vec::new(),
                }],
            },
            DmaSection::default(),
        );
        assert!(!empty_model.is_valid());

        let empty_coherent = ScenarioInput::new(
            MmioSection::default(),
            DmaSection {
                coherent: vec![CoherentAlloc {
                    addr: 0,
                    present: 0,
                    word_model: Vec::new(),
                }],
                ..Default::default()
            },
        );
        assert!(!empty_coherent.is_valid());
    }
}
