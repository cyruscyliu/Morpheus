use std::vec::Vec;

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
            return Err(Error::illegal_argument("group action count must be non-zero"));
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
            if va.is_some() { 1 } else { 0 },
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
    let _arg3 = read_u64(bytes, cursor)?;

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
        (FAMILY_HYPER, 1) => Ok(Action::Hyper(HyperAction::MmioRead {
            addr: arg0,
            width: u8::try_from(arg1)
                .map_err(|_| Error::illegal_argument("mmio width out of range"))?,
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
            irq: u32::try_from(arg0)
                .map_err(|_| Error::illegal_argument("irq out of range"))?,
            vcpu: u16::try_from(arg1)
                .map_err(|_| Error::illegal_argument("vcpu out of range"))?,
            edge: (flags & 1) != 0,
            count: u32::try_from(arg2)
                .map_err(|_| Error::illegal_argument("irq count out of range"))?,
        })),
        (FAMILY_HYPER, 5) => Ok(Action::Hyper(HyperAction::WaitIrqAck {
            irq: u32::try_from(arg0)
                .map_err(|_| Error::illegal_argument("irq out of range"))?,
            vcpu: u16::try_from(arg1)
                .map_err(|_| Error::illegal_argument("vcpu out of range"))?,
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
            vcpu: u16::try_from(arg0)
                .map_err(|_| Error::illegal_argument("vcpu out of range"))?,
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
}
