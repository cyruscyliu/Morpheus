use alloc::vec::Vec;

use libafl::{
    Error,
    inputs::{FromTargetBytesConverter, ToTargetBytesConverter},
};
use libafl_bolts::ownedref::OwnedSlice;

use crate::input::{DeviceOverride, ScenarioInput};

/// The native QEMU seed consumer keeps the established fixed-width record
/// layout, but only accepts device override records.
///
/// The four-byte prefix is a batch count, not an execution group. It is kept
/// for wire compatibility with the native QEMU consumer.
pub const GROUP_HEADER_SIZE: usize = 4;
pub const ACTION_RECORD_SIZE: usize = 40;

const FAMILY_HYPER: u8 = 2;
const OP_MMIO_READ: u8 = 1;
const OP_QUEUE_DMA: u8 = 12;
const MMIO_OVERRIDE_FLAG: u16 = 1;

#[derive(Debug, Clone, Copy, Default)]
pub struct ScenarioCodec;

impl ScenarioCodec {
    #[must_use]
    pub fn new() -> Self {
        Self
    }
}

/// Encode one device-override seed as one wire-format batch.
#[must_use]
pub fn encode_scenario(input: &ScenarioInput) -> Vec<u8> {
    let mut bytes =
        Vec::with_capacity(GROUP_HEADER_SIZE + input.overrides().len() * ACTION_RECORD_SIZE);
    if input.overrides().is_empty() {
        return bytes;
    }

    bytes.extend_from_slice(&(input.overrides().len() as u32).to_le_bytes());
    for override_record in input.overrides() {
        encode_override(override_record, &mut bytes);
    }
    bytes
}

