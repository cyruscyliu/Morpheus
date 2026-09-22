use alloc::borrow::Cow;
use core::num::NonZeroUsize;

use libafl::{
    Error,
    mutators::{MutationResult, Mutator},
};
use libafl_bolts::{Named, nonzero, rands::Rand};

use crate::{
    generator::ScenarioGenerator,
    input::{ScenarioInput, MAX_STREAM_UNIT_BYTES},
};

/// Schema-aware mutator:骨架 metadata(`present` 位图)不变,
/// 只动 mmio/word_model 值、coherent 值、streaming 尺寸与字节。
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
        // 保持 0 值可选:不强制把 0 变成非 0。
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
        if let Some(grammar) = self.generator.devilang_grammar() {
            let replacement = grammar
                .generate_scenario(state.rand_mut(), self.generator.max_actions())
                .map_err(Error::illegal_argument)?;
            if replacement == *input {
                return Ok(MutationResult::Skipped);
            }
            *input = replacement;
            return Ok(MutationResult::Mutated);
        }

        let op = state.rand_mut().below(nonzero!(9));
        let mutated = match op {
            0 => {
                if let Some(index) =
                    Self::random_index(state.rand_mut(), input.mmio.word_model.len())
                {
                    let model = &mut input.mmio.word_model[index];
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
                    Self::random_index(state.rand_mut(), input.mmio.word_model.len())
                {
                    let model = &mut input.mmio.word_model[index];
                    let value = random_u32(state.rand_mut());
                    model.values.push(value);
                    model.count += 1;
                    true
                } else {
                    false
                }
            }
            2 => {
                if let Some(index) =
                    Self::random_index(state.rand_mut(), input.mmio.word_model.len())
                {
                    let model = &mut input.mmio.word_model[index];
                    if model.values.len() > 1 {
                        model.values.pop();
                        model.count -= 1;
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
                    if let Some(visit) = Self::random_index(state.rand_mut(), alloc.word_model.len())
                    {
                        Self::mutate_u32(state.rand_mut(), &mut alloc.word_model[visit]);
                        true
                    } else if rand_below_half(state.rand_mut()) {
                        // 漂移 alloc 的写入地址
                        alloc.addr = alloc.addr.wrapping_add(0x1000);
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
                    let delta = 1 + state.rand_mut().below(nonzero!(64)) as i32;
                    let direction = state.rand_mut().below(nonzero!(2)) == 0;
                    if direction {
                        unit.size = unit.size.saturating_add(delta as u32);
                    } else {
                        unit.size = unit.size.saturating_sub(delta as u32).max(1);
                    }
                    unit.size = unit.size.max(1).min(MAX_STREAM_UNIT_BYTES);
                    unit.data.resize(usize::try_from(unit.size).unwrap_or(1), 0);
                    true
                } else {
                    false
                }
            }
            5 => {
                if let Some(index) =
                    Self::random_index(state.rand_mut(), input.dma.streaming.len())
                {
                    let unit = &mut input.dma.streaming[index];
                    if let Some(byte) = Self::random_index(state.rand_mut(), unit.data.len()) {
                        unit.data[byte] ^= 1 + state.rand_mut().below(nonzero!(255)) as u8;
                        true
                    } else {
                        false
                    }
                } else {
                    false
                }
            }
            6 => {
                let size = (1 + state.rand_mut().below(nonzero!(512))).max(1);
                let data = (0..size).map(|_| state.rand_mut().below(nonzero!(256)) as u8).collect();
                input.dma.streaming.push(crate::input::StreamUnit {
                    addr: 0x4000_0000 + u64::from(state.rand_mut().below(nonzero!(4096)) as u32) * 0x1000,
                    size: u32::try_from(size).unwrap_or(1),
                    data,
                });
                true
            }
            7 => {
                if input.dma.streaming.len() > 1 {
                    input.dma.streaming.pop();
                    true
                } else {
                    false
                }
            }
            _ => {
                // 骨架(present 位图)不参与变异:没有全量重建的 op,
                // 落到未覆盖的 op 编号一律跳过。
                false
            }
        };

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

    #[test]
    fn mutator_keeps_skeleton_and_invariants() {
        let mut state = TestState { rand: StdRand::with_seed(0) };
        let present = (1 << 68) | 0b100111;
        let mut input = ScenarioInput::new(
            MmioSection {
                present,
                word_model: vec![
                    WordModel { count: 2, values: vec![1, 2] },
                    WordModel { count: 1, values: vec![2] },
                    WordModel { count: 1, values: vec![1] },
                    WordModel { count: 2, values: vec![3, 4] },
                    WordModel { count: 3, values: vec![5, 6, 7] },
                ],
            },
            crate::input::DmaSection {
                streaming: vec![crate::input::StreamUnit {
                    addr: 0x1000,
                    size: 16,
                    data: vec![1; 16],
                }],
                ..Default::default()
            },
        );

        let mut mutator = ScenarioMutator::default();
        for _ in 0..64 {
            let _ = mutator.mutate(&mut state, &mut input);
            assert!(input.is_valid());
            // 骨架位图在变异循环里保持不变
            assert_eq!(input.mmio.present, present);
        }
    }
}
