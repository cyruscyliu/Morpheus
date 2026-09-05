use alloc::vec::Vec;

use libafl::{
    Error,
    inputs::{FromTargetBytesConverter, ToTargetBytesConverter},
};
use libafl_bolts::ownedref::OwnedSlice;

use crate::input::{
    Action, ActionGroup, CpuAction, HyperAction, PageTableAction, ScenarioInput, VmAction,
};

pub const GROUP_HEADER_SIZE: usize = 4;
pub const ACTION_RECORD_SIZE: usize = 40;

const FAMILY_VM: u8 = 0;
const FAMILY_CPU: u8 = 1;
const FAMILY_HYPER: u8 = 2;
const FAMILY_PAGE_TABLE: u8 = 3;

#[derive(Debug, Clone, Copy, Default)]
pub struct ScenarioCodec;

impl ScenarioCodec {
    #[must_use]
    pub fn new() -> Self {
        Self
    }
}

#[must_use]
pub fn encode_scenario(input: &ScenarioInput) -> Vec<u8> {
    let mut bytes = Vec::new();
    for group in input.groups() {
        bytes.extend_from_slice(&(group.actions().len() as u32).to_le_bytes());
        for action in group.actions() {
            encode_action(action, &mut bytes);
        }
    }
    bytes
}

