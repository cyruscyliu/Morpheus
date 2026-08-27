//! Validate a generated Devilang grammar without starting QEMU.
//!
//! Usage:
//! `cargo run -p libafl_nesting --example devilang_grammar_probe -- PATH`

use std::{env, path::PathBuf};

use libafl::{generators::Generator, mutators::Mutator, state::HasRand};
use libafl_bolts::{nonzero, rands::StdRand};
use libafl_nesting::{
    DevilangGrammar, ScenarioGenerator, ScenarioInput, ScenarioMutator, encode_scenario,
    format_scenario,
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
    if grammar.is_empty() {
        return Err(format!(
            "Devilang grammar {} has no transitions",
            path.display()
        ));
    }

    println!(
        "devilang grammar loaded: machines={} states={} dma-events={}",
        grammar.machines().len(),
        grammar.states().len(),
        grammar.dma_event_count()
    );

    let generator =
        ScenarioGenerator::new(nonzero!(4), nonzero!(6)).with_devilang_grammar(grammar.clone());
    let mut state = ProbeState {
        rand: StdRand::with_seed(0x4445_5649_4c41_4e47),
    };
    let mut scenario = generator
        .clone()
        .generate(&mut state)
        .map_err(|error| format!("failed to generate Devilang scenario: {error:?}"))?;
    validate(&grammar, &scenario)?;
    println!("before mutation:\n{}", format_scenario(&scenario));

    let mut mutator = ScenarioMutator::new(generator);
    let before = scenario.clone();
    let mut changed = false;
    for _ in 0..64 {
        mutator
            .mutate(&mut state, &mut scenario)
            .map_err(|error| format!("failed to mutate Devilang scenario: {error:?}"))?;
        validate(&grammar, &scenario)?;
        if scenario != before {
            changed = true;
            break;
        }
    }
    if !changed {
        return Err("Devilang mutation did not produce a distinct valid scenario".to_string());
    }
    println!("after mutation:\n{}", format_scenario(&scenario));
    Ok(())
}

fn validate(grammar: &DevilangGrammar, scenario: &ScenarioInput) -> Result<(), String> {
    grammar.validate_scenario(scenario)?;
    let encoded_len = encode_scenario(scenario).len();
    if encoded_len > 4096 {
        return Err(format!(
            "encoded Devilang scenario is {encoded_len} bytes, over 4096"
        ));
    }
    Ok(())
}
