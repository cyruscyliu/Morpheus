use core::fmt::Debug;

use libafl::{
    inputs::{HasTargetBytes, Input},
};
use libafl_bolts::{HasLen, ownedref::OwnedSlice};
use serde::{Deserialize, Serialize};

use crate::encoding::encode_scenario;

#[derive(Clone, Debug, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct ScenarioInput {
    groups: Vec<ActionGroup>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct ActionGroup {
    actions: Vec<Action>,
}

#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum Action {
    Vm(VmAction),
    Cpu(CpuAction),
    Hyper(HyperAction),
    PageTable(PageTableAction),
}

#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum VmAction {
    Stop,
    Continue,
    Reset,
}

#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum CpuAction {
    QueryCpus,
    QueryHotpluggableCpus,
    CpuDeviceAdd {
        socket_id: u32,
        core_id: u32,
        thread_id: u32,
    },
    CpuDeviceDel,
}

#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum HyperAction {
    MmioWrite { addr: u64, width: u8, value: u64 },
    MmioRead { addr: u64, width: u8 },
    PioWrite { port: u64, width: u8, value: u64 },
    PioRead { port: u64, width: u8 },
    IrqInject { irq: u32, vcpu: u16, edge: bool, count: u32 },
    WaitIrqAck { irq: u32, vcpu: u16 },
    MemWrite { addr: u64, width: u8, value: u64 },
    MemRead { addr: u64, width: u8 },
}

#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum PageTableAction {
    WalkGuestVa { va: u64, root: u64 },
    ReadPte { table_pa: u64, index: u16 },
    WritePte { table_pa: u64, index: u16, value: u64 },
    InvalidateTlb { vcpu: u16, va: Option<u64> },
}

impl ScenarioInput {
    #[must_use]
    pub fn new(groups: Vec<ActionGroup>) -> Self {
        Self { groups }
    }

    #[must_use]
    pub fn groups(&self) -> &[ActionGroup] {
        &self.groups
    }

    #[must_use]
    pub fn groups_mut(&mut self) -> &mut Vec<ActionGroup> {
        &mut self.groups
    }

    #[must_use]
    pub fn is_valid(&self) -> bool {
        !self.groups.is_empty() && self.groups.iter().all(ActionGroup::is_valid)
    }

    #[must_use]
    pub fn total_actions(&self) -> usize {
        self.groups.iter().map(ActionGroup::len).sum()
    }

    pub fn ensure_terminal_stop(&mut self) {
        if self.groups.is_empty() {
            self.groups.push(ActionGroup::new(vec![Action::Vm(VmAction::Stop)]));
            return;
        }

        let last_group = self.groups.last_mut().expect("groups checked to be non-empty");
        if last_group.actions.is_empty() {
            last_group.actions.push(Action::Vm(VmAction::Stop));
            return;
        }

        if !matches!(last_group.actions.last(), Some(Action::Vm(VmAction::Stop))) {
            last_group.actions.push(Action::Vm(VmAction::Stop));
        }
    }
}

impl ActionGroup {
    #[must_use]
    pub fn new(actions: Vec<Action>) -> Self {
        Self { actions }
    }

    #[must_use]
    pub fn actions(&self) -> &[Action] {
        &self.actions
    }

    #[must_use]
    pub fn actions_mut(&mut self) -> &mut Vec<Action> {
        &mut self.actions
    }

    #[must_use]
    pub fn len(&self) -> usize {
        self.actions.len()
    }

    #[must_use]
    pub fn is_valid(&self) -> bool {
        !self.actions.is_empty()
    }
}

impl Input for ScenarioInput {}

impl HasLen for ScenarioInput {
    fn len(&self) -> usize {
        self.total_actions()
    }
}

impl HasTargetBytes for ScenarioInput {
    fn target_bytes(&self) -> OwnedSlice<'_, u8> {
        OwnedSlice::from(encode_scenario(self))
    }
}