pub fn decode_scenario(bytes: &[u8]) -> Result<ScenarioInput, Error> {
    let mut cursor = 0usize;
    let mut groups = Vec::new();

    while cursor < bytes.len() {
        let action_count = read_u32(bytes, &mut cursor)? as usize;
        if action_count == 0 {
            return Err(Error::illegal_argument(
                "group action count must be non-zero",
            ));
        }

        let mut actions = Vec::with_capacity(action_count);
        for _ in 0..action_count {
            actions.push(decode_action(bytes, &mut cursor)?);
        }
        groups.push(ActionGroup::new(actions));
    }

    let scenario = ScenarioInput::new(groups);
    if !scenario.is_valid() {
        return Err(Error::illegal_argument("decoded scenario is invalid"));
    }

    Ok(scenario)
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

fn encode_action(action: &Action, bytes: &mut Vec<u8>) {
    let (family, opcode, flags, arg0, arg1, arg2, arg3): (u8, u8, u16, u64, u64, u64, u64) =
        match action {
            Action::Vm(VmAction::Stop) => (FAMILY_VM, 0, 0, 0, 0, 0, 0),
            Action::Vm(VmAction::Continue) => (FAMILY_VM, 1, 0, 0, 0, 0, 0),
            Action::Vm(VmAction::Reset) => (FAMILY_VM, 2, 0, 0, 0, 0, 0),
            Action::Cpu(CpuAction::QueryCpus) => (FAMILY_CPU, 0, 0, 0, 0, 0, 0),
            Action::Cpu(CpuAction::QueryHotpluggableCpus) => (FAMILY_CPU, 1, 0, 0, 0, 0, 0),
            Action::Cpu(CpuAction::CpuDeviceAdd {
                socket_id,
                core_id,
                thread_id,
            }) => (
                FAMILY_CPU,
                2,
                0,
                u64::from(*socket_id),
                u64::from(*core_id),
                u64::from(*thread_id),
                0,
            ),
            Action::Cpu(CpuAction::CpuDeviceDel) => (FAMILY_CPU, 3, 0, 0, 0, 0, 0),
            Action::Hyper(HyperAction::MmioWrite { addr, width, value }) => {
                (FAMILY_HYPER, 0, 0, *addr, u64::from(*width), *value, 0)
            }
            Action::Hyper(HyperAction::MmioRead { addr, width }) => {
                (FAMILY_HYPER, 1, 0, *addr, u64::from(*width), 0, 0)
            }
            Action::Hyper(HyperAction::MmioReadOverride { addr, width, value }) => {
                // Bit zero marks arg2 as an explicit device-side read result.
                // The seed record is kept separate from the legacy MMIO read
                // record so old target-byte inputs remain decodable.
                (FAMILY_HYPER, 1, 1, *addr, u64::from(*width), *value, 0)
            }
            Action::Hyper(HyperAction::DmaEvent {
                operation,
                direction,
                path,
                sequence,
                addr,
                len,
            }) => (
                FAMILY_HYPER,
                11,
                0,
                *addr,
                u64::from(*len),
                u64::from(*operation)
                    | (u64::from(*direction) << 8)
                    | (u64::from(*path) << 16),
                u64::from(*sequence),
            ),
            Action::Hyper(HyperAction::QueueDmaWrite {
                operation,
                direction,
                path,
                sequence,
                queue,
                payload_len,
                used_len,
            }) => (
                FAMILY_HYPER,
                12,
                0,
                u64::from(*queue),
                u64::from(*payload_len),
                u64::from(*used_len),
                u64::from(*operation)
                    | (u64::from(*direction) << 8)
                    | (u64::from(*path) << 16)
                    | (u64::from(*sequence) << 24),
            ),
            Action::Hyper(HyperAction::PioWrite { port, width, value }) => {
                (FAMILY_HYPER, 2, 0, *port, u64::from(*width), *value, 0)
            }
            Action::Hyper(HyperAction::PioRead { port, width }) => {
                (FAMILY_HYPER, 3, 0, *port, u64::from(*width), 0, 0)
            }
            Action::Hyper(HyperAction::IrqInject {
                irq,
                vcpu,
                edge,
                count,
            }) => (
                FAMILY_HYPER,
                4,
                u16::from(*edge),
                u64::from(*irq),
                u64::from(*vcpu),
                u64::from(*count),
                0,
            ),
            Action::Hyper(HyperAction::WaitIrqAck { irq, vcpu }) => {
                (FAMILY_HYPER, 5, 0, u64::from(*irq), u64::from(*vcpu), 0, 0)
            }
            Action::Hyper(HyperAction::MemWrite { addr, width, value }) => {
                (FAMILY_HYPER, 6, 0, *addr, u64::from(*width), *value, 0)
            }
            Action::Hyper(HyperAction::MemRead { addr, width }) => {
                (FAMILY_HYPER, 7, 0, *addr, u64::from(*width), 0, 0)
            }
            Action::PageTable(PageTableAction::WalkGuestVa { va, root }) => {
                (FAMILY_PAGE_TABLE, 0, 0, *va, *root, 0, 0)
            }
            Action::PageTable(PageTableAction::ReadPte { table_pa, index }) => {
                (FAMILY_PAGE_TABLE, 1, 0, *table_pa, u64::from(*index), 0, 0)
            }
            Action::PageTable(PageTableAction::WritePte {
                table_pa,
                index,
                value,
            }) => (
                FAMILY_PAGE_TABLE,
                2,
                0,
                *table_pa,
                u64::from(*index),
                *value,
                0,
            ),
            Action::PageTable(PageTableAction::InvalidateTlb { vcpu, va }) => (
                FAMILY_PAGE_TABLE,
                3,
                u16::from(va.is_some()),
                u64::from(*vcpu),
                va.unwrap_or_default(),
                0,
                0,
            ),
        };

    bytes.push(family);
    bytes.push(opcode);
    bytes.extend_from_slice(&flags.to_le_bytes());
    bytes.extend_from_slice(&0u32.to_le_bytes());
    bytes.extend_from_slice(&arg0.to_le_bytes());
    bytes.extend_from_slice(&arg1.to_le_bytes());
    bytes.extend_from_slice(&arg2.to_le_bytes());
    bytes.extend_from_slice(&arg3.to_le_bytes());
}

fn decode_action(bytes: &[u8], cursor: &mut usize) -> Result<Action, Error> {
    if bytes.len().saturating_sub(*cursor) < ACTION_RECORD_SIZE {
        return Err(Error::illegal_argument("action record truncated"));
    }

    let family = bytes[*cursor];
    *cursor += 1;
    let opcode = bytes[*cursor];
    *cursor += 1;
    let flags = read_u16(bytes, cursor)?;
    let _reserved = read_u32(bytes, cursor)?;
    let arg0 = read_u64(bytes, cursor)?;
    let arg1 = read_u64(bytes, cursor)?;
    let arg2 = read_u64(bytes, cursor)?;
    let arg3 = read_u64(bytes, cursor)?;

    match (family, opcode) {
        (FAMILY_VM, 0) => Ok(Action::Vm(VmAction::Stop)),
        (FAMILY_VM, 1) => Ok(Action::Vm(VmAction::Continue)),
        (FAMILY_VM, 2) => Ok(Action::Vm(VmAction::Reset)),
        (FAMILY_CPU, 0) => Ok(Action::Cpu(CpuAction::QueryCpus)),
        (FAMILY_CPU, 1) => Ok(Action::Cpu(CpuAction::QueryHotpluggableCpus)),
        (FAMILY_CPU, 2) => Ok(Action::Cpu(CpuAction::CpuDeviceAdd {
            socket_id: u32::try_from(arg0)
                .map_err(|_| Error::illegal_argument("socket_id out of range"))?,
            core_id: u32::try_from(arg1)
                .map_err(|_| Error::illegal_argument("core_id out of range"))?,
            thread_id: u32::try_from(arg2)
                .map_err(|_| Error::illegal_argument("thread_id out of range"))?,
        })),
        (FAMILY_CPU, 3) => Ok(Action::Cpu(CpuAction::CpuDeviceDel)),
        (FAMILY_HYPER, 0) => Ok(Action::Hyper(HyperAction::MmioWrite {
            addr: arg0,
            width: u8::try_from(arg1)
                .map_err(|_| Error::illegal_argument("mmio width out of range"))?,
            value: arg2,
        })),
        (FAMILY_HYPER, 1) => {
            let width = u8::try_from(arg1)
                .map_err(|_| Error::illegal_argument("mmio width out of range"))?;
            if flags & 1 != 0 {
                Ok(Action::Hyper(HyperAction::MmioReadOverride {
                    addr: arg0,
                    width,
                    value: arg2,
                }))
            } else {
                Ok(Action::Hyper(HyperAction::MmioRead { addr: arg0, width }))
            }
        }
        (FAMILY_HYPER, 11) => Ok(Action::Hyper(HyperAction::DmaEvent {
            operation: u8::try_from(arg2 & 0xff)
                .map_err(|_| Error::illegal_argument("DMA operation out of range"))?,
            direction: u8::try_from((arg2 >> 8) & 0xff)
                .map_err(|_| Error::illegal_argument("DMA direction out of range"))?,
            path: u8::try_from((arg2 >> 16) & 0xff)
                .map_err(|_| Error::illegal_argument("DMA path out of range"))?,
            sequence: u16::try_from(arg3)
                .map_err(|_| Error::illegal_argument("DMA sequence out of range"))?,
            addr: arg0,
            len: u32::try_from(arg1)
                .map_err(|_| Error::illegal_argument("DMA length out of range"))?,
        })),
        (FAMILY_HYPER, 12) => Ok(Action::Hyper(HyperAction::QueueDmaWrite {
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
        })),
        (FAMILY_HYPER, 2) => Ok(Action::Hyper(HyperAction::PioWrite {
            port: arg0,
            width: u8::try_from(arg1)
                .map_err(|_| Error::illegal_argument("pio width out of range"))?,
            value: arg2,
        })),
        (FAMILY_HYPER, 3) => Ok(Action::Hyper(HyperAction::PioRead {
            port: arg0,
            width: u8::try_from(arg1)
                .map_err(|_| Error::illegal_argument("pio width out of range"))?,
        })),
        (FAMILY_HYPER, 4) => Ok(Action::Hyper(HyperAction::IrqInject {
            irq: u32::try_from(arg0).map_err(|_| Error::illegal_argument("irq out of range"))?,
            vcpu: u16::try_from(arg1).map_err(|_| Error::illegal_argument("vcpu out of range"))?,
            edge: (flags & 1) != 0,
            count: u32::try_from(arg2)
                .map_err(|_| Error::illegal_argument("irq count out of range"))?,
        })),
        (FAMILY_HYPER, 5) => Ok(Action::Hyper(HyperAction::WaitIrqAck {
            irq: u32::try_from(arg0).map_err(|_| Error::illegal_argument("irq out of range"))?,
            vcpu: u16::try_from(arg1).map_err(|_| Error::illegal_argument("vcpu out of range"))?,
        })),
        (FAMILY_HYPER, 6) => Ok(Action::Hyper(HyperAction::MemWrite {
            addr: arg0,
            width: u8::try_from(arg1)
                .map_err(|_| Error::illegal_argument("mem width out of range"))?,
            value: arg2,
        })),
        (FAMILY_HYPER, 7) => Ok(Action::Hyper(HyperAction::MemRead {
            addr: arg0,
            width: u8::try_from(arg1)
                .map_err(|_| Error::illegal_argument("mem width out of range"))?,
        })),
        (FAMILY_PAGE_TABLE, 0) => Ok(Action::PageTable(PageTableAction::WalkGuestVa {
            va: arg0,
            root: arg1,
        })),
        (FAMILY_PAGE_TABLE, 1) => Ok(Action::PageTable(PageTableAction::ReadPte {
            table_pa: arg0,
            index: u16::try_from(arg1)
                .map_err(|_| Error::illegal_argument("pte index out of range"))?,
        })),
        (FAMILY_PAGE_TABLE, 2) => Ok(Action::PageTable(PageTableAction::WritePte {
            table_pa: arg0,
            index: u16::try_from(arg1)
                .map_err(|_| Error::illegal_argument("pte index out of range"))?,
            value: arg2,
        })),
        (FAMILY_PAGE_TABLE, 3) => Ok(Action::PageTable(PageTableAction::InvalidateTlb {
            vcpu: u16::try_from(arg0).map_err(|_| Error::illegal_argument("vcpu out of range"))?,
            va: if (flags & 1) != 0 { Some(arg1) } else { None },
        })),
        _ => Err(Error::illegal_argument("unknown action record opcode")),
    }
}

fn read_u16(bytes: &[u8], cursor: &mut usize) -> Result<u16, Error> {
    let chunk = bytes
        .get(*cursor..*cursor + 2)
        .ok_or_else(|| Error::illegal_argument("buffer truncated"))?;
    *cursor += 2;
    Ok(u16::from_le_bytes(chunk.try_into().unwrap()))
}

fn read_u32(bytes: &[u8], cursor: &mut usize) -> Result<u32, Error> {
    let chunk = bytes
        .get(*cursor..*cursor + 4)
        .ok_or_else(|| Error::illegal_argument("buffer truncated"))?;
    *cursor += 4;
    Ok(u32::from_le_bytes(chunk.try_into().unwrap()))
}

fn read_u64(bytes: &[u8], cursor: &mut usize) -> Result<u64, Error> {
    let chunk = bytes
        .get(*cursor..*cursor + 8)
        .ok_or_else(|| Error::illegal_argument("buffer truncated"))?;
    *cursor += 8;
    Ok(u64::from_le_bytes(chunk.try_into().unwrap()))
}

#[cfg(test)]
mod tests {
    use libafl::inputs::ToTargetBytesConverter;

    use crate::input::{
        Action, ActionGroup, CpuAction, HyperAction, PageTableAction, ScenarioInput, VmAction,
    };
    use crate::{ACTION_RECORD_SIZE, GROUP_HEADER_SIZE};

    use super::{ScenarioCodec, decode_scenario, encode_scenario};

    #[test]
    fn round_trip_preserves_grouping() {
        let input = ScenarioInput::new(vec![
            ActionGroup::new(vec![
                Action::Vm(VmAction::Continue),
                Action::Cpu(CpuAction::QueryCpus),
            ]),
            ActionGroup::new(vec![
                Action::Hyper(HyperAction::MmioWrite {
                    addr: 0x1000,
                    width: 4,
                    value: 0x55,
                }),
                Action::PageTable(PageTableAction::InvalidateTlb {
                    vcpu: 2,
                    va: Some(0x2000),
                }),
                Action::Vm(VmAction::Stop),
            ]),
        ]);

        let bytes = encode_scenario(&input);
        let decoded = decode_scenario(&bytes).expect("decode should succeed");
        assert_eq!(input, decoded);

        let mut codec = ScenarioCodec::new();
        let bytes2 = codec.convert_to_target_bytes(&mut (), &input);
        assert_eq!(bytes.as_slice(), bytes2.as_ref());
    }

    #[test]
    fn low_level_seed_records_round_trip_without_high_level_device_actions() {
        let input = ScenarioInput::new(vec![ActionGroup::new(vec![
            Action::Hyper(HyperAction::MmioReadOverride {
                addr: 0x111,
                width: 1,
                value: 0xff,
            }),
            Action::Hyper(HyperAction::QueueDmaWrite {
                operation: 4,
                direction: 2,
                path: 1,
                sequence: 7,
                queue: 0,
                payload_len: 70,
                used_len: 4156,
            }),
        ])]);

        let bytes = encode_scenario(&input);
        assert_eq!(bytes.len(), GROUP_HEADER_SIZE + 2 * ACTION_RECORD_SIZE);
        assert_eq!(
            decode_scenario(&bytes).expect("decode should succeed"),
            input
        );
    }

    #[test]
    fn dma_observation_records_preserve_full_event_fields() {
        let input = ScenarioInput::new(vec![ActionGroup::new(vec![
            Action::Hyper(HyperAction::DmaEvent {
                operation: 6,
                direction: 2,
                path: 1,
                sequence: 0x1234,
                addr: 0x1_0000_2000,
                len: 4156,
            }),
        ])]);

        let bytes = encode_scenario(&input);
        assert_eq!(bytes.len(), GROUP_HEADER_SIZE + ACTION_RECORD_SIZE);
        assert_eq!(decode_scenario(&bytes).expect("decode should succeed"), input);
    }
}
