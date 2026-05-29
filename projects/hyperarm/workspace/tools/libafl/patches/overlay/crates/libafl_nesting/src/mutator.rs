use std::borrow::Cow;
use core::num::NonZeroUsize;

use libafl::{
    Error,
    generators::Generator,
    mutators::{MutationResult, Mutator},
};
use libafl_bolts::{Named, nonzero, rands::Rand};

use crate::{
    generator::ScenarioGenerator,
    input::{Action, ActionGroup, ScenarioInput},
};

#[derive(Debug, Clone)]
pub struct ScenarioMutator {
    generator: ScenarioGenerator,
}

impl Default for ScenarioMutator {
    fn default() -> Self {
        Self::new(ScenarioGenerator::default())
    }
}

impl ScenarioMutator {
    #[must_use]
    pub fn new(generator: ScenarioGenerator) -> Self {
        Self { generator }
    }

    fn random_group_index<R: Rand>(rand: &mut R, len: usize) -> Option<usize> {
        if len == 0 {
            None
        } else {
            Some(rand.below(unsafe { NonZeroUsize::new_unchecked(len) }))
        }
    }

    fn random_action_index<R: Rand>(rand: &mut R, len: usize) -> Option<usize> {
        Self::random_group_index(rand, len)
    }

    fn mutate_field<R: Rand>(rand: &mut R, action: &mut Action) -> bool {
        match action {
            Action::Vm(vm) => {
                *vm = match rand.below(nonzero!(3)) {
                    0 => crate::input::VmAction::Stop,
                    1 => crate::input::VmAction::Continue,
                    _ => crate::input::VmAction::Reset,
                };
                true
            }
            Action::Cpu(cpu) => match cpu {
                crate::input::CpuAction::CpuDeviceAdd {
                    socket_id,
                    core_id,
                    thread_id,
                } => {
                    match rand.below(nonzero!(3)) {
                        0 => *socket_id ^= 1 + rand.below(nonzero!(7)) as u32,
                        1 => *core_id ^= 1 + rand.below(nonzero!(7)) as u32,
                        _ => *thread_id ^= 1 + rand.below(nonzero!(7)) as u32,
                    }
                    true
                }
                _ => {
                    *cpu = match rand.below(nonzero!(4)) {
                        0 => crate::input::CpuAction::QueryCpus,
                        1 => crate::input::CpuAction::QueryHotpluggableCpus,
                        2 => crate::input::CpuAction::CpuDeviceAdd {
                            socket_id: rand.below(nonzero!(8)) as u32,
                            core_id: rand.below(nonzero!(8)) as u32,
                            thread_id: rand.below(nonzero!(8)) as u32,
                        },
                        _ => crate::input::CpuAction::CpuDeviceDel,
                    };
                    true
                }
            },
            Action::Hyper(hyper) => match hyper {
                crate::input::HyperAction::MmioWrite { addr, width, value }
                | crate::input::HyperAction::MemWrite { addr, width, value }
                | crate::input::HyperAction::PioWrite {
                    port: addr,
                    width,
                    value,
                } => {
                    match rand.below(nonzero!(3)) {
                        0 => *addr ^= 1 + rand.below(nonzero!(31)) as u64,
                        1 => *width = 1 + rand.below(nonzero!(8)) as u8,
                        _ => *value ^= 1 + rand.below(nonzero!(63)) as u64,
                    }
                    true
                }
                crate::input::HyperAction::MmioRead { addr, width }
                | crate::input::HyperAction::MemRead { addr, width }
                | crate::input::HyperAction::PioRead { port: addr, width } => {
                    match rand.below(nonzero!(2)) {
                        0 => *addr ^= 1 + rand.below(nonzero!(31)) as u64,
                        _ => *width = 1 + rand.below(nonzero!(8)) as u8,
                    }
                    true
                }
                crate::input::HyperAction::IrqInject {
                    irq,
                    vcpu,
                    edge,
                    count,
                } => {
                    match rand.below(nonzero!(4)) {
                        0 => *irq ^= 1 + rand.below(nonzero!(31)) as u32,
                        1 => *vcpu ^= 1 + rand.below(nonzero!(7)) as u16,
                        2 => *edge = !*edge,
                        _ => *count ^= 1 + rand.below(nonzero!(7)) as u32,
                    }
                    true
                }
                crate::input::HyperAction::WaitIrqAck { irq, vcpu } => {
                    if rand.below(nonzero!(2)) == 0 {
                        *irq ^= 1 + rand.below(nonzero!(31)) as u32;
                    } else {
                        *vcpu ^= 1 + rand.below(nonzero!(7)) as u16;
                    }
                    true
                }
            },
            Action::PageTable(page) => match page {
                crate::input::PageTableAction::WalkGuestVa { va, root } => {
                    if rand.below(nonzero!(2)) == 0 {
                        *va ^= 1 + rand.below(nonzero!(31)) as u64;
                    } else {
                        *root ^= 1 + rand.below(nonzero!(31)) as u64;
                    }
                    true
                }
                crate::input::PageTableAction::ReadPte { table_pa, index } => {
                    if rand.below(nonzero!(2)) == 0 {
                        *table_pa ^= 1 + rand.below(nonzero!(31)) as u64;
                    } else {
                        *index ^= 1 + rand.below(nonzero!(15)) as u16;
                    }
                    true
                }
                crate::input::PageTableAction::WritePte {
                    table_pa,
                    index,
                    value,
                } => match rand.below(nonzero!(3)) {
                    0 => {
                        *table_pa ^= 1 + rand.below(nonzero!(31)) as u64;
                        true
                    }
                    1 => {
                        *index ^= 1 + rand.below(nonzero!(15)) as u16;
                        true
                    }
                    _ => {
                        *value ^= 1 + rand.below(nonzero!(63)) as u64;
                        true
                    }
                },
                crate::input::PageTableAction::InvalidateTlb { vcpu, va } => {
                    if rand.below(nonzero!(2)) == 0 {
                        *vcpu ^= 1 + rand.below(nonzero!(7)) as u16;
                    } else if let Some(inner) = va {
                        *inner ^= 1 + rand.below(nonzero!(31)) as u64;
                    } else {
                        *va = Some(rand.below(nonzero!(1_024)) as u64);
                    }
                    true
                }
            },
        }
    }

