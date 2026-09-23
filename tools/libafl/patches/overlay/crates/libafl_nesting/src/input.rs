use std::{fmt::Write, fs, path::Path};

use libafl::{Error, inputs::{HasTargetBytes, Input}};
use libafl_bolts::{HasLen, ownedref::OwnedSlice};
use serde::{Deserialize, Serialize};
use crate::encoding::{decode_scenario, encode_scenario};

/// Number of virtio-mmio window slots: 0x200 / 4.
pub const MMIO_WINDOW_SLOTS: usize = 128;

/// Size of the virtio-mmio window in bytes; mmio model offsets stay inside it.
pub const MMIO_WINDOW_BYTES: u32 = (MMIO_WINDOW_SLOTS * 4) as u32;

/// One seed payload sent to the consumer.
///
/// Boundary rule: skeleton metadata (the modelled slot set, i.e. the
/// `offset` keys of every `WordModel`) is fixed when the grammar
/// constructs the seed and is not mutated. Visit values and counts are
/// the LibAFL mutation surface. Any access beyond the modelled seed data
/// falls through to native behavior.
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
/// Every model is one explicit 32-bit window slot: `offset` names the slot
/// byte offset. A driver may read the same slot repeatedly, so each model
/// carries a visit-ordered value sequence.
#[derive(Clone, Debug, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct MmioSection {
    /// One model per modelled window slot, in ascending offset order.
    pub word_models: Vec<WordModel>,
}

/// Access model for one 32-bit word slot: visit v returns values[v]; past
/// the values the slot behaves natively.
///
/// The byte offset is explicit: mmio models live inside the 0x200 window,
/// dma models live inside the claimed or mapped region at any depth (a
/// used-ring entry at offset 0x1000 is reachable).
#[derive(Clone, Debug, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct WordModel {
    /// Byte offset of the modelled 32-bit slot, 4-byte aligned.
    pub offset: u32,
    /// Slot values in visit order; len >= 1. Guest bytes use offset % 4.
    pub values: Vec<u32>,
}

/// DMA section.
#[derive(Clone, Debug, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct DmaSection {
    /// Coherent surface: each entry models one allocation. `addr` selects a
    /// runtime coherent-allocation table entry; guest accesses into the remap
    /// consume the model at the accessed word's offset by visit order.
    pub coherent: Vec<CoherentAlloc>,
    /// Streaming surface: each entry models one MAP. `addr` selects a runtime
    /// streaming-MAP table entry; each modelled word is filled once at the
    /// mapping event.
    pub streaming: Vec<StreamUnit>,
}

/// Access model for one coherent allocation: one alloc, many reads/writes.
#[derive(Clone, Debug, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct CoherentAlloc {
    /// Zero-based index into the monitor's runtime coherent-allocation table.
    pub addr: u64,
    /// One model per accessed word, in ascending offset order.
    pub word_models: Vec<WordModel>,
}

/// Streaming unit: each entry fills one mapped buffer once.
#[derive(Clone, Debug, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct StreamUnit {
    /// Zero-based index into the monitor's runtime streaming-MAP table.
    pub addr: u64,
    /// One model per filled word, in ascending offset order.
    pub word_models: Vec<WordModel>,
}

impl WordModel {
    /// Build the returned value for a partial access of `size` bytes; the
    /// byte position is `word_offset % 4` inside the modelled slot word.
    #[must_use]
    pub fn answer(&self, word_offset: usize, visit: usize) -> Option<u32> {
        if self.values.is_empty() || visit >= self.values.len() {
            return None;
        }
        let shift = u32::try_from(word_offset % 4).ok()? * 8;
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
        self.mmio.word_models.len() + self.dma.coherent.len() + self.dma.streaming.len()
    }

    /// Total action units for mutation/feedback: planned visit words.
    #[must_use]
    pub fn total_actions(&self) -> usize {
        let mmio: usize = self.mmio.word_models.iter().map(|w| w.values.len()).sum();
        let coherent: usize = self
            .dma
            .coherent
            .iter()
            .map(|alloc| {
                alloc
                    .word_models
                    .iter()
                    .map(|w| w.values.len())
                    .sum::<usize>()
            })
            .sum();
        let streaming: usize = self
            .dma
            .streaming
            .iter()
            .map(|unit| {
                unit.word_models
                    .iter()
                    .map(|w| w.values.len())
                    .sum::<usize>()
            })
            .sum();
        mmio + coherent + streaming
    }

    /// Structural invariants: violating any of these makes the seed invalid.
    /// Offsets are 4-byte aligned, unique and ascending within their plane;
    /// mmio offsets stay inside the window; every model carries values.
    #[must_use]
    pub fn is_valid(&self) -> bool {
        if !offsets_ascending_unique(&self.mmio.word_models) {
            return false;
        }
        if self.mmio.word_models.iter().any(|model| {
            model.offset >= MMIO_WINDOW_BYTES || model.values.is_empty()
                || model.values.len() > MMIO_WINDOW_SLOTS
        }) {
            return false;
        }
        for alloc in &self.dma.coherent {
            if !offsets_ascending_unique(&alloc.word_models)
                || alloc.word_models.iter().any(|model| model.values.is_empty())
            {
                return false;
            }
        }
        for unit in &self.dma.streaming {
            if !offsets_ascending_unique(&unit.word_models)
                || unit.word_models.iter().any(|model| model.values.is_empty())
            {
                return false;
            }
        }
        true
    }
}

