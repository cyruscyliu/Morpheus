//! Validate a generated Devilang grammar without starting QEMU.
//!
//! Usage:
//! `cargo run -p libafl_nesting --example devilang_grammar_probe -- PATH`

use std::{env, path::PathBuf};

use libafl::{generators::Generator, mutators::Mutator, state::HasRand};
use libafl_bolts::{nonzero, rands::StdRand};
use libafl_nesting::{
    DevilangGrammar, ScenarioGenerator, ScenarioInput, ScenarioMutator, encode_scenario,
    format_seed,
};

struct ProbeState {
    rand: StdRand,
}

impl HasRand for ProbeState {
    type Rand = StdRand;

    fn rand(&self) -> &Self::Rand {
        &self.rand
    }

    fn rand_mut(&mut self) -> &mut Self::Rand {
        &mut self.rand
    }
}

fn main() -> Result<(), String> {
    let path = env::args_os()
        .nth(1)
        .map(PathBuf::from)
        .ok_or_else(|| "usage: devilang_grammar_probe PATH".to_string())?;
    let grammar = DevilangGrammar::from_path(&path)?;
    println!(
        "device override grammar loaded: mmio-sites={} queue-dma-sites={}",
        grammar.mmio_read_sites().len(),
        grammar.queue_dma_sites().len()
    );

    let generator = ScenarioGenerator::new(nonzero!(4)).with_grammar(grammar.clone());
    let mut state = ProbeState {
        rand: StdRand::with_seed(0x4445_5649_4c41_4e47),
    };
    let mut seed = generator
        .clone()
        .generate(&mut state)
        .map_err(|error| format!("failed to generate device seed: {error:?}"))?;
    validate(&grammar, &seed)?;
    println!("before mutation:\n{}", format_seed(&seed));

    let mut mutator = ScenarioMutator::new(generator);
    let before = seed.clone();
    let attempts = 4;
    for _ in 0..attempts {
        mutator
            .mutate(&mut state, &mut seed)
            .map_err(|error| format!("failed to mutate device seed: {error:?}"))?;
        validate(&grammar, &seed)?;
    }
    println!(
        "mutation validated: attempts={attempts} distinct={}",
        before != seed
    );
    println!("after mutation:\n{}", format_seed(&seed));
    Ok(())
}

fn validate(grammar: &DevilangGrammar, seed: &ScenarioInput) -> Result<(), String> {
    grammar.validate_seed(seed)?;
    let encoded_len = encode_scenario(seed).len();
    if encoded_len > 4096 {
        return Err(format!(
            "encoded device override seed is {encoded_len} bytes, over 4096"
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn seed() -> ScenarioInput {
        ScenarioInput::new(Vec::new())
    }

    #[test]
    fn empty_seed_is_not_a_grammar_error_in_the_probe_helpers() {
        assert!(seed().overrides().is_empty());
    }
}
