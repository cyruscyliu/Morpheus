//! Generate a deterministic postcard `ScenarioInput` from a Devilang state file.
//!
//! Usage:
//! `cargo run -p libafl_nesting --example scenario_seed -- GRAMMAR POSTCARD RAW`

use std::{env, fs, path::PathBuf};

use libafl::{generators::Generator, inputs::Input, state::HasRand};
use libafl_bolts::{nonzero, rands::StdRand};
use libafl_nesting::{DevilangGrammar, ScenarioGenerator, encode_scenario, format_scenario};

struct SeedState {
    rand: StdRand,
}

impl HasRand for SeedState {
    type Rand = StdRand;

    fn rand(&self) -> &Self::Rand {
        &self.rand
    }

    fn rand_mut(&mut self) -> &mut Self::Rand {
        &mut self.rand
    }
}

fn main() -> Result<(), String> {
    let mut args = env::args_os().skip(1);
    let grammar_path = PathBuf::from(
        args.next()
            .ok_or_else(|| "usage: scenario_seed GRAMMAR POSTCARD RAW".to_string())?,
    );
    let postcard_path = PathBuf::from(
        args.next()
            .ok_or_else(|| "usage: scenario_seed GRAMMAR POSTCARD RAW".to_string())?,
    );
    let raw_path = PathBuf::from(
        args.next()
            .ok_or_else(|| "usage: scenario_seed GRAMMAR POSTCARD RAW".to_string())?,
    );
    if args.next().is_some() {
        return Err("usage: scenario_seed GRAMMAR POSTCARD RAW".to_string());
    }

    let grammar = DevilangGrammar::from_path(&grammar_path)?;
    let mut generator =
        ScenarioGenerator::new(nonzero!(1)).with_devilang_grammar(grammar.clone());
    let mut state = SeedState {
        rand: StdRand::with_seed(0x5345_4544),
    };
    let scenario = generator
        .generate(&mut state)
        .map_err(|error| format!("failed to generate scenario: {error:?}"))?;
    grammar.validate_scenario(&scenario)?;

    if let Some(parent) = postcard_path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    if let Some(parent) = raw_path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    scenario
        .to_file(&postcard_path)
        .map_err(|error| format!("failed to write postcard: {error:?}"))?;
    let decoded = libafl_nesting::ScenarioInput::from_file(&postcard_path)
        .map_err(|error| format!("failed to reload postcard: {error:?}"))?;
    if decoded != scenario {
        return Err("postcard round-trip changed the generated scenario".to_string());
    }
    let raw = encode_scenario(&scenario);
    fs::write(&raw_path, &raw).map_err(|error| error.to_string())?;

    println!(
        "grammar={} postcard={} raw={} encoded-bytes={}\n{}",
        grammar_path.display(),
        postcard_path.display(),
        raw_path.display(),
        raw.len(),
        format_scenario(&scenario)
    );
    Ok(())
}
