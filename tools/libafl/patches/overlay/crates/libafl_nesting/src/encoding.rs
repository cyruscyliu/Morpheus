use alloc::vec::Vec;

use libafl::{
    Error,
    inputs::{FromTargetBytesConverter, ToTargetBytesConverter},
};
use libafl_bolts::ownedref::OwnedSlice;

use crate::input::{DmaSection, MmioSection, ScenarioInput, WordModel};

/// Seed wire encoding: a flat byte block. Every count is an explicit field
/// and the data units are self-describing; there is no bitmap anywhere.
/// `addr` keeps its width but means a zero-based index into the monitor's
/// runtime DMA address tables.
///
/// ```text
/// [ 4 B]  mmio entry count
/// [n_m ×] offset(u32 LE) + n_v(u32 LE) + n_v × u32 values
/// [ 4 B]  coherent alloc count
/// [n_c ×] addr(u64 LE) + n_e(u32 LE) + n_e × (offset + n_v + n_v × u32)
/// [EOF ×] addr(u64 LE) + n_e(u32 LE) + n_e × (offset + n_v + n_v × u32)
/// ```
///
/// The native no-op seed encodes to 8 bytes and the streaming section
/// terminates at the end of the block.
#[must_use]
pub fn encode_scenario(input: &ScenarioInput) -> Vec<u8> {
    let mut bytes = Vec::new();
    encode_models(&mut bytes, &input.mmio.word_models);

    bytes.extend_from_slice(&(input.dma.coherent.len() as u32).to_le_bytes());
    for alloc in &input.dma.coherent {
        bytes.extend_from_slice(&alloc.addr.to_le_bytes());
        encode_models(&mut bytes, &alloc.word_models);
    }

    for unit in &input.dma.streaming {
        bytes.extend_from_slice(&unit.addr.to_le_bytes());
        encode_models(&mut bytes, &unit.word_models);
    }
    bytes
}

fn encode_models(bytes: &mut Vec<u8>, models: &[WordModel]) {
    bytes.extend_from_slice(&(models.len() as u32).to_le_bytes());
    for model in models {
        bytes.extend_from_slice(&model.offset.to_le_bytes());
        bytes.extend_from_slice(&(model.values.len() as u32).to_le_bytes());
        for value in &model.values {
            bytes.extend_from_slice(&value.to_le_bytes());
        }
    }
}

/// Encoded seed size, used for generation-time budgeting.
#[must_use]
pub fn encoded_size(input: &ScenarioInput) -> usize {
    encode_scenario(input).len()
}

/// Decode the wire format strictly; any truncation or incomplete trailing
/// unit is rejected.
pub fn decode_scenario(bytes: &[u8]) -> Result<ScenarioInput, Error> {
    let mut cursor = 0usize;

    let mut mmio = MmioSection::default();
    decode_models(bytes, &mut cursor, &mut mmio.word_models, "mmio")?;

    let alloc_count = read_u32(bytes, &mut cursor, "coherent alloc count")? as usize;
    let mut dma = DmaSection::default();
    for _ in 0..alloc_count {
        let addr_chunk = bytes
            .get(cursor..cursor + 8)
            .ok_or_else(|| Error::illegal_argument("scenario truncated in coherent index"))?;
        cursor += 8;
        let addr = u64::from_le_bytes(addr_chunk.try_into().unwrap());
        let mut word_models = Vec::new();
        decode_models(bytes, &mut cursor, &mut word_models, "coherent")?;
        dma.coherent
            .push(crate::input::CoherentAlloc { addr, word_models });
    }

    while cursor < bytes.len() {
        let addr_chunk = bytes
            .get(cursor..cursor + 8)
            .ok_or_else(|| Error::illegal_argument("scenario truncated in stream unit index"))?;
        cursor += 8;
        let addr = u64::from_le_bytes(addr_chunk.try_into().unwrap());
        let mut word_models = Vec::new();
        decode_models(bytes, &mut cursor, &mut word_models, "stream unit")?;
        dma.streaming
            .push(crate::input::StreamUnit { addr, word_models });
    }

    let scenario = ScenarioInput::new(mmio, dma);
    if !scenario.is_valid() {
        return Err(Error::illegal_argument("decoded scenario is invalid"));
    }

    Ok(scenario)
}

fn decode_models(
    bytes: &[u8],
    cursor: &mut usize,
    models: &mut Vec<WordModel>,
    what: &'static str,
) -> Result<(), Error> {
    let count = read_u32(bytes, cursor, format!("{what} slot count"))? as usize;
    for _ in 0..count {
        let offset = read_u32(bytes, cursor, format!("{what} slot offset"))?;
        let values_len = read_u32(bytes, cursor, format!("{what} visit count"))? as usize;
        let mut values = Vec::new();
        for _ in 0..values_len {
            values.push(read_u32(bytes, cursor, format!("{what} visit value"))?);
        }
        models.push(WordModel { offset, values });
    }
    Ok(())
}

