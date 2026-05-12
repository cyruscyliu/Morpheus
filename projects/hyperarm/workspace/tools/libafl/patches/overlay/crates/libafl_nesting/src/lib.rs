//! Structured nested fuzzing support for `LibAFL`.

pub mod encoding;
pub mod generator;
pub mod input;
pub mod mutator;
#[cfg(feature = "qemu-bridge-aarch64")]
pub mod qemu_bridge;
pub mod stub;

pub use encoding::{
    ACTION_RECORD_SIZE, GROUP_HEADER_SIZE, ScenarioCodec, decode_scenario, encode_scenario,
};
pub use generator::ScenarioGenerator;
pub use input::{
    Action, ActionGroup, CpuAction, HyperAction, PageTableAction, ScenarioInput, VmAction,
};
pub use mutator::ScenarioMutator;
#[cfg(feature = "qemu-bridge-aarch64")]
pub use qemu_bridge::{
    CoverageHookPlan, GuestAddr, StdEdgeCoverageClassicModule,
    StdEdgeCoverageClassicModuleBuilder, StdEdgeCoverageModule, StdEdgeCoverageModuleBuilder,
    classic_edge_coverage_builder, std_edge_coverage_builder,
};
pub use stub::{GUEST_STUB_BINARY, guest_stub_build_hint};
