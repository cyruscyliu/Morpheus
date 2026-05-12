use core::num::NonZeroUsize;

use libafl::{Error, generators::Generator};
use libafl_bolts::{nonzero, rands::Rand};

use crate::input::{
    Action, ActionGroup, CpuAction, HyperAction, PageTableAction, ScenarioInput, VmAction,
};

#[derive(Debug, Clone)]
pub struct ScenarioGenerator {
    max_groups: NonZeroUsize,
    max_actions_per_group: NonZeroUsize,
}

impl Default for ScenarioGenerator {
    fn default() -> Self {
        Self::new(nonzero!(4), nonzero!(6))
    }
}

impl ScenarioGenerator {
    #[must_use]
    pub fn new(max_groups: NonZeroUsize, max_actions_per_group: NonZeroUsize) -> Self {
        Self {
            max_groups,
            max_actions_per_group,
        }
    }

    pub(crate) fn random_action<R: Rand>(rand: &mut R) -> Action {
        match rand.below(nonzero!(4)) {
            0 => Action::Vm(match rand.below(nonzero!(3)) {
                0 => VmAction::Continue,
                1 => VmAction::Reset,
                _ => VmAction::Stop,
            }),
            1 => Action::Cpu(match rand.below(nonzero!(4)) {
                0 => CpuAction::QueryCpus,
                1 => CpuAction::QueryHotpluggableCpus,
                2 => CpuAction::CpuDeviceAdd {
                    socket_id: rand.below(nonzero!(8)) as u32,
                    core_id: rand.below(nonzero!(8)) as u32,
                    thread_id: rand.below(nonzero!(8)) as u32,
                },
                _ => CpuAction::CpuDeviceDel,
            }),
            2 => Action::Hyper(match rand.below(nonzero!(8)) {
                0 => HyperAction::MmioWrite {
                    addr: rand.below(nonzero!(1_024)) as u64,
                    width: 1 + rand.below(nonzero!(8)) as u8,
                    value: rand.below(nonzero!(1_000)) as u64,
                },
                1 => HyperAction::MmioRead {
                    addr: rand.below(nonzero!(1_024)) as u64,
                    width: 1 + rand.below(nonzero!(8)) as u8,
                },
                2 => HyperAction::PioWrite {
                    port: rand.below(nonzero!(1_024)) as u64,
                    width: 1 + rand.below(nonzero!(4)) as u8,
                    value: rand.below(nonzero!(1_000)) as u64,
                },
                3 => HyperAction::PioRead {
                    port: rand.below(nonzero!(1_024)) as u64,
                    width: 1 + rand.below(nonzero!(4)) as u8,
                },
                4 => HyperAction::IrqInject {
                    irq: rand.below(nonzero!(256)) as u32,
                    vcpu: rand.below(nonzero!(8)) as u16,
                    edge: rand.below(nonzero!(2)) == 1,
                    count: 1 + rand.below(nonzero!(8)) as u32,
                },
                5 => HyperAction::WaitIrqAck {
                    irq: rand.below(nonzero!(256)) as u32,
                    vcpu: rand.below(nonzero!(8)) as u16,
                },
                6 => HyperAction::MemWrite {
                    addr: rand.below(nonzero!(1_024)) as u64,
                    width: 1 + rand.below(nonzero!(8)) as u8,
                    value: rand.below(nonzero!(1_000)) as u64,
                },
                _ => HyperAction::MemRead {
                    addr: rand.below(nonzero!(1_024)) as u64,
                    width: 1 + rand.below(nonzero!(8)) as u8,
                },
            }),
            _ => Action::PageTable(match rand.below(nonzero!(4)) {
                0 => PageTableAction::WalkGuestVa {
                    va: rand.below(nonzero!(1_024)) as u64,
                    root: rand.below(nonzero!(1_024)) as u64,
                },
                1 => PageTableAction::ReadPte {
                    table_pa: rand.below(nonzero!(1_024)) as u64,
                    index: rand.below(nonzero!(512)) as u16,
                },
                2 => PageTableAction::WritePte {
                    table_pa: rand.below(nonzero!(1_024)) as u64,
                    index: rand.below(nonzero!(512)) as u16,
                    value: rand.below(nonzero!(1_000)) as u64,
                },
                _ => PageTableAction::InvalidateTlb {
                    vcpu: rand.below(nonzero!(8)) as u16,
                    va: if rand.below(nonzero!(2)) == 1 {
                        Some(rand.below(nonzero!(1_024)) as u64)
                    } else {
                        None
                    },
                },
            }),
        }
    }
}

impl<S> Generator<ScenarioInput, S> for ScenarioGenerator
where
    S: libafl::state::HasRand,
{
    fn generate(&mut self, state: &mut S) -> Result<ScenarioInput, Error> {
        let group_count = 1 + state.rand_mut().below(self.max_groups);
        let mut groups = Vec::with_capacity(group_count);
        for group_idx in 0..group_count {
            let action_limit = if group_idx + 1 == group_count {
                self.max_actions_per_group.get().max(1)
            } else {
                self.max_actions_per_group.get().max(2) - 1
            };
            let action_count = 1 + state.rand_mut().below(unsafe {
                NonZeroUsize::new_unchecked(action_limit)
            });

            let mut actions = Vec::with_capacity(action_count);
            for _ in 0..action_count {
                actions.push(Self::random_action(state.rand_mut()));
            }
            groups.push(ActionGroup::new(actions));
        }

        let mut scenario = ScenarioInput::new(groups);
        scenario.ensure_terminal_stop();
        Ok(scenario)
    }
}

#[cfg(test)]
mod tests {
    use libafl::state::HasRand;
    use libafl_bolts::rands::StdRand;

    use super::*;

    #[derive(Clone, Debug)]
    struct TestState {
        rand: StdRand,
    }

    impl HasRand for TestState {
        type Rand = StdRand;

        fn rand(&self) -> &Self::Rand {
            &self.rand
        }

        fn rand_mut(&mut self) -> &mut Self::Rand {
            &mut self.rand
        }
    }

    impl Default for TestState {
        fn default() -> Self {
            Self {
                rand: StdRand::with_seed(0),
            }
        }
    }

    #[test]
    fn generator_produces_valid_input() {
        let mut state = TestState::default();
        let mut generator = ScenarioGenerator::default();
        let input = generator.generate(&mut state).expect("generator should work");

        assert!(input.is_valid());
        assert!(matches!(
            input.groups().last().and_then(|g| g.actions().last()),
            Some(Action::Vm(crate::input::VmAction::Stop))
        ));
    }
}
