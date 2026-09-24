use alloc::vec::Vec;
use core::num::NonZeroUsize;

use libafl::{Error, generators::Generator};
use libafl_bolts::{nonzero, rands::Rand};

use crate::sdg::SemanticDependencyGraph;
use crate::input::MAX_ENCODED_SCENARIO_BYTES;
use crate::encoding::encoded_size;
use crate::input::{
    CoherentAlloc, DmaSection, MmioSection, MMIO_WINDOW_SLOTS, ScenarioInput, StreamUnit,
    WordModel,
};

#[derive(Debug, Clone)]
pub struct ScenarioGenerator {
    max_actions: NonZeroUsize,
    sdg: Option<SemanticDependencyGraph>,
}

impl Default for ScenarioGenerator {
    fn default() -> Self {
        Self::new(nonzero!(24))
    }
}

impl ScenarioGenerator {
    #[must_use]
    pub fn new(max_actions: NonZeroUsize) -> Self {
        Self {
            max_actions,
            sdg: None,
        }
    }

    pub(crate) fn sdg(&self) -> Option<&SemanticDependencyGraph> {
        self.sdg.as_ref()
    }

    #[cfg(feature = "std")]
    pub fn from_env() -> Result<Self, String> {
        let mut generator = Self::default();
        let disabled = std::env::var("MORPHEUS_LIBAFL_DISABLE_SDG")
            .map(|v| {
                matches!(
                    v.as_str(),
                    "true" | "True" | "TRUE" | "1" | "yes" | "Yes" | "YES" | "on" | "On" | "ON"
                )
            })
            .unwrap_or(false);
        if !disabled {
            if let Ok(path) = std::env::var("MORPHEUS_LIBAFL_SDG_RULES") {
                let sdg = SemanticDependencyGraph::from_dir(std::path::Path::new(&path))?;
                generator.sdg = Some(sdg);
            }
        }
        Ok(generator)
    }
}

impl<S> Generator<ScenarioInput, S> for ScenarioGenerator
where
    S: libafl::state::HasRand,
{
    fn generate(&mut self, state: &mut S) -> Result<ScenarioInput, Error> {
        if let Some(sdg) = &self.sdg {
            return Ok(sdg.generate(state.rand_mut()));
        }

        Ok(self.random_scenario(state.rand_mut(), self.max_actions.get()))
    }
}

impl ScenarioGenerator {
    /// Fallback seed: random window slots with short visit-ordered value
    /// sequences plus random coherent allocs and streaming entries whose
    /// models sit at contiguous 4-byte offsets. Sections are added under
    /// `MAX_ENCODED_SCENARIO_BYTES`; generation stops when the budget is exceeded.
    #[must_use]
    pub fn random_scenario<R: Rand>(&self, rand: &mut R, max_actions: usize) -> ScenarioInput {
        let mut mmio = MmioSection::default();
        let mut dma = DmaSection::default();

        for slot in 0..MMIO_WINDOW_SLOTS {
            if rand.below(nonzero!(4)) != 0 {
                continue;
            }
            let count = 1 + usize::from(rand.below(nonzero!(4)).min(3));
            let values: Vec<u32> = (0..count).map(|_| random_u32(rand)).collect();
            let model = WordModel {
                offset: ((slot * 4) as u32),
                values,
            };
            let candidate = ScenarioInput::new(
                MmioSection {
                    word_models: {
                        let mut items = mmio.word_models.clone();
                        items.push(model.clone());
                        items
                    },
                },
                dma.clone(),
            );
            if encoded_size(&candidate) > MAX_ENCODED_SCENARIO_BYTES {
                break;
            }
            mmio = candidate.mmio;
        }

        let mut coherent_done = false;
        for _ in 0..max_actions {
            let mut unit = StreamUnit::default();
            // 1..=128 modelled words at contiguous 4-byte offsets, one visit each.
            let words = 1 + usize::from(rand.below(nonzero!(128)));
            unit.addr = rand.below(nonzero!(16)) as u64;
            unit.word_models = contiguous_words(words);
            for model in &mut unit.word_models {
                model.values = vec![random_u32(rand)];
            }

            let coherent = if !coherent_done && rand.below(nonzero!(8)) == 0 {
                // 1..=128 modelled words at contiguous 4-byte offsets, one visit each.
                let words = 1 + usize::from(rand.below(nonzero!(128)));
                Some(CoherentAlloc {
                    addr: rand.below(nonzero!(16)) as u64,
                    word_models: contiguous_words(words),
                })
            } else {
                None
            };
            if let Some(alloc) = coherent {
                let mut items = dma.coherent.clone();
                let mut alloc = alloc;
                for frame in &mut alloc.word_models {
                    let visits = 1 + usize::from(rand.below(nonzero!(2)).min(1));
                    frame.values = (0..visits).map(|_| random_u32(rand)).collect();
                }
                items.push(alloc);
                let candidate = ScenarioInput::new(
                    mmio.clone(),
                    DmaSection {
                        coherent: items,
                        streaming: dma.streaming.clone(),
                    },
                );
                if encoded_size(&candidate) > MAX_ENCODED_SCENARIO_BYTES {
                    break;
                }
                dma = candidate.dma;
                coherent_done = true;
                continue;
            }
            let mut items = dma.streaming.clone();
            items.push(unit);
            let candidate = ScenarioInput::new(
                mmio.clone(),
                DmaSection {
                    coherent: dma.coherent.clone(),
                    streaming: items,
                },
            );
            if encoded_size(&candidate) > MAX_ENCODED_SCENARIO_BYTES {
                break;
            }
            dma = candidate.dma;
        }

        ScenarioInput::new(mmio, dma)
    }

}

fn contiguous_words(words: usize) -> Vec<WordModel> {
    (0..words)
        .map(|word| WordModel {
            offset: ((word * 4) as u32),
            values: Vec::new(),
        })
        .collect()
}

#[allow(dead_code)]
fn mask_for_width(width: u8) -> u32 {
    if width >= 4 {
        u32::MAX
    } else {
        (1u32 << (width * 8)) - 1
    }
}

fn random_u32<R: Rand>(rand: &mut R) -> u32 {
    let lo = (rand.below(nonzero!(65536)) & 0xffff) as u32;
    let hi = (rand.below(nonzero!(65536)) & 0xffff) as u32;
    (hi << 16) | lo
}

#[cfg(test)]
mod tests {
    use super::*;
    use libafl::generators::Generator;
    use libafl::state::HasRand;
    use libafl_bolts::rands::StdRand;

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

    #[test]
    fn generator_produces_valid_random_input() {
        let mut state = TestState { rand: StdRand::with_seed(0) };
        let mut generator = ScenarioGenerator::default();
        let input = generator
            .generate(&mut state)
            .expect("generator should work");

        assert!(input.is_valid());
        assert!(encoded_size(&input) <= MAX_ENCODED_SCENARIO_BYTES);
    }

    #[test]
    fn fallback_generator_stays_inside_the_budget() {
        let mut state = TestState { rand: StdRand::with_seed(7) };
        let mut generator = ScenarioGenerator::default();
        for seed in 0..16 {
            state.rand = StdRand::with_seed(seed);
            let input = generator
                .generate(&mut state)
                .expect("generator should work");
            assert!(input.is_valid());
            assert!(encoded_size(&input) <= MAX_ENCODED_SCENARIO_BYTES);
        }
    }
}
