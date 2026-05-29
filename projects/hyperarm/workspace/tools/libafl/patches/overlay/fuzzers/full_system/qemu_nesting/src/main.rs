//! A systemmode nesting fuzzer using qemu and libafl_nesting.
#[cfg(target_os = "linux")]
mod fuzzer_breakpoint;

#[cfg(target_os = "linux")]
pub fn main() {
    fuzzer_breakpoint::fuzz();
}

#[cfg(not(target_os = "linux"))]
pub fn main() {
    panic!("qemu systemmode and libafl_qemu are only supported on linux!");
}
