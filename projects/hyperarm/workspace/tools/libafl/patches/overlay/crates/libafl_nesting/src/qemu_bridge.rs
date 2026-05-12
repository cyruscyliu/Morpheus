//! Coverage-only helpers for `qemu-libafl-bridge` integration.
//!
//! This module intentionally exposes only coverage-hook helpers.
//! It does not define a guest/host command ABI or stub backdoor interface.

use core::ops::Range;
use std::vec::Vec;

pub use libafl_qemu::{
    GuestAddr,
    modules::{
        StdEdgeCoverageClassicModule, StdEdgeCoverageClassicModuleBuilder, StdEdgeCoverageModule,
        StdEdgeCoverageModuleBuilder,
        utils::filters::HasAddressFilterTuple,
    },
};

/// Address-range coverage filter plan for nesting scenarios.
#[derive(Debug, Clone, Default)]
pub struct CoverageHookPlan {
    ranges: Vec<Range<GuestAddr>>,
}

impl CoverageHookPlan {
    /// Create an empty plan.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Add one guest-address range to the allow-list plan.
    pub fn add_range(&mut self, range: Range<GuestAddr>) {
        self.ranges.push(range);
    }

    /// Access the planned address ranges.
    #[must_use]
    pub fn ranges(&self) -> &[Range<GuestAddr>] {
        &self.ranges
    }

    /// Apply all planned address ranges to the given emulator module tuple.
    pub fn apply<ET>(&self, modules: &mut ET)
    where
        ET: HasAddressFilterTuple,
    {
        for range in &self.ranges {
            modules.allow_address_range_all(range);
        }
    }
}

/// Returns the default full edge-coverage builder from `libafl_qemu`.
#[must_use]
pub fn std_edge_coverage_builder() -> StdEdgeCoverageModuleBuilder {
    StdEdgeCoverageModuleBuilder::default()
}

/// Returns the default AFL-style classic coverage builder from `libafl_qemu`.
#[must_use]
pub fn classic_edge_coverage_builder() -> StdEdgeCoverageClassicModuleBuilder {
    StdEdgeCoverageClassicModuleBuilder::default()
}
