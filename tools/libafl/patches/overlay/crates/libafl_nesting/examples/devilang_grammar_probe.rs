//! Validate a generated Devilang grammar without starting QEMU.
//!
//! Usage:
//! `cargo run -p libafl_nesting --example devilang_grammar_probe -- GRAMMAR`
//! `cargo run -p libafl_nesting --example devilang_grammar_probe -- \
//!     --validate-seed SEED GRAMMAR`

use std::{
    env, fs,
    path::{Path, PathBuf},
};

use libafl::{generators::Generator, inputs::Input, mutators::Mutator, state::HasRand};
use libafl_bolts::{nonzero, rands::StdRand};
use libafl_nesting::{
    DevilangGrammar, ScenarioGenerator, ScenarioInput, ScenarioMutator, decode_scenario,
    encode_scenario, format_seed,
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
    let mut args = env::args_os().skip(1);
    let first = args.next().map(PathBuf::from).ok_or_else(|| {
        "usage: devilang_grammar_probe [--validate-seed SEED] GRAMMAR".to_string()
    })?;
    let (seed_path, path) = if first.as_os_str() == std::ffi::OsStr::new("--validate-seed") {
        let seed_path = args.next().map(PathBuf::from).ok_or_else(|| {
            "usage: devilang_grammar_probe [--validate-seed SEED] GRAMMAR".to_string()
        })?;
        let grammar_path = args.next().map(PathBuf::from).ok_or_else(|| {
            "usage: devilang_grammar_probe [--validate-seed SEED] GRAMMAR".to_string()
        })?;
        (Some(seed_path), grammar_path)
    } else {
        (None, first)
    };
    if args.next().is_some() {
        return Err("usage: devilang_grammar_probe [--validate-seed SEED] GRAMMAR".to_string());
    }

    let grammar = DevilangGrammar::from_path(&path)?;
    println!(
        "device override grammar loaded: mmio-sites={} mmio-write-sites={} queue-dma-sites={} dma-sites={} dma-events={}",
        grammar.mmio_read_sites().len(),
        grammar.mmio_write_sites().len(),
        grammar.queue_dma_sites().len(),
        grammar.dma_sites().len(),
        grammar.dma_event_count()
    );

    if let Some(seed_path) = seed_path {
        let seed = load_seed(&seed_path)?;
        grammar.validate_seed(&seed)?;
        println!(
            "seed validated: path={} overrides={}",
            seed_path.display(),
            seed.total_overrides()
        );
    }

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

fn load_seed(path: &Path) -> Result<ScenarioInput, String> {
    if path.extension().is_some_and(|ext| ext == "raw") {
        return decode_scenario(&fs::read(path).map_err(|error| error.to_string())?)
            .map_err(|error| format!("failed to decode raw seed {}: {error}", path.display()));
    }

    match <ScenarioInput as Input>::from_file(path) {
        Ok(seed) => Ok(seed),
        Err(postcard_error) => decode_scenario(&fs::read(path).map_err(|error| {
            format!(
                "failed to read seed {} after postcard error {postcard_error:?}: {error}",
                path.display()
            )
        })?)
        .map_err(|raw_error| {
            format!(
                "failed to decode seed {} as postcard ({postcard_error:?}) or raw ({raw_error})",
                path.display()
            )
        }),
    }
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