    fn ensure_terminal_stop(input: &mut ScenarioInput) {
        input.ensure_terminal_stop();
    }

    fn generated_group<S>(&mut self, state: &mut S) -> Result<ActionGroup, Error>
    where
        S: libafl::state::HasRand,
    {
        let mut generated = self.generator.generate(state)?;
        Ok(generated.groups_mut().remove(0))
    }
}

impl Named for ScenarioMutator {
    fn name(&self) -> &Cow<'static, str> {
        static NAME: Cow<'static, str> = Cow::Borrowed("ScenarioMutator");
        &NAME
    }
}

impl<S> Mutator<ScenarioInput, S> for ScenarioMutator
where
    S: libafl::state::HasRand,
{
    fn mutate(&mut self, state: &mut S, input: &mut ScenarioInput) -> Result<MutationResult, Error> {
        if input.groups().is_empty() {
            input.groups_mut().push(ActionGroup::new(vec![Action::Vm(
                crate::input::VmAction::Stop,
            )]));
            return Ok(MutationResult::Mutated);
        }

        let op = state.rand_mut().below(nonzero!(14));
        let mut mutated = false;

        match op {
            0 => {
                if let Some(group_idx) =
                    Self::random_group_index(state.rand_mut(), input.groups().len())
                {
                    let group = &mut input.groups_mut()[group_idx];
                    if let Some(action_idx) =
                        Self::random_action_index(state.rand_mut(), group.len())
                    {
                        mutated = Self::mutate_field(state.rand_mut(), &mut group.actions_mut()[action_idx]);
                    }
                }
            }
            1 => {
                if let Some(group_idx) =
                    Self::random_group_index(state.rand_mut(), input.groups().len())
                {
                    let group = &mut input.groups_mut()[group_idx];
                    if let Some(action_idx) =
                        Self::random_action_index(state.rand_mut(), group.len())
                    {
                        group.actions_mut()[action_idx] = ScenarioGenerator::random_action(state.rand_mut());
                        mutated = true;
                    }
                }
            }
            2 => {
                if let Some(group_idx) =
                    Self::random_group_index(state.rand_mut(), input.groups().len())
                {
                    let group = &mut input.groups_mut()[group_idx];
                    let insert_at = if group.len() == 0 {
                        0
                    } else {
                        state.rand_mut().below(unsafe {
                            NonZeroUsize::new_unchecked(group.len() + 1)
                        })
                    };
                    group
                        .actions_mut()
                        .insert(insert_at, ScenarioGenerator::random_action(state.rand_mut()));
                    mutated = true;
                }
            }
            3 => {
                if let Some(group_idx) =
                    Self::random_group_index(state.rand_mut(), input.groups().len())
                {
                    let group = &mut input.groups_mut()[group_idx];
                    if group.len() > 1 {
                        let remove_at = state.rand_mut().below(unsafe {
                            NonZeroUsize::new_unchecked(group.len() - 1)
                        });
                        group.actions_mut().remove(remove_at);
                        mutated = true;
                    }
                }
            }
            4 => {
                if let Some(group_idx) =
                    Self::random_group_index(state.rand_mut(), input.groups().len())
                {
                    let group = &mut input.groups_mut()[group_idx];
                    if let Some(action_idx) =
                        Self::random_action_index(state.rand_mut(), group.len())
                    {
                        let action = group.actions()[action_idx].clone();
                        group.actions_mut().insert(action_idx, action);
                        mutated = true;
                    }
                }
            }
            5 => {
                if let Some(group_idx) =
                    Self::random_group_index(state.rand_mut(), input.groups().len())
                {
                    let group = &mut input.groups_mut()[group_idx];
                    if group.len() > 1 {
                        let new_len = 1 + state.rand_mut().below(unsafe {
                            NonZeroUsize::new_unchecked(group.len())
                        });
                        group.actions_mut().truncate(new_len);
                        mutated = true;
                    }
                }
            }
            6 => {
                if let Some(group_idx) =
                    Self::random_group_index(state.rand_mut(), input.groups().len())
                {
                    let group = &mut input.groups_mut()[group_idx];
                    let insert_at = if group.len() == 0 {
                        0
                    } else {
                        group.len().saturating_sub(1)
                    };
                    group
                        .actions_mut()
                        .insert(insert_at, ScenarioGenerator::random_action(state.rand_mut()));
                    mutated = true;
                }
            }
            7 => {
                input.groups_mut().push(self.generated_group(state)?);
                mutated = true;
            }
            8 => {
                if input.groups().len() > 1 {
                    let remove_at = state.rand_mut().below(unsafe {
                        NonZeroUsize::new_unchecked(input.groups().len() - 1)
                    });
                    input.groups_mut().remove(remove_at);
                    mutated = true;
                }
            }
            9 => {
                if let Some(group_idx) =
                    Self::random_group_index(state.rand_mut(), input.groups().len())
                {
                    let cloned = input.groups()[group_idx].clone();
                    input.groups_mut().insert(group_idx, cloned);
                    mutated = true;
                }
            }
            10 => {
                if input.groups().len() > 1 {
                    let a = state.rand_mut().below(unsafe {
                        NonZeroUsize::new_unchecked(input.groups().len())
                    });
                    let mut b = state.rand_mut().below(unsafe {
                        NonZeroUsize::new_unchecked(input.groups().len())
                    });
                    if a == b {
                        b = (b + 1) % input.groups().len();
                    }
                    input.groups_mut().swap(a, b);
                    mutated = true;
                }
            }
            11 => {
                if let Some(group_idx) =
                    Self::random_group_index(state.rand_mut(), input.groups().len())
                {
                    let group = input.groups()[group_idx].clone();
                    let other = ActionGroup::new(vec![ScenarioGenerator::random_action(
                        state.rand_mut(),
                    )]);
                    input.groups_mut().insert(group_idx, other);
                    input.groups_mut().remove(group_idx + 1);
                    input.groups_mut().insert(group_idx, group);
                    mutated = true;
                }
            }
            12 => {
                if let Some(group_idx) =
                    Self::random_group_index(state.rand_mut(), input.groups().len())
                {
                    let clone = input.groups()[group_idx].clone();
                    let target = &mut input.groups_mut()[group_idx];
                    let insert_at = if target.len() == 0 {
                        0
                    } else {
                        state.rand_mut().below(unsafe {
                            NonZeroUsize::new_unchecked(target.len())
                        })
                    };
                    for action in clone.actions() {
                        target.actions_mut().insert(insert_at, action.clone());
                    }
                    mutated = true;
                }
            }
            _ => {
                if let Some(group_idx) =
                    Self::random_group_index(state.rand_mut(), input.groups().len())
                {
                    input.groups_mut()[group_idx] = self.generated_group(state)?;
                    mutated = true;
                }
            }
        }

        Self::ensure_terminal_stop(input);

        Ok(if mutated {
            MutationResult::Mutated
        } else {
            MutationResult::Skipped
        })
    }

    fn post_exec(
        &mut self,
        _state: &mut S,
        _new_corpus_id: Option<libafl::corpus::CorpusId>,
    ) -> Result<(), Error> {
        Ok(())
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
    fn mutator_preserves_terminal_stop() {
        let mut state = TestState::default();
        let mut input = ScenarioInput::new(vec![ActionGroup::new(vec![
            Action::Vm(crate::input::VmAction::Continue),
            Action::Vm(crate::input::VmAction::Stop),
        ])]);

        let mut mutator = ScenarioMutator::default();
        let _ = mutator
            .mutate(&mut state, &mut input)
            .expect("mutation should succeed");

        assert!(matches!(
            input.groups().last().and_then(|g| g.actions().last()),
            Some(Action::Vm(crate::input::VmAction::Stop))
        ));
    }
}