fn offsets_ascending_unique(models: &[WordModel]) -> bool {
    models.windows(2).all(|pair| pair[0].offset < pair[1].offset)
        && models.iter().all(|model| model.offset % 4 == 0)
}

/// Render a decoded scenario in a stable human-readable form.
#[must_use]
pub fn format_scenario(scenario: &ScenarioInput) -> String {
    let mut rendered = String::new();
    let _ = writeln!(
        rendered,
        "mmio slots={}",
        scenario.mmio.word_models.len()
    );
    for model in &scenario.mmio.word_models {
        let _ = write!(rendered, "  mmio offset=0x{:x} values=", model.offset);
        write_values(&mut rendered, &model.values);
    }
    for alloc in &scenario.dma.coherent {
        let _ = writeln!(rendered, "  coherent addr={} slots={}", alloc.addr, alloc.word_models.len());
        for model in &alloc.word_models {
            let _ = write!(rendered, "    word offset=0x{:x} values=", model.offset);
            write_values(&mut rendered, &model.values);
        }
    }
    for unit in &scenario.dma.streaming {
        let _ = writeln!(rendered, "  streaming addr={} slots={}", unit.addr, unit.word_models.len());
        for model in &unit.word_models {
            let _ = write!(rendered, "    word offset=0x{:x} values=", model.offset);
            write_values(&mut rendered, &model.values);
        }
    }
    rendered
}

fn write_values(rendered: &mut String, values: &[u32]) {
    for (position, value) in values.iter().enumerate() {
        let _ = write!(rendered, "{}0x{value:x}", if position == 0 { "" } else { "," });
    }
    let _ = writeln!(rendered);
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
        CoherentAlloc, DmaSection, MmioSection, ScenarioInput, StreamUnit, WordModel,
        MMIO_WINDOW_BYTES,
    };
    use crate::encoding::encode_scenario;
    use libafl::inputs::Input;
    use std::{
        fs,
        time::{SystemTime, UNIX_EPOCH},
    };

    fn word(offset: u32, values: &[u32]) -> WordModel {
        WordModel {
            offset,
            values: values.to_vec(),
        }
    }

    #[test]
    fn wire_file_round_trip_matches_ondisk_corpus() {
        let input = ScenarioInput::new(
            MmioSection {
                word_models: vec![
                    word(0x110, &[0x7472_6976, 0xdead_beef]),
                    word(0x118, &[2]),
                    word(0x11c, &[1]),
                    word(0x168, &[0x0102_0304, 0]),
                    word(0x1b0, &[0x0000_ab00, 0, 0]),
                ],
            },
            DmaSection {
                coherent: vec![CoherentAlloc {
                    addr: 0,
                    word_models: vec![
                        word(0x000, &[1]),
                        word(0x004, &[0x4141_4101]),
                        word(0x1000, &[1]),
                    ],
                }],
                streaming: vec![StreamUnit {
                    addr: 0,
                    word_models: vec![
                        word(0x000, &[0xaaaa_aaaa]),
                        word(0x004, &[0x5555_5555]),
                        word(0x1004, &[0]),
                    ],
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
        assert_eq!(decoded.total_actions(), 9 + 3 + 3);
        // A deep dma offset is reachable; mmio offsets stay window-bounded.
        assert!(decoded.mmio.word_models.iter().all(|m| m.offset < MMIO_WINDOW_BYTES));
        assert!(decoded.dma.coherent[0].word_models.iter()
            .any(|m| m.offset >= MMIO_WINDOW_BYTES));
        assert!(decoded.dma.streaming[0].word_models.iter()
            .any(|m| m.offset >= MMIO_WINDOW_BYTES));
    }

    #[test]
    fn broken_invariants_fail_model_validation() {
        let empty_values = ScenarioInput::new(
            MmioSection {
                word_models: vec![word(0, &[])],
            },
            DmaSection::default(),
        );
        assert!(!empty_values.is_valid());

        let duplicate_offset = ScenarioInput::new(
            MmioSection::default(),
            DmaSection {
                streaming: vec![StreamUnit {
                    addr: 0,
                    word_models: vec![word(0, &[1]), word(0, &[2])],
                }],
                ..Default::default()
            },
        );
        assert!(!duplicate_offset.is_valid());

        let descending_offsets = ScenarioInput::new(
            MmioSection::default(),
            DmaSection {
                coherent: vec![CoherentAlloc {
                    addr: 0,
                    word_models: vec![word(8, &[1]), word(4, &[2])],
                }],
                ..Default::default()
            },
        );
        assert!(!descending_offsets.is_valid());

        let misaligned_offset = ScenarioInput::new(
            MmioSection {
                word_models: vec![word(2, &[1])],
            },
            DmaSection::default(),
        );
        assert!(!misaligned_offset.is_valid());

        let window_escape = ScenarioInput::new(
            MmioSection {
                word_models: vec![word(MMIO_WINDOW_BYTES, &[1])],
            },
            DmaSection::default(),
        );
        assert!(!window_escape.is_valid());
    }
}
