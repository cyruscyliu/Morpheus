//! Validate a generated Devilang grammar without starting QEMU.
//!
//! Usage:
//! `cargo run -p libafl_nesting --example devilang_grammar_probe -- PATH`

use std::{env, path::PathBuf};

use libafl::{
    generators::Generator,
    mutators::{MutationResult, Mutator},
    state::HasRand,
};
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
    let mut valid_mutations = 0usize;
    for attempt in 1..=64 {
        let result = mutator
            .mutate(&mut state, &mut scenario)
            .map_err(|error| format!("failed to mutate Devilang scenario: {error:?}"))?;
        validate(&grammar, &scenario)?;
        valid_mutations = attempt;
        if mutation_is_distinct(result, &before, &scenario)? {
            changed = true;
            break;
        }
    }
    println!(
        "mutation validated: attempts={} distinct={}",
        valid_mutations, changed
    );
    if changed {
        println!("after mutation:\n{}", format_scenario(&scenario));
    } else {
        println!("after mutation: unchanged (grammar has no alternate valid scenario)");
    }
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

fn mutation_is_distinct(
    result: MutationResult,
    before: &ScenarioInput,
    after: &ScenarioInput,
) -> Result<bool, String> {
    let changed = before != after;
    match (result, changed) {
        (MutationResult::Mutated, true) => Ok(true),
        (MutationResult::Skipped, false) => Ok(false),
        (MutationResult::Mutated, false) => {
            Err("Devilang mutation reported Mutated without changing the scenario".to_string())
        }
        (MutationResult::Skipped, true) => {
            Err("Devilang mutation reported Skipped after changing the scenario".to_string())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scenario() -> ScenarioInput {
        ScenarioInput::new(Vec::new())
    }

    #[test]
    fn accepts_skipped_mutation_for_a_deterministic_grammar() {
        let before = scenario();
        let after = before.clone();
        assert!(
            !mutation_is_distinct(MutationResult::Skipped, &before, &after)
                .expect("a skipped mutation should be valid")
        );
    }

    #[test]
    fn rejects_inconsistent_mutation_result() {
        let before = scenario();
        let after = ScenarioInput::new(Vec::new());
        assert!(mutation_is_distinct(MutationResult::Mutated, &before, &after).is_err());
    }
}
