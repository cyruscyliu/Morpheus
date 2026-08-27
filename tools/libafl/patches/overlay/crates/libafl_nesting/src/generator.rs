use core::num::NonZeroUsize;

use libafl::{Error, generators::Generator};
use libafl_bolts::{nonzero, rands::Rand};

use crate::devilang_grammar::DevilangGrammar;
use crate::input::{
    Action, ActionGroup, CpuAction, HyperAction, PageTableAction, ScenarioInput, VmAction,
};
use crate::model::{DevilangModel, MmioDirection};

#[derive(Debug, Clone)]
pub struct ScenarioGenerator {
    max_groups: NonZeroUsize,
    max_actions_per_group: NonZeroUsize,
    devilang_model: Option<DevilangModel>,
    devilang_grammar: Option<DevilangGrammar>,
    devilang_grammar_enabled: bool,
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
            devilang_model: None,
            devilang_grammar: None,
            devilang_grammar_enabled: false,
        }
    }

    #[must_use]
    pub fn with_devilang_model(mut self, devilang_model: DevilangModel) -> Self {
        self.devilang_model = Some(devilang_model);
        self
    }

    /// Enable grammar-guided generation from a parsed Devilang machine.
    #[must_use]
    pub fn with_devilang_grammar(mut self, grammar: DevilangGrammar) -> Self {
        self.devilang_grammar = Some(grammar);
        self.devilang_grammar_enabled = true;
        self
    }

    /// Enable the configured grammar format without coupling callers to the
    /// historical Devilang name.
    #[must_use]
    pub fn with_grammar(self, grammar: DevilangGrammar) -> Self {
        self.with_devilang_grammar(grammar)
    }

    /// Toggle grammar-guided generation without changing the parsed grammar.
    /// This is useful for callers that keep one generator configuration and
    /// switch between baseline and grammar-guided corpus stages.
    #[must_use]
    pub fn with_devilang_grammar_enabled(mut self, enabled: bool) -> Self {
        self.devilang_grammar_enabled = enabled;
        self
    }

    #[must_use]
    pub fn with_grammar_enabled(self, enabled: bool) -> Self {
        self.with_devilang_grammar_enabled(enabled)
    }

    #[must_use]
    pub fn devilang_grammar_enabled(&self) -> bool {
        self.devilang_grammar_enabled && self.devilang_grammar.is_some()
    }

    #[must_use]
    pub fn grammar_enabled(&self) -> bool {
        self.devilang_grammar_enabled()
    }

    #[must_use]
    pub fn devilang_grammar(&self) -> Option<&DevilangGrammar> {
        self.devilang_grammar_enabled()
            .then_some(self.devilang_grammar.as_ref())
            .flatten()
    }

    #[must_use]
    pub fn grammar(&self) -> Option<&DevilangGrammar> {
        self.devilang_grammar()
    }

    pub(crate) fn max_groups(&self) -> usize {
        self.max_groups.get()
    }

    #[cfg(feature = "std")]
    pub fn from_env() -> Result<Self, String> {
        let mut generator = Self::default();
        // The generic names are the public interface.  Keep the old Devilang
        // names as fallbacks so cached harnesses and older workflows continue
        // to work while callers switch to another grammar with the same wire
        // format.
        let grammar_mode = std::env::var("MORPHEUS_LIBAFL_GRAMMAR_MODE")
            .or_else(|_| std::env::var("MORPHEUS_LIBAFL_DEVILANG_GRAMMAR_MODE"))
            .unwrap_or_else(|_| "auto".to_string());
        let grammar_path = std::env::var("MORPHEUS_LIBAFL_GRAMMAR")
            .or_else(|_| std::env::var("MORPHEUS_LIBAFL_DEVILANG_GRAMMAR"))
            .ok();
        match grammar_mode.as_str() {
            "off" => {}
            "auto" => {
                if let Some(grammar_path) = grammar_path {
                    generator.devilang_grammar = Some(DevilangGrammar::from_path(grammar_path)?);
                    generator.devilang_grammar_enabled = true;
                }
            }
            "on" => {
                let grammar_path = grammar_path.ok_or_else(|| {
                    "MORPHEUS_LIBAFL_GRAMMAR_MODE=on requires MORPHEUS_LIBAFL_GRAMMAR".to_string()
                })?;
                generator.devilang_grammar = Some(DevilangGrammar::from_path(grammar_path)?);
                generator.devilang_grammar_enabled = true;
            }
            other => {
                return Err(format!(
                    "invalid MORPHEUS_LIBAFL_GRAMMAR_MODE {other}; expected auto, on, or off"
                ));
            }
        }
        if !generator.devilang_grammar_enabled
            && let Some(devilang_model) = DevilangModel::from_env()?
        {
            // Keep the legacy flat model available for existing workflows, but
            // never parse a machine grammar through that obsolete adapter.
            generator.devilang_model = Some(devilang_model);
        }
        Ok(generator)
    }

    fn random_u64_for_width<R: Rand>(rand: &mut R, width: u8) -> u64 {
        let width = width.clamp(1, 8);
        let mut value = 0u64;
        for shift in 0..usize::from(width) {
            value |= (rand.below(nonzero!(256)) as u64) << (shift * 8);
        }
        value
    }

    pub(crate) fn model_mmio_action<R: Rand>(&self, rand: &mut R) -> Option<Action> {
        let model = self.devilang_model.as_ref()?;
        let mmio_ops = model.mmio_ops();
        if mmio_ops.is_empty() {
            return None;
        }

        let op = &mmio_ops[rand.below(unsafe { NonZeroUsize::new_unchecked(mmio_ops.len()) })];
        match op.direction() {
            MmioDirection::Read => Some(Action::Hyper(HyperAction::MmioRead {
                addr: op.address(),
                width: op.size(),
            })),
            MmioDirection::Write => Some(Action::Hyper(HyperAction::MmioWrite {
                addr: op.address(),
                width: op.size(),
                value: op
                    .data()
                    .unwrap_or_else(|| Self::random_u64_for_width(rand, op.size())),
            })),
        }
    }

    pub(crate) fn random_action<R: Rand>(&self, rand: &mut R) -> Action {
        if rand.below(nonzero!(3)) == 0
            && let Some(action) = self.model_mmio_action(rand)
        {
            return action;
        }

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
        if let Some(grammar) = self.devilang_grammar() {
            return grammar
                .generate_scenario(state.rand_mut(), self.max_groups.get())
                .map_err(Error::illegal_argument);
        }
        let group_count = 1 + state.rand_mut().below(self.max_groups);
        let mut groups = Vec::with_capacity(group_count);
        for group_idx in 0..group_count {
            let action_limit = if group_idx + 1 == group_count {
                self.max_actions_per_group.get().max(1)
            } else {
                self.max_actions_per_group.get().max(2) - 1
            };
            let action_count = 1 + state
                .rand_mut()
                .below(unsafe { NonZeroUsize::new_unchecked(action_limit) });

            let mut actions = Vec::with_capacity(action_count);
            for _ in 0..action_count {
                actions.push(self.random_action(state.rand_mut()));
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
    use libafl::{generators::Generator, mutators::Mutator};
    use libafl_bolts::rands::StdRand;

    use super::*;
    use crate::devilang_grammar::{DevilangGrammar, format_scenario};
    use crate::model::DevilangModel;

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
        let input = generator
            .generate(&mut state)
            .expect("generator should work");

        assert!(input.is_valid());
        assert!(matches!(
            input.groups().last().and_then(|g| g.actions().last()),
            Some(Action::Vm(crate::input::VmAction::Stop))
        ));
    }

    #[test]
    fn generator_can_emit_devilang_mmio_actions() {
        let devilang_model = DevilangModel::parse_state_text(
            r#"
op virtio_mmio_queue_notify_write {
    mmio virtio_mmio_queue_notify_write {
        direction = w;
        address = 80;
        size = 4;
        data = 85;
    }
}
"#,
        )
        .expect("model parsing should work");

        let generator = ScenarioGenerator::default().with_devilang_model(devilang_model);
        let mut rand = StdRand::with_seed(0);
        let action = generator
            .model_mmio_action(&mut rand)
            .expect("model-backed action should exist");

        assert_eq!(
            action,
            Action::Hyper(HyperAction::MmioWrite {
                addr: 80,
                width: 4,
                value: 85,
            })
        );
    }

    #[test]
    fn grammar_generation_and_mutation_print_readable_actions() {
        let grammar = DevilangGrammar::parse(
            r#"
machine virtio_net {
    initial start
    state start
    state runtime
    transition start -> runtime on probe_trace
    trace probe_trace {
        sequence {
            read32(vm_dev.base + VIRTIO_MMIO_MAGIC_VALUE);
            write32(PAGE_SIZE, vm_dev.base + VIRTIO_MMIO_GUEST_PAGE_SIZE);
        }
    }
}
"#,
        )
        .expect("grammar should parse");
        let generator = ScenarioGenerator::default().with_devilang_grammar(grammar);
        let mut state = TestState::default();
        let mut input = generator
            .clone()
            .generate(&mut state)
            .expect("grammar generation should work");
        let before = format_scenario(&input);
        println!("before mutation:\n{before}");

        let mut mutator = crate::mutator::ScenarioMutator::new(generator);
        let _ = mutator
            .mutate(&mut state, &mut input)
            .expect("grammar mutation should work");
        let after = format_scenario(&input);
        println!("after mutation:\n{after}");

        assert!(input.is_valid());
        assert!(matches!(
            input
                .groups()
                .last()
                .and_then(|group| group.actions().last()),
            Some(Action::Vm(crate::input::VmAction::Stop))
        ));
        assert!(before.contains("hyper.mmio"));
        assert!(after.contains("group"));
    }
}
