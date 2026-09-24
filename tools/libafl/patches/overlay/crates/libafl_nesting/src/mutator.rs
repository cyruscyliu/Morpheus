use alloc::borrow::Cow;
use core::num::NonZeroUsize;

use libafl::{
    Error,
    mutators::{MutationResult, Mutator},
};
use libafl_bolts::{Named, nonzero, rands::Rand};

    use crate::{
        MAX_ENCODED_SCENARIO_BYTES,
        encoding::encode_scenario,
        generator::ScenarioGenerator,
        input::ScenarioInput,
    };

const U32_BYTES: usize = core::mem::size_of::<u32>();

/// The L1 stub caps each raw testcase at `MAX_ENCODED_SCENARIO_BYTES` and
/// truncates anything longer, so a mutated scenario must stay within the
/// encoded budget. `extra_bytes` is the exact wire growth of the mutation.
fn fits_budget(input: &ScenarioInput, extra_bytes: usize) -> bool {
    encode_scenario(input).len() + extra_bytes <= MAX_ENCODED_SCENARIO_BYTES
}

/// Schema-aware mutator: skeleton metadata (the modelled slot set, i.e. the
/// `offset` keys) stays fixed. The mutator only edits visit values, visit
/// sequence lengths, coherent values and indexes, and whole streaming units.
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

    fn random_index<R: Rand>(rand: &mut R, len: usize) -> Option<usize> {
        if len == 0 {
            None
        } else {
            Some(rand.below(unsafe { NonZeroUsize::new_unchecked(len) }))
        }
    }

    fn mutate_u32<R: Rand>(rand: &mut R, value: &mut u32) {
        match rand.below(nonzero!(3)) {
            0 => *value ^= random_mask_u32(rand),
            1 => *value = value.rotate_left(1 + rand.below(nonzero!(31)) as u32),
            _ => *value = value.wrapping_add(1 + rand.below(nonzero!(65536)) as u32),
        }
        // Keep zero values available; do not force zero to become non-zero.
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
    fn mutate(
        &mut self,
        state: &mut S,
        input: &mut ScenarioInput,
    ) -> Result<MutationResult, Error> {
        if let Some(sdg) = self.generator.sdg() {
            return Ok(if sdg.mutate(state.rand_mut(), input) && input.is_valid() && fits_budget(input, 0) {
                MutationResult::Mutated
            } else {
                MutationResult::Skipped
            });
        }

        let op = state.rand_mut().below(nonzero!(9));
        let mutated = match op {
            0 => {
                if let Some(index) =
                    Self::random_index(state.rand_mut(), input.mmio.word_models.len())
                {
                    let model = &mut input.mmio.word_models[index];
                    if let Some(visit) = Self::random_index(state.rand_mut(), model.values.len()) {
                        Self::mutate_u32(state.rand_mut(), &mut model.values[visit]);
                        true
                    } else {
                        false
                    }
                } else {
                    false
                }
            }
            1 => {
                if let Some(index) =
                    Self::random_index(state.rand_mut(), input.mmio.word_models.len())
                {
                    if fits_budget(input, U32_BYTES) {
                        let model = &mut input.mmio.word_models[index];
                        model.values.push(random_u32(state.rand_mut()));
                        true
                    } else {
                        false
                    }
                } else {
                    false
                }
            }
            2 => {
                if let Some(index) =
                    Self::random_index(state.rand_mut(), input.mmio.word_models.len())
                {
                    let model = &mut input.mmio.word_models[index];
                    if model.values.len() > 1 {
                        model.values.pop();
                        true
                    } else {
                        false
                    }
                } else {
                    false
                }
            }
            3 => {
                if let Some(index) =
                    Self::random_index(state.rand_mut(), input.dma.coherent.len())
                {
                    let alloc = &mut input.dma.coherent[index];
                    let model_index =
                        Self::random_index(state.rand_mut(), alloc.word_models.len());
                    if let Some(model_index) = model_index {
                        let model = &mut alloc.word_models[model_index];
                        if let Some(visit) = Self::random_index(state.rand_mut(), model.values.len())
                        {
                            Self::mutate_u32(state.rand_mut(), &mut model.values[visit]);
                            true
                        } else {
                            false
                        }
                    } else if rand_below_half(state.rand_mut()) {
                        // Drift the alloc runtime-table index within a small range.
                        alloc.addr = state.rand_mut().below(nonzero!(16)) as u64;
                        true
                    } else {
                        false
                    }
                } else {
                    false
                }
            }
            4 => {
                if let Some(index) =
                    Self::random_index(state.rand_mut(), input.dma.streaming.len())
                {
                    let unit = &mut input.dma.streaming[index];
                    // Mutate one modelled visit value in ascending offset order.
                    let model_index = Self::random_index(state.rand_mut(), unit.word_models.len());
                    if let Some(model_index) = model_index {
                        let model = &mut unit.word_models[model_index];
                        if let Some(visit) = Self::random_index(state.rand_mut(), model.values.len())
                        {
                            Self::mutate_u32(state.rand_mut(), &mut model.values[visit]);
                            true
                        } else {
                            false
                        }
                    } else {
                        false
                    }
                } else {
                    false
                }
            }
            5 => {
                if let Some(index) =
                    Self::random_index(state.rand_mut(), input.dma.streaming.len())
                {
                    let unit = &mut input.dma.streaming[index];
                    let model_index = Self::random_index(state.rand_mut(), unit.word_models.len());
                    if let Some(model_index) = model_index {
                        let model = &mut unit.word_models[model_index];
                        if let Some(visit) = Self::random_index(state.rand_mut(), model.values.len())
                        {
                            model.values[visit] ^= random_mask_u32(state.rand_mut());
                            true
                        } else {
                            false
                        }
                    } else {
                        false
                    }
                } else {
                    false
                }
            }
            6 => {
                // Add a unit with 1..=8 modelled words at contiguous 4-byte offsets.
                let words = 1 + state.rand_mut().below(nonzero!(8));
                // Wire growth: addr(u64) + count(u32) + per word offset(u32) +
                // visit count(u32) + one u32 value.
                if fits_budget(input, 2 * U32_BYTES + words * (3 * U32_BYTES)) {
                    let addr = state.rand_mut().below(nonzero!(16)) as u64;
                    input.dma.streaming.push(crate::input::StreamUnit {
                        addr,
                        word_models: (0..words)
                            .map(|word| crate::input::WordModel {
                                offset: ((word * 4) as u32),
                                values: vec![random_u32(state.rand_mut())],
                            })
                            .collect(),
                    });
                    true
                } else {
                    false
                }
            }
            7 => {
                if input.dma.streaming.len() > 1 {
                    input.dma.streaming.pop();
                    true
                } else {
                    false
                }
            }
            8 => {
                if let Some(index) =
                    Self::random_index(state.rand_mut(), input.dma.streaming.len())
                {
                    // Drift the streaming unit's runtime-table index within a small range.
                    input.dma.streaming[index].addr =
                        state.rand_mut().below(nonzero!(16)) as u64;
                    true
                } else {
                    false
                }
            }
            _ => {
                // Skeleton (the modelled slot set) is not mutated; there is no
                // whole-section rebuild op, so uncovered operation IDs are skipped.
                false
            }
        };

        if mutated && !input.is_valid() {
            // Treat invariant-breaking mutations as skipped; skeleton validity wins.
            return Ok(MutationResult::Skipped);
        }
        if mutated && !fits_budget(input, 0) {
            // Belt and braces: the growth ops pre-check their wire cost, so a
            // mutation that still exceeds the stub cap is discarded locally.
            return Ok(MutationResult::Skipped);
        }
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

fn random_mask_u32<R: Rand>(rand: &mut R) -> u32 {
    let lo = (rand.below(nonzero!(65536)) & 0xffff) as u32;
    let hi = (rand.below(nonzero!(65536)) & 0xffff) as u32;
    (hi << 16) | lo
}

fn rand_below_half<R: Rand>(rand: &mut R) -> bool {
    rand.below(nonzero!(2)) == 0
}

fn random_u32<R: Rand>(rand: &mut R) -> u32 {
    let lo = (rand.below(nonzero!(65536)) & 0xffff) as u32;
    let hi = (rand.below(nonzero!(65536)) & 0xffff) as u32;
    (hi << 16) | lo
}

#[cfg(test)]
mod tests {
    use libafl::state::HasRand;
    use libafl_bolts::rands::StdRand;

    use super::*;
    use crate::input::{MmioSection, WordModel};

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

    fn word(offset: u32, values: &[u32]) -> WordModel {
        WordModel {
            offset,
            values: values.to_vec(),
        }
    }

    #[test]
    fn mutator_keeps_skeleton_and_invariants() {
        let mut state = TestState { rand: StdRand::with_seed(0) };
        let mmio_offsets = [0x110u32, 0x118, 0x11c, 0x168, 0x1b0];
        let mut input = ScenarioInput::new(
            MmioSection {
                word_models: vec![
                    word(0x110, &[1, 2]),
                    word(0x118, &[2]),
                    word(0x11c, &[1]),
                    word(0x168, &[3, 4]),
                    word(0x1b0, &[5, 6, 7]),
                ],
            },
            crate::input::DmaSection {
                streaming: vec![crate::input::StreamUnit {
                    addr: 0,
                    word_models: vec![word(0, &[1]), word(4, &[2])],
                }],
                ..Default::default()
            },
        );

        let mut mutator = ScenarioMutator::default();
        for _ in 0..64 {
            let _ = mutator.mutate(&mut state, &mut input);
            assert!(input.is_valid());
            // The modelled slot set remains unchanged across mutation.
            let offsets: Vec<u32> =
                input.mmio.word_models.iter().map(|model| model.offset).collect();
            assert_eq!(offsets, mmio_offsets);
        }
    }

    #[test]
    fn mutator_never_exceeds_the_encoded_budget() {
        use crate::encoding::encode_scenario;

        let mut state = TestState { rand: StdRand::with_seed(7) };
        // One streaming unit encodes to addr(8) + count(4) + num * (offset(4) +
        // visit count(4) + one value(4)); empty mmio/coherent sections add 8.
        let start_len = {
            let words = (MAX_ENCODED_SCENARIO_BYTES - 20) / (3 * U32_BYTES);
            assert_eq!(20 + words * (3 * U32_BYTES), MAX_ENCODED_SCENARIO_BYTES - 8);
            MAX_ENCODED_SCENARIO_BYTES - 8
        };
        let streaming_words = (start_len - 20) / (3 * U32_BYTES);
        let mut input = ScenarioInput::new(
            MmioSection::default(),
            crate::input::DmaSection {
                streaming: vec![crate::input::StreamUnit {
                    addr: 0,
                    word_models: (0..streaming_words)
                        .map(|w| word((w * 4) as u32, &[1]))
                        .collect(),
                }],
                ..Default::default()
            },
        );
        assert_eq!(encode_scenario(&input).len(), start_len);

        let mut mutator = ScenarioMutator::default();
        for _ in 0..256 {
            let _ = mutator.mutate(&mut state, &mut input);
            assert!(
                encode_scenario(&input).len() <= MAX_ENCODED_SCENARIO_BYTES,
                "mutated input {} exceeds the stub cap {}",
                encode_scenario(&input).len(),
                MAX_ENCODED_SCENARIO_BYTES
            );
        }
    }
}
