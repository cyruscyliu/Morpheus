//! A systemmode nesting fuzzer using qemu and libafl_nesting.
#[cfg(all(target_os = "linux", feature = "breakpoint"))]
mod fuzzer_breakpoint;

#[cfg(target_os = "linux")]
pub fn main() {
    #[cfg(feature = "breakpoint")]
    fuzzer_breakpoint::fuzz();
}

#[cfg(not(target_os = "linux"))]
pub fn main() {
    panic!("qemu systemmode and libafl_qemu are only supported on linux!");
}
