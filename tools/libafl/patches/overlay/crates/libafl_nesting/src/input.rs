use core::fmt::Debug;

use libafl::inputs::{HasTargetBytes, Input};
use libafl_bolts::{HasLen, ownedref::OwnedSlice};
use serde::{Deserialize, Serialize};

use crate::encoding::encode_scenario;

#[derive(Clone, Debug, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct ScenarioInput {
    groups: Vec<ActionGroup>,
    // Keep the optional provenance field in postcard's sequence.  Postcard
    // does not support omitting a trailing field and then applying serde's
    // default during deserialization; doing so makes a freshly written
    // testcase fail to load from `OnDiskCorpus` with
    // `DeserializeUnexpectedEnd`.
    #[serde(default)]
    devilang_path: Option<DevilangPath>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct DevilangPath {
    steps: Vec<DevilangPathStep>,
}

#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct DevilangPathStep {
    machine: String,
    from: String,
    to: String,
    trace: String,
    decisions: Vec<DevilangTraceDecision>,
    #[serde(default = "default_devilang_path_step_emits_group")]
    emits_group: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum DevilangTraceDecision {
    Branch { taken: bool },
    Repeat { iterations: u8 },
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
    MmioWrite {
        addr: u64,
        width: u8,
        value: u64,
    },
    MmioRead {
        addr: u64,
        width: u8,
    },
    PioWrite {
        port: u64,
        width: u8,
        value: u64,
    },
    PioRead {
        port: u64,
        width: u8,
    },
    IrqInject {
        irq: u32,
        vcpu: u16,
        edge: bool,
        count: u32,
    },
    WaitIrqAck {
        irq: u32,
        vcpu: u16,
    },
    MemWrite {
        addr: u64,
        width: u8,
        value: u64,
    },
    MemRead {
        addr: u64,
        width: u8,
    },
}

#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum PageTableAction {
    WalkGuestVa {
        va: u64,
        root: u64,
    },
    ReadPte {
        table_pa: u64,
        index: u16,
    },
    WritePte {
        table_pa: u64,
        index: u16,
        value: u64,
    },
    InvalidateTlb {
        vcpu: u16,
        va: Option<u64>,
    },
}

impl ScenarioInput {
    #[must_use]
    pub fn new(groups: Vec<ActionGroup>) -> Self {
        Self {
            groups,
            devilang_path: None,
        }
    }

    #[must_use]
    pub fn with_devilang_path(groups: Vec<ActionGroup>, devilang_path: DevilangPath) -> Self {
        Self {
            groups,
            devilang_path: Some(devilang_path),
        }
    }

    #[must_use]
    pub fn groups(&self) -> &[ActionGroup] {
        &self.groups
    }

    #[must_use]
    pub fn groups_mut(&mut self) -> &mut Vec<ActionGroup> {
        self.devilang_path = None;
        &mut self.groups
    }

    #[must_use]
    pub fn devilang_path(&self) -> Option<&DevilangPath> {
        self.devilang_path.as_ref()
    }

    pub fn clear_devilang_path(&mut self) {
        self.devilang_path = None;
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
            self.groups
                .push(ActionGroup::new(vec![Action::Vm(VmAction::Stop)]));
            return;
        }

        let last_group = self
            .groups
            .last_mut()
            .expect("groups checked to be non-empty");
        if last_group.actions.is_empty() {
            last_group.actions.push(Action::Vm(VmAction::Stop));
            return;
        }

        if !matches!(last_group.actions.last(), Some(Action::Vm(VmAction::Stop))) {
            last_group.actions.push(Action::Vm(VmAction::Stop));
        }
    }
}

impl DevilangPath {
    #[must_use]
    pub fn new(steps: Vec<DevilangPathStep>) -> Self {
        Self { steps }
    }

    #[must_use]
    pub fn steps(&self) -> &[DevilangPathStep] {
        &self.steps
    }
}

impl DevilangPathStep {
    #[must_use]
    pub fn new(
        machine: String,
        from: String,
        to: String,
        trace: String,
        decisions: Vec<DevilangTraceDecision>,
    ) -> Self {
        Self::with_group(machine, from, to, trace, decisions, true)
    }

    #[must_use]
    pub fn with_group(
        machine: String,
        from: String,
        to: String,
        trace: String,
        decisions: Vec<DevilangTraceDecision>,
        emits_group: bool,
    ) -> Self {
        Self {
            machine,
            from,
            to,
            trace,
            decisions,
            emits_group,
        }
    }

    #[must_use]
    pub fn machine(&self) -> &str {
        &self.machine
    }

    #[must_use]
    pub fn from(&self) -> &str {
        &self.from
    }

    #[must_use]
    pub fn to(&self) -> &str {
        &self.to
    }

    #[must_use]
    pub fn trace(&self) -> &str {
        &self.trace
    }

    #[must_use]
    pub fn decisions(&self) -> &[DevilangTraceDecision] {
        &self.decisions
    }

    #[must_use]
    pub fn emits_group(&self) -> bool {
        self.emits_group
    }
}

const fn default_devilang_path_step_emits_group() -> bool {
    true
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
    pub fn is_empty(&self) -> bool {
        self.actions.is_empty()
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

#[cfg(all(test, feature = "std"))]
mod tests {
    use super::{Action, ActionGroup, HyperAction, ScenarioInput, VmAction};
    use libafl::inputs::Input;
    use std::{fs, time::{SystemTime, UNIX_EPOCH}};

    #[test]
    fn postcard_file_round_trip_matches_ondisk_corpus() {
        let input = ScenarioInput::new(vec![ActionGroup::new(vec![
            Action::Hyper(HyperAction::MmioWrite {
                addr: 0,
                width: 2,
                value: 0,
            }),
            Action::Vm(VmAction::Stop),
        ])]);
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
        assert_eq!(bytes.len(), 10);
        assert_eq!(decoded, input);
    }
}
