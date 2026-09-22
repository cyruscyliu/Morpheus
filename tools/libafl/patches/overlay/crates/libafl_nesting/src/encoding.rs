use alloc::vec::Vec;

use libafl::{
    Error,
    inputs::{FromTargetBytesConverter, ToTargetBytesConverter},
};
use libafl_bolts::ownedref::OwnedSlice;

use crate::input::{DmaSection, MmioSection, ScenarioInput};

/// present 位图字段的字节数(u128)。
pub const PRESENT_SECTION_SIZE: usize = 16;

/// 种子的 wire 编码:扁平字节块,counts/长度全部自描述或由位图派生。
///
/// ```text
/// [16 B]  mmio.present                  (u128 LE)
/// [pc₁ ×] 每 WordModel:count(u32 LE)+ count×u32 values
/// [ 4 B]  coherent alloc 条数
/// [n_c ×] 每 alloc:addr(u64 LE)+ present(u128 LE)+ popcount×u32 values
/// [到流末尾] 每 StreamUnit:addr(u64 LE)+ size(u32 LE)+ size×u8 data
/// ```
#[must_use]
pub fn encode_scenario(input: &ScenarioInput) -> Vec<u8> {
    let mut bytes = Vec::new();
    bytes.extend_from_slice(&input.mmio.present.to_le_bytes());
    for model in &input.mmio.word_model {
        bytes.extend_from_slice(&model.count.to_le_bytes());
        for value in &model.values {
            bytes.extend_from_slice(&value.to_le_bytes());
        }
    }

    bytes.extend_from_slice(&(input.dma.coherent.len() as u32).to_le_bytes());
    for alloc in &input.dma.coherent {
        bytes.extend_from_slice(&alloc.addr.to_le_bytes());
        bytes.extend_from_slice(&alloc.present.to_le_bytes());
        for value in &alloc.word_model {
            bytes.extend_from_slice(&value.to_le_bytes());
        }
    }

    for unit in &input.dma.streaming {
        bytes.extend_from_slice(&unit.addr.to_le_bytes());
        bytes.extend_from_slice(&unit.size.to_le_bytes());
        bytes.extend_from_slice(&unit.data);
    }
    bytes
}

/// 种子的编码大小(生成期预算用)。
#[must_use]
pub fn encoded_size(input: &ScenarioInput) -> usize {
    let mmio = PRESENT_SECTION_SIZE
        + input
            .mmio
            .word_model
            .iter()
            .map(|model| 4 + model.values.len() * 4)
            .sum::<usize>();
    let coherent = 4
        + input
            .dma
            .coherent
            .iter()
            .map(|alloc| 8 + PRESENT_SECTION_SIZE + alloc.word_model.len() * 4)
            .sum::<usize>();
    let streaming = input
        .dma
        .streaming
        .iter()
        .map(|unit| 8 + 4 + usize::try_from(unit.size).unwrap_or(0))
        .sum::<usize>();
    mmio + coherent + streaming
}

