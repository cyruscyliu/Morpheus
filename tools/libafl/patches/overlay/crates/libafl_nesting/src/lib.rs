//! Structured nested fuzzing support for `LibAFL`.

extern crate alloc;

// A seed is a data-unit stream: the `mmio` window plane plus the two `dma`
// surfaces. Grammar code reasons in actions and lowers them into units; the
// consumer only sees captured MMIO and DMA telemetry events.

pub mod devilang_grammar;
pub mod encoding;
pub mod generator;
pub mod input;
pub mod model;
pub mod mutator;
pub mod stub;

pub use devilang_grammar::{
    Action, DevilangGrammar, DevilangGrammarState, DevilangMachine, DevilangPath,
    DevilangPathStep, DevilangTraceDecision, HyperAction, MAX_ENCODED_SCENARIO_BYTES,
};
pub use encoding::{ScenarioCodec, decode_scenario, encoded_size, encode_scenario};
pub use generator::ScenarioGenerator;
pub use input::{
    CoherentAlloc, DmaSection, MmioSection, MAX_STREAM_UNIT_SLOTS, MMIO_WINDOW_SLOTS,
    ScenarioInput, StreamUnit, WordModel, format_scenario,
};
pub use model::{DevilangMmioOp, DevilangModel, MmioDirection};
pub use mutator::ScenarioMutator;
pub use stub::{GUEST_STUB_BINARY, guest_stub_build_hint};
