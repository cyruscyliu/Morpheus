//! Guest stub artifact helpers for `libafl_nesting`.

/// The guest stub binary target produced by this crate.
pub const GUEST_STUB_BINARY: &str = "libafl_nesting_stub";

/// Returns a short build hint for the guest stub artifact.
#[must_use]
pub const fn guest_stub_build_hint() -> &'static str {
    "cargo build -p libafl_nesting --bin libafl_nesting_stub"
}
