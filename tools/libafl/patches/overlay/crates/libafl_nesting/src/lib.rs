//! Structured nested fuzzing support for `LibAFL`.

extern crate alloc;
#[cfg(feature = "std")]
extern crate std;

pub mod encoding;
pub mod generator;
pub mod input;
pub mod metadata;
pub mod mutator;
pub mod sdg;
pub mod stub;

pub use encoding::{ScenarioCodec, decode_scenario, encoded_size, encode_scenario};
pub use generator::ScenarioGenerator;
pub use input::{
    CoherentAlloc, DmaSection, MAX_ENCODED_SCENARIO_BYTES, MmioSection, MMIO_WINDOW_SLOTS,
    ScenarioInput, StreamUnit, WordModel, format_scenario,
};
pub use metadata::{ScenarioDigest, ScenarioMetadata, ScenarioMetadataStore};
pub use mutator::ScenarioMutator;
pub use sdg::{BoundarySide, Condition, Head, Mutation, Node, Placement, Predicate, Rule, SemanticDependencyGraph, SemanticScenario, Signedness, Source, Value, lift_with, lower_scenario};
pub use stub::{GUEST_STUB_BINARY, guest_stub_build_hint};
