use alloc::borrow::Cow;
use core::num::NonZeroUsize;

use libafl::{
    Error,
    mutators::{MutationResult, Mutator},
};
use libafl_bolts::{Named, nonzero, rands::Rand};

use crate::{
    generator::ScenarioGenerator,
    input::{DeviceOverride, ScenarioInput},
};

/// Mutates device override values without changing the native guest flow.
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

    fn mutate_value<R: Rand>(rand: &mut R, value: &mut u64, width: u8) {
        let byte = rand.below(nonzero!(8)) as usize;
        if byte < usize::from(width.min(8)) {
            *value ^= 1u64 << (byte * 8 + rand.below(nonzero!(8)) as usize);
        } else {
            *value = rand.next() & value_mask(width);
        }
    }

    fn mutate_override<R: Rand>(rand: &mut R, override_record: &mut DeviceOverride) {
        match override_record {
            DeviceOverride::MmioRead { width, value, .. } => {
                Self::mutate_value(rand, value, *width);
            }
            DeviceOverride::QueueDma {
                payload_len,
                used_len,
                ..
            } => {
                if rand.below(nonzero!(2)) == 0 {
                    *payload_len = 1 + rand.below(nonzero!(4096)) as u32;
                } else {
                    *used_len = rand.below(nonzero!(8192)) as u32;
                }
            }
        }
    }

    fn random_override_index<R: Rand>(rand: &mut R, length: usize) -> Option<usize> {
        (length > 0).then(|| rand.below(NonZeroUsize::new(length).unwrap()))
    }

    fn same_override_site(left: &DeviceOverride, right: &DeviceOverride) -> bool {
        match (left, right) {
            (
                DeviceOverride::MmioRead {
                    address: left_address,
                    width: left_width,
                    ..
                },
                DeviceOverride::MmioRead {
                    address: right_address,
                    width: right_width,
                    ..
                },
            ) => left_address == right_address && left_width == right_width,
            (
                DeviceOverride::QueueDma {
                    operation: left_operation,
                    direction: left_direction,
                    path: left_path,
                    sequence: left_sequence,
                    queue: left_queue,
                    ..
                },
                DeviceOverride::QueueDma {
                    operation: right_operation,
                    direction: right_direction,
                    path: right_path,
                    sequence: right_sequence,
                    queue: right_queue,
                    ..
                },
            ) => {
                left_operation == right_operation
                    && left_direction == right_direction
                    && left_path == right_path
                    && left_sequence == right_sequence
                    && left_queue == right_queue
            }
            _ => false,
        }
    }
}

fn value_mask(width: u8) -> u64 {
    if width >= 8 {
        u64::MAX
    } else {
        (1u64 << (width * 8)) - 1
    }
}

impl Named for ScenarioMutator {
    fn name(&self) -> &Cow<'static, str> {
        static NAME: Cow<'static, str> = Cow::Borrowed("DeviceOverrideMutator");
        &NAME
    }
}

impl<S> Mutator<ScenarioInput, S> for ScenarioMutator
where
    S: libafl::state::HasRand,
{
    fn mutate(
        &mut self,
        state: &mut S,
        input: &mut ScenarioInput,
    ) -> Result<MutationResult, Error> {
        if input.overrides().is_empty() {
            let Some(grammar) = self.generator.grammar() else {
                return Ok(MutationResult::Skipped);
            };
            let replacement = grammar
                .generate_seed(state.rand_mut(), self.generator.max_overrides())
                .map_err(Error::illegal_argument)?;
            *input = replacement;
            return Ok(MutationResult::Mutated);
        }

        match state.rand_mut().below(nonzero!(4)) {
            0 => {
                let index = Self::random_override_index(state.rand_mut(), input.overrides().len())
                    .expect("non-empty seed has an override");
                Self::mutate_override(state.rand_mut(), &mut input.overrides_mut()[index]);
                Ok(MutationResult::Mutated)
            }
            1 if input.overrides().len() < self.generator.max_overrides() => {
                let Some(grammar) = self.generator.grammar() else {
                    return Ok(MutationResult::Skipped);
                };
                let generated = grammar
                    .generate_seed(state.rand_mut(), 1)
                    .map_err(Error::illegal_argument)?;
                if let Some(override_record) = generated.overrides().first() {
                    if input
                        .overrides()
                        .iter()
                        .any(|current| Self::same_override_site(current, override_record))
                    {
                        Ok(MutationResult::Skipped)
                    } else {
                        input.overrides_mut().push(override_record.clone());
                        Ok(MutationResult::Mutated)
                    }
                } else {
                    Ok(MutationResult::Skipped)
                }
            }
            2 if input.overrides().len() > 1 => {
                let index = Self::random_override_index(state.rand_mut(), input.overrides().len())
                    .expect("non-empty seed has an override");
                input.overrides_mut().remove(index);
                Ok(MutationResult::Mutated)
            }
            _ => Ok(MutationResult::Skipped),
        }
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
    use libafl::mutators::Mutator;
    use libafl::state::HasRand;
    use libafl_bolts::{nonzero, rands::StdRand};

    use super::*;
    use crate::devilang_grammar::DevilangGrammar;

    #[derive(Debug)]
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

    fn grammar() -> DevilangGrammar {
        DevilangGrammar::parse(
            r#"
op read_status {
    mmio read_status {
        direction = r;
        address = 112;
        size = 4;
    }
}
machine m {
    initial state_0
    state state_0
    transition state_0 -> state_0 on loop
}
"#,
        )
        .expect("grammar should parse")
    }

    #[test]
    fn mutation_keeps_seed_as_override_only() {
        let generator = ScenarioGenerator::new(nonzero!(2)).with_grammar(grammar());
        let mut mutator = ScenarioMutator::new(generator);
        let mut state = TestState {
            rand: StdRand::with_seed(3),
        };
        let mut input = ScenarioInput::new(vec![DeviceOverride::MmioRead {
            address: 112,
            width: 4,
            value: 1,
        }]);

        for _ in 0..32 {
            let _ = mutator
                .mutate(&mut state, &mut input)
                .expect("mutation should work");
            assert!(input.is_valid());
            assert!(input.overrides().iter().all(|record| matches!(
                record,
                DeviceOverride::MmioRead { .. } | DeviceOverride::QueueDma { .. }
            )));
        }
    }
}