#[derive(Debug, Clone, Copy, Default)]
pub struct ScenarioCodec;

impl ScenarioCodec {
    #[must_use]
    pub fn new() -> Self {
        Self
    }
}

impl<S> ToTargetBytesConverter<ScenarioInput, S> for ScenarioCodec {
    fn convert_to_target_bytes<'a>(
        &mut self,
        _state: &mut S,
        input: &'a ScenarioInput,
    ) -> OwnedSlice<'a, u8> {
        OwnedSlice::from(encode_scenario(input))
    }
}

impl<S> FromTargetBytesConverter<ScenarioInput, S> for ScenarioCodec {
    fn convert_from_target_bytes(
        &mut self,
        _state: &mut S,
        bytes: &[u8],
    ) -> Result<ScenarioInput, Error> {
        decode_scenario(bytes)
    }
}

fn read_u32(
    bytes: &[u8],
    cursor: &mut usize,
    what: impl Into<String>,
) -> Result<u32, Error> {
    let chunk = bytes
        .get(*cursor..*cursor + 4)
        .ok_or_else(|| Error::illegal_argument(format!("{} truncated", what.into())))?;
    *cursor += 4;
    Ok(u32::from_le_bytes(chunk.try_into().unwrap()))
}

#[cfg(test)]
mod tests {
    use libafl::inputs::ToTargetBytesConverter;

    use crate::input::{
        CoherentAlloc, DmaSection, MmioSection, ScenarioInput, StreamUnit, WordModel,
    };

    use super::{ScenarioCodec, decode_scenario, encode_scenario, encoded_size};

    fn word(offset: u32, values: &[u32]) -> WordModel {
        WordModel {
            offset,
            values: values.to_vec(),
        }
    }

    #[test]
    fn round_trip_preserves_sections() {
        let input = ScenarioInput::new(
            MmioSection {
                word_models: vec![
                    word(0x110, &[0x7472_6976, 0]),
                    word(0x118, &[2]),
                    word(0x11c, &[1]),
                    word(0x168, &[0x0102_0304, 0]),
                    word(0x1b0, &[0x0000_ab00, 0, 0]),
                ],
            },
            DmaSection {
                coherent: vec![
                    CoherentAlloc {
                        addr: 0,
                        word_models: vec![
                            word(0x000, &[1, 0, 1]),
                            word(0x004, &[7]),
                            word(0x1000, &[1]),
                        ],
                    },
                    CoherentAlloc {
                        addr: 1,
                        word_models: vec![word(0x008, &[9])],
                    },
                ],
                streaming: vec![
                    StreamUnit {
                        addr: 0,
                        word_models: vec![word(0x000, &[0xaaaa_aaaa])],
                    },
                    StreamUnit {
                        addr: 1,
                        word_models: vec![word(0x1008, &[0x5555_5555])],
                    },
                ],
            },
        );

        let bytes = encode_scenario(&input);
        let decoded = decode_scenario(&bytes).expect("decode should succeed");
        assert_eq!(input, decoded);
        assert_eq!(encoded_size(&input), bytes.len());

        let mut codec = ScenarioCodec::new();
        let bytes2 = codec.convert_to_target_bytes(&mut (), &input);
        assert_eq!(bytes.as_slice(), bytes2.as_ref());
    }

    #[test]
    fn non_whole_unit_buffers_are_rejected_by_the_decoder() {
        // Shorter than one slot count.
        let bytes = vec![0u8; 3];
        assert!(decode_scenario(&bytes).is_err());

        // Declares one alloc but does not include its word models: reject.
        let mut bytes = vec![0u8; 4]; // mmio entry count = 0.
        bytes.extend_from_slice(&1u32.to_le_bytes()); // coherent alloc count = 1.
        bytes.extend_from_slice(&0u64.to_le_bytes()); // table index = 0.
        assert!(decode_scenario(&bytes).is_err());

        // A unit declares two words but only one value: reject.
        let mut bytes = vec![0u8; 8]; // mmio 0, no coherent.
        bytes.extend_from_slice(&0u64.to_le_bytes()); // table index = 0.
        bytes.extend_from_slice(&2u32.to_le_bytes()); // word count = 2.
        bytes.extend_from_slice(&0u32.to_le_bytes()); // offset 0.
        bytes.extend_from_slice(&1u32.to_le_bytes()); // one visit.
        bytes.extend_from_slice(&0u32.to_le_bytes()); // its value.
        assert!(decode_scenario(&bytes).is_err());

        // The native no-op seed decodes: 4 B mmio count + 4 B alloc count.
        let empty = ScenarioInput::default();
        let bytes = encode_scenario(&empty);
        assert_eq!(bytes.len(), 8);
        let decoded = decode_scenario(&bytes).expect("all-native seed should decode");
        assert!(decoded.is_valid());
        assert_eq!(decoded.total_actions(), 0);
    }
}