/// Decode the native device-override wire format.
pub fn decode_scenario(bytes: &[u8]) -> Result<ScenarioInput, Error> {
    if bytes.is_empty() {
        return Ok(ScenarioInput::new(Vec::new()));
    }

    let mut cursor = 0usize;
    let mut overrides = Vec::new();
    while cursor < bytes.len() {
        let count = read_u32(bytes, &mut cursor)? as usize;
        if count == 0 {
            return Err(Error::illegal_argument(
                "device override seed batch must be non-empty",
            ));
        }

        for _ in 0..count {
            overrides.push(decode_override(bytes, &mut cursor)?);
        }
    }

    let seed = ScenarioInput::new(overrides);
    if !seed.is_valid() {
        return Err(Error::illegal_argument(
            "device override seed contains invalid values",
        ));
    }
    Ok(seed)
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

fn encode_override(override_record: &DeviceOverride, bytes: &mut Vec<u8>) {
    let (opcode, flags, arg0, arg1, arg2, arg3) = match override_record {
        DeviceOverride::MmioRead {
            address,
            width,
            value,
        } => (
            OP_MMIO_READ,
            MMIO_OVERRIDE_FLAG,
            *address,
            u64::from(*width),
            *value,
            0,
        ),
        DeviceOverride::QueueDma {
            operation,
            direction,
            path,
            sequence,
            queue,
            payload_len,
            used_len,
        } => (
            OP_QUEUE_DMA,
            0,
            u64::from(*queue),
            u64::from(*payload_len),
            u64::from(*used_len),
            u64::from(*operation)
                | (u64::from(*direction) << 8)
                | (u64::from(*path) << 16)
                | (u64::from(*sequence) << 24),
        ),
    };

    bytes.push(FAMILY_HYPER);
    bytes.push(opcode);
    bytes.extend_from_slice(&flags.to_le_bytes());
    bytes.extend_from_slice(&0u32.to_le_bytes());
    bytes.extend_from_slice(&arg0.to_le_bytes());
    bytes.extend_from_slice(&arg1.to_le_bytes());
    bytes.extend_from_slice(&arg2.to_le_bytes());
    bytes.extend_from_slice(&arg3.to_le_bytes());
}

fn decode_override(bytes: &[u8], cursor: &mut usize) -> Result<DeviceOverride, Error> {
    if bytes.len().saturating_sub(*cursor) < ACTION_RECORD_SIZE {
        return Err(Error::illegal_argument("device override record truncated"));
    }

    let family = bytes[*cursor];
    let opcode = bytes[*cursor + 1];
    *cursor += 2;
    let flags = read_u16(bytes, cursor)?;
    let reserved = read_u32(bytes, cursor)?;
    let arg0 = read_u64(bytes, cursor)?;
    let arg1 = read_u64(bytes, cursor)?;
    let arg2 = read_u64(bytes, cursor)?;
    let arg3 = read_u64(bytes, cursor)?;

    if family != FAMILY_HYPER {
        return Err(Error::illegal_argument(
            "device override seed contains a non-device action",
        ));
    }
    if reserved != 0 {
        return Err(Error::illegal_argument(
            "device override seed record has non-zero reserved bits",
        ));
    }

    match (opcode, flags) {
        (OP_MMIO_READ, MMIO_OVERRIDE_FLAG) => Ok(DeviceOverride::MmioRead {
            address: arg0,
            width: u8::try_from(arg1)
                .map_err(|_| Error::illegal_argument("MMIO override width out of range"))?,
            value: arg2,
        }),
        (OP_QUEUE_DMA, 0) => Ok(DeviceOverride::QueueDma {
            operation: u8::try_from(arg3 & 0xff)
                .map_err(|_| Error::illegal_argument("DMA operation out of range"))?,
            direction: u8::try_from((arg3 >> 8) & 0xff)
                .map_err(|_| Error::illegal_argument("DMA direction out of range"))?,
            path: u8::try_from((arg3 >> 16) & 0xff)
                .map_err(|_| Error::illegal_argument("DMA path out of range"))?,
            sequence: u16::try_from((arg3 >> 24) & 0xffff)
                .map_err(|_| Error::illegal_argument("DMA sequence out of range"))?,
            queue: u16::try_from(arg0)
                .map_err(|_| Error::illegal_argument("virtio queue out of range"))?,
            payload_len: u32::try_from(arg1)
                .map_err(|_| Error::illegal_argument("DMA payload length out of range"))?,
            used_len: u32::try_from(arg2)
                .map_err(|_| Error::illegal_argument("DMA used length out of range"))?,
        }),
        _ => Err(Error::illegal_argument(
            "device override seed contains an unsupported action",
        )),
    }
}

fn read_u16(bytes: &[u8], cursor: &mut usize) -> Result<u16, Error> {
    let chunk = bytes
        .get(*cursor..*cursor + 2)
        .ok_or_else(|| Error::illegal_argument("device override seed is truncated"))?;
    *cursor += 2;
    Ok(u16::from_le_bytes(chunk.try_into().unwrap()))
}

fn read_u32(bytes: &[u8], cursor: &mut usize) -> Result<u32, Error> {
    let chunk = bytes
        .get(*cursor..*cursor + 4)
        .ok_or_else(|| Error::illegal_argument("device override seed is truncated"))?;
    *cursor += 4;
    Ok(u32::from_le_bytes(chunk.try_into().unwrap()))
}

fn read_u64(bytes: &[u8], cursor: &mut usize) -> Result<u64, Error> {
    let chunk = bytes
        .get(*cursor..*cursor + 8)
        .ok_or_else(|| Error::illegal_argument("device override seed is truncated"))?;
    *cursor += 8;
    Ok(u64::from_le_bytes(chunk.try_into().unwrap()))
}

#[cfg(test)]
mod tests {
    use libafl::inputs::ToTargetBytesConverter;

    use super::{
        ACTION_RECORD_SIZE, GROUP_HEADER_SIZE, ScenarioCodec, decode_scenario, encode_scenario,
    };
    use crate::input::{DeviceOverride, ScenarioInput};

    #[test]
    fn override_seed_round_trips_with_fixed_wire_records() {
        let input = ScenarioInput::new(vec![
            DeviceOverride::MmioRead {
                address: 0x14,
                width: 4,
                value: 0x0200_0103,
            },
            DeviceOverride::QueueDma {
                operation: 4,
                direction: 2,
                path: 1,
                sequence: 7,
                queue: 0,
                payload_len: 70,
                used_len: 4156,
            },
        ]);

        let bytes = encode_scenario(&input);
        assert_eq!(bytes.len(), GROUP_HEADER_SIZE + 2 * ACTION_RECORD_SIZE);
        assert_eq!(decode_scenario(&bytes).expect("seed should decode"), input);

        let mut codec = ScenarioCodec::new();
        let target = codec.convert_to_target_bytes(&mut (), &input);
        assert_eq!(target.as_ref(), bytes.as_slice());
    }

    #[test]
    fn complete_execution_actions_are_rejected() {
        let mut bytes = vec![1, 0, 0, 0];
        bytes.extend_from_slice(&[2, 0, 0, 0]);
        bytes.extend_from_slice(&[0; 36]);

        assert!(decode_scenario(&bytes).is_err());
    }

    #[test]
    fn bare_mmio_reads_are_rejected_until_they_carry_an_override_flag() {
        let mut bytes = vec![1, 0, 0, 0];
        bytes.extend_from_slice(&[2, 1, 0, 0]);
        bytes.extend_from_slice(&[0; 36]);

        assert!(decode_scenario(&bytes).is_err());
    }

    #[test]
    fn empty_seed_decodes_to_a_native_noop() {
        assert!(
            decode_scenario(&[])
                .expect("empty seed should decode")
                .is_valid()
        );
    }
}
