use alloc::vec::Vec;
use core::num::NonZeroUsize;

use libafl::{Error, generators::Generator};
use libafl_bolts::nonzero;

use crate::devilang_grammar::DevilangGrammar;
use crate::input::ScenarioInput;

/// Generates small device override seeds.
#[derive(Debug, Clone)]
pub struct ScenarioGenerator {
    max_overrides: NonZeroUsize,
    devilang_grammar: Option<DevilangGrammar>,
    devilang_grammar_enabled: bool,
}

impl Default for ScenarioGenerator {
    fn default() -> Self {
        Self::new(nonzero!(4))
    }
}

impl ScenarioGenerator {
    #[must_use]
    pub fn new(max_overrides: NonZeroUsize) -> Self {
        Self {
            max_overrides,
            devilang_grammar: None,
            devilang_grammar_enabled: false,
        }
    }

    /// Enable grammar-guided selection of native device override sites.
    #[must_use]
    pub fn with_devilang_grammar(mut self, grammar: DevilangGrammar) -> Self {
        self.devilang_grammar = Some(grammar);
        self.devilang_grammar_enabled = true;
        self
    }

    #[must_use]
    pub fn with_grammar(self, grammar: DevilangGrammar) -> Self {
        self.with_devilang_grammar(grammar)
    }

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

    pub(crate) fn max_overrides(&self) -> usize {
        self.max_overrides.get()
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
                .generate_seed(state.rand_mut(), self.max_overrides())
                .map_err(Error::illegal_argument);
        }

        // A grammar-free run has no legal site to select. An empty input is a
        // valid native no-op seed; an explicit seed is required when device
        // overrides are desired.
        Ok(ScenarioInput::new(Vec::new()))
    }
}

#[cfg(test)]
mod tests {
    use libafl::{generators::Generator, state::HasRand};
    use libafl_bolts::{nonzero, rands::StdRand};

    use super::*;

    #[derive(Debug)]
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
    fn grammar_free_generator_has_no_override_sites() {
        let mut state = TestState {
            rand: StdRand::with_seed(1),
        };
        let mut generator = ScenarioGenerator::default();
        let seed = generator
            .generate(&mut state)
            .expect("generation should work");

        assert!(seed.overrides().is_empty());
    }

    #[test]
    fn grammar_generator_is_bounded_by_override_count() {
        let grammar = DevilangGrammar::parse(
            r#"
op read_status {
    mmio read_status {
        direction = r;
        address = 112;
        size = 4;
    }
}
machine m {
    initial state_0
    state state_0
    transition state_0 -> state_0 on loop
}
"#,
        )
        .expect("grammar should parse");
        let mut state = TestState {
            rand: StdRand::with_seed(2),
        };
        let mut generator = ScenarioGenerator::new(nonzero!(1)).with_grammar(grammar.clone());
        let seed = generator
            .generate(&mut state)
            .expect("seed should generate");

        assert_eq!(seed.total_overrides(), 1);
        grammar.validate_seed(&seed).expect("seed should be valid");
    }
}
