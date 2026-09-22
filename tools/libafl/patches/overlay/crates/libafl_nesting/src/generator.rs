use alloc::vec::Vec;
use core::num::NonZeroUsize;

use libafl::{Error, generators::Generator};
use libafl_bolts::{nonzero, rands::Rand};

use crate::devilang_grammar::{MAX_ENCODED_SCENARIO_BYTES, DevilangGrammar};
use crate::encoding::encoded_size;
use crate::input::{
    CoherentAlloc, DmaSection, MmioSection, MMIO_WINDOW_SLOTS, MAX_STREAM_UNIT_SLOTS,
    ScenarioInput, StreamUnit, WordModel,
};
use crate::model::{DevilangModel, MmioDirection};

#[derive(Debug, Clone)]
pub struct ScenarioGenerator {
    max_actions: NonZeroUsize,
    devilang_model: Option<DevilangModel>,
    devilang_grammar: Option<DevilangGrammar>,
    devilang_grammar_enabled: bool,
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

    #[must_use]
    pub(crate) fn max_actions(&self) -> usize {
        self.max_actions.get()
    }

    #[cfg(feature = "std")]
    pub fn from_env() -> Result<Self, String> {
        let mut generator = Self::default();
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
        Ok(generator)
    }
}

impl<S> Generator<ScenarioInput, S> for ScenarioGenerator
where
    S: libafl::state::HasRand,
{
    fn generate(&mut self, state: &mut S) -> Result<ScenarioInput, Error> {
        if let Some(grammar) = self.devilang_grammar() {
            return grammar
                .generate_scenario(state.rand_mut(), self.max_actions.get())
                .map_err(Error::illegal_argument);
        }

        Ok(self.random_scenario(state.rand_mut(), self.max_actions.get()))
    }
}

impl ScenarioGenerator {
    /// Grammar-free seed: random window slots with short value sequences plus
    /// random coherent allocs and streaming entries. Sections are added under
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
                count: u32::try_from(count).unwrap_or(1),
                values,
            };
            let candidate = ScenarioInput::new(
                MmioSection {
                    present: mmio.present | (1u128 << slot),
                    word_model: {
                        let mut items = mmio.word_model.clone();
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
            // Contiguous low-bit mask (1..=128 set slots), one random u32 per slot.
            let slots =
                1 + usize::from(rand.below(nonzero!(128)));
            let slots = slots.min(usize::try_from(MAX_STREAM_UNIT_SLOTS).unwrap_or(1));
            unit.addr = rand.below(nonzero!(16)) as u64;
            unit.present = if slots >= u128::BITS as usize {
                u128::MAX
            } else {
                (u128::from(1u32) << slots) - 1
            };
            unit.values = (0..slots).map(|_| random_u32(rand)).collect();

            let coherent = if !coherent_done && rand.below(nonzero!(8)) == 0 {
                // Contiguous low-bit mask (1..=128 visits); present is a u128 bitmap.
                let visits = 1 + usize::from(rand.below(nonzero!(128)));
                let present = if visits >= u128::BITS as usize {
                    u128::MAX
                } else {
                    (u128::from(1u32) << visits) - 1
                };
                let values: Vec<u32> = (0..visits).map(|_| random_u32(rand)).collect();
                Some(CoherentAlloc {
                    addr: rand.below(nonzero!(16)) as u64,
                    present,
                    word_model: values,
                })
            } else {
                None
            };
            if let Some(alloc) = coherent {
                let mut items = dma.coherent.clone();
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

    /// Legacy model-backed helper kept for workflows that configure the
    /// obsolete flat Devilang model: returns a random MMIO visit value.
    #[allow(dead_code)]
    pub(crate) fn model_mmio_value<R: Rand>(&self, rand: &mut R) -> Option<u32> {
        let model = self.devilang_model.as_ref()?;
        let mmio_ops = model.mmio_ops();
        if mmio_ops.is_empty() {
            return None;
        }
        let op = &mmio_ops[rand.below(unsafe {
            NonZeroUsize::new_unchecked(mmio_ops.len())
        })];
        match op.direction() {
            MmioDirection::Read => Some(0),
            MmioDirection::Write => Some(
                op.data()
                    .map_or_else(
                        || random_u32(rand) & mask_for_width(op.size()),
                        |data| u32::try_from(data).unwrap_or(u32::MAX),
                    ),
            ),
        }
    }
}

fn random_u32<R: Rand>(rand: &mut R) -> u32 {
    let lo = (rand.below(nonzero!(65536)) & 0xffff) as u32;
    let hi = (rand.below(nonzero!(65536)) & 0xffff) as u32;
    (hi << 16) | lo
}

#[allow(dead_code)]
fn mask_for_width(width: u8) -> u32 {
    if width >= 4 {
        u32::MAX
    } else {
        (1u32 << (width * 8)) - 1
    }
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
    fn grammar_free_generator_stays_inside_the_budget() {
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