/// wire 解码:严格对齐,任何截断/残余不足一个完整单元即拒绝。
pub fn decode_scenario(bytes: &[u8]) -> Result<ScenarioInput, Error> {
    let mut cursor = 0usize;

    let chunk = bytes
        .get(cursor..cursor + PRESENT_SECTION_SIZE)
        .ok_or_else(|| Error::illegal_argument("scenario truncated in present section"))?;
    cursor += PRESENT_SECTION_SIZE;
    let mmio_present = u128::from_le_bytes(chunk.try_into().unwrap());

    let mut mmio = MmioSection::default();
    for _ in 0..mmio_present.count_ones() {
        let count = read_u32(bytes, &mut cursor, "realized word model count")? as usize;
        let mut values = Vec::new();
        for _ in 0..count {
            values.push(read_u32(bytes, &mut cursor, "word model value")?);
        }
        mmio.word_model.push(crate::input::WordModel {
            count: u32::try_from(count)
                .map_err(|_| Error::illegal_argument("word model count out of range"))?,
            values,
        });
    }
    mmio.present = mmio_present;

    let alloc_count = read_u32(bytes, &mut cursor, "coherent alloc count")? as usize;
    let mut dma = DmaSection::default();
    for _ in 0..alloc_count {
        let addr_chunk = bytes
            .get(cursor..cursor + 8)
            .ok_or_else(|| Error::illegal_argument("scenario truncated in coherent addr"))?;
        cursor += 8;
        let addr = u64::from_le_bytes(addr_chunk.try_into().unwrap());
        let chunk = bytes
            .get(cursor..cursor + PRESENT_SECTION_SIZE)
            .ok_or_else(|| Error::illegal_argument("scenario truncated in coherent present"))?;
        cursor += PRESENT_SECTION_SIZE;
        let present = u128::from_le_bytes(chunk.try_into().unwrap());
        let mut word_model = Vec::new();
        for _ in 0..present.count_ones() {
            word_model.push(read_u32(bytes, &mut cursor, "coherent value")?);
        }
        dma.coherent
            .push(crate::input::CoherentAlloc { addr, present, word_model });
    }

    while cursor < bytes.len() {
        let addr_chunk = bytes
            .get(cursor..cursor + 8)
            .ok_or_else(|| Error::illegal_argument("scenario truncated in stream unit addr"))?;
        cursor += 8;
        let addr = u64::from_le_bytes(addr_chunk.try_into().unwrap());
        let size = read_u32(bytes, &mut cursor, "stream unit size")? as usize;
        let chunk = bytes.get(cursor..cursor + size).ok_or_else(|| {
            Error::illegal_argument("scenario truncated in stream unit data")
        })?;
        cursor += size;
        dma.streaming
            .push(crate::input::StreamUnit {
                addr,
                size: u32::try_from(size)
                    .map_err(|_| Error::illegal_argument("stream size out of range"))?,
                data: chunk.to_vec(),
            });
    }

    let scenario = ScenarioInput::new(mmio, dma);
    if !scenario.is_valid() {
        return Err(Error::illegal_argument("decoded scenario is invalid"));
    }

    Ok(scenario)
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

fn read_u32(bytes: &[u8], cursor: &mut usize, what: &'static str) -> Result<u32, Error> {
    let chunk = bytes
        .get(*cursor..*cursor + 4)
        .ok_or_else(|| Error::illegal_argument(format!("{what} truncated")))?;
    *cursor += 4;
    Ok(u32::from_le_bytes(chunk.try_into().unwrap()))
}

#[cfg(test)]
mod tests {
    use libafl::inputs::ToTargetBytesConverter;

    use crate::input::{
        CoherentAlloc, DmaSection, MmioSection, ScenarioInput, StreamUnit, WordModel,
    };

    use super::{ScenarioCodec, decode_scenario, encoded_size, encode_scenario};

    #[test]
    fn round_trip_preserves_sections() {
        let input = ScenarioInput::new(
            MmioSection {
                present: (1 << 68) | 0b100111,
                word_model: vec![
                    WordModel { count: 2, values: vec![0x7472_6976, 0] },
                    WordModel { count: 1, values: vec![2] },
                    WordModel { count: 1, values: vec![1] },
                    WordModel { count: 2, values: vec![0x0200_0103, 0] },
                    WordModel {
                        count: 3,
                        values: vec![0x0000_ff00, 0, 0],
                    },
                ],
            },
            DmaSection {
                coherent: vec![
                    CoherentAlloc { addr: 0x3000, present: 0b111, word_model: vec![1, 0, 1] },
                    CoherentAlloc { addr: 0x3100, present: 0b1, word_model: vec![7] },
                ],
                streaming: vec![
                    StreamUnit { addr: 0x1000, size: 70, data: vec![0xAA; 70] },
                    StreamUnit { addr: 0x2000, size: 28, data: vec![0x55; 28] },
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
        // 不足一个 present 段
        let bytes = vec![0u8; 15];
        assert!(decode_scenario(&bytes).is_err());

        // 声明 1 个 alloc 但没有 present/载荷 → 截断拒绝
        let mut bytes = vec![0u8; 16]; // mmio.present = 0 → 无 mmio 条目
        bytes.extend_from_slice(&1u32.to_le_bytes()); // coherent 条数 = 1
        assert!(decode_scenario(&bytes).is_err());

        // streaming size 声明 70 但只有 10 B 数据 → 截断拒绝
        let mut bytes = vec![0u8; 16];
        bytes.extend_from_slice(&0u32.to_le_bytes()); // coherent 条数 = 0
        bytes.extend_from_slice(&70u32.to_le_bytes()); // streaming size = 70
        bytes.extend_from_slice(&[0u8; 10]);
        assert!(decode_scenario(&bytes).is_err());

        // 全 0 结构(present=0、无 alloc、无 streaming)是合法的 native noop
        let empty = ScenarioInput::default();
        let bytes = encode_scenario(&empty);
        assert_eq!(bytes.len(), 16 + 4);
        let decoded = decode_scenario(&bytes).expect("all-native seed should decode");
        assert!(decoded.is_valid());
        assert_eq!(decoded.total_actions(), 0);
    }
}
