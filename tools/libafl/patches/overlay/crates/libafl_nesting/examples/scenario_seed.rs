//! Generate a deterministic postcard device override seed from a Devilang
//! state file.
//!
//! Usage:
//! `cargo run -p libafl_nesting --example scenario_seed -- GRAMMAR POSTCARD RAW`
//! `cargo run -p libafl_nesting --example scenario_seed -- --empty POSTCARD RAW`

use std::{env, fs, path::PathBuf};

use libafl::{generators::Generator, inputs::Input, state::HasRand};
use libafl_bolts::{nonzero, rands::StdRand};
use libafl_nesting::{
    DevilangGrammar, ScenarioGenerator, ScenarioInput, encode_scenario, format_seed,
};

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
    let first = args
        .next()
        .ok_or_else(|| "usage: scenario_seed [--empty] GRAMMAR POSTCARD RAW".to_string())?;
    let (grammar_label, seed, postcard_path, raw_path) =
        if first == "--empty" {
            let postcard_path = PathBuf::from(
                args.next()
                    .ok_or_else(|| "usage: scenario_seed --empty POSTCARD RAW".to_string())?,
            );
            let raw_path = PathBuf::from(
                args.next()
                    .ok_or_else(|| "usage: scenario_seed --empty POSTCARD RAW".to_string())?,
            );
            (
                "empty seed".to_string(),
                ScenarioInput::new(Vec::new()),
                postcard_path,
                raw_path,
            )
        } else {
            let grammar_path = PathBuf::from(first);
            let postcard_path = PathBuf::from(args.next().ok_or_else(|| {
                "usage: scenario_seed [--empty] GRAMMAR POSTCARD RAW".to_string()
            })?);
            let raw_path = PathBuf::from(args.next().ok_or_else(|| {
                "usage: scenario_seed [--empty] GRAMMAR POSTCARD RAW".to_string()
            })?);
            let grammar = DevilangGrammar::from_path(&grammar_path)?;
            let mut generator = ScenarioGenerator::new(nonzero!(1)).with_grammar(grammar.clone());
            let mut state = SeedState {
                rand: StdRand::with_seed(0x5345_4544),
            };
            let seed = generator
                .generate(&mut state)
                .map_err(|error| format!("failed to generate device seed: {error:?}"))?;
            grammar.validate_seed(&seed)?;
            (
                grammar_path.display().to_string(),
                seed,
                postcard_path,
                raw_path,
            )
        };
    if args.next().is_some() {
        return Err("usage: scenario_seed [--empty] GRAMMAR POSTCARD RAW".to_string());
    }

    if let Some(parent) = postcard_path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    if let Some(parent) = raw_path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    seed.to_file(&postcard_path)
        .map_err(|error| format!("failed to write postcard: {error:?}"))?;
    let decoded = libafl_nesting::ScenarioInput::from_file(&postcard_path)
        .map_err(|error| format!("failed to reload postcard: {error:?}"))?;
    if decoded != seed {
        return Err("postcard round-trip changed the generated device seed".to_string());
    }
    let raw = encode_scenario(&seed);
    fs::write(&raw_path, &raw).map_err(|error| error.to_string())?;

    println!(
        "grammar={} postcard={} raw={} encoded-bytes={}\n{}",
        grammar_label,
        postcard_path.display(),
        raw_path.display(),
        raw.len(),
        format_seed(&seed)
    );
    Ok(())
}
