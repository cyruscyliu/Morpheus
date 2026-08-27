//! Structured nested fuzzing support for `LibAFL`.

extern crate alloc;

pub mod devilang_grammar;
pub mod encoding;
pub mod generator;
pub mod input;
pub mod model;
pub mod mutator;
pub mod stub;

pub use devilang_grammar::{
    DevilangGrammar, DevilangGrammarState, DevilangMachine, MAX_ENCODED_SCENARIO_BYTES,
    format_scenario,
};
pub use encoding::{
    ACTION_RECORD_SIZE, GROUP_HEADER_SIZE, ScenarioCodec, decode_scenario, encode_scenario,
};
pub use generator::ScenarioGenerator;
pub use input::{
    Action, ActionGroup, CpuAction, DevilangPath, DevilangPathStep, DevilangTraceDecision,
    HyperAction, PageTableAction, ScenarioInput, VmAction,
};
pub use model::{DevilangMmioOp, DevilangModel, MmioDirection};
pub use mutator::ScenarioMutator;
pub use stub::{GUEST_STUB_BINARY, guest_stub_build_hint};
