//! Structured nested fuzzing support for `LibAFL`.

extern crate alloc;

// 种子 = data unit 流(`mmio` 窗口面 + `dma` 两类语义),
// grammar 用 action 思考并在产出时构造 unit;consumer 只有两面:
// 捕获的mmio 与 dma mmio event。

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
    format_scenario,
};
pub use encoding::{ScenarioCodec, decode_scenario, encoded_size, encode_scenario};
pub use generator::ScenarioGenerator;
pub use input::{
    CoherentAlloc, DmaSection, MmioSection, MAX_STREAM_UNIT_BYTES, MMIO_WINDOW_SLOTS,
    ScenarioInput, StreamUnit, WordModel,
};
pub use model::{DevilangMmioOp, DevilangModel, MmioDirection};
pub use mutator::ScenarioMutator;
pub use stub::{GUEST_STUB_BINARY, guest_stub_build_hint};
