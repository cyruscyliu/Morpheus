use std::{env, path::Path};

use libafl_qemu_build::build_libafl_qemu;

fn main() {
    println!("cargo:rerun-if-env-changed=LIBAFL_QEMU_LIBRARY");
    build_libafl_qemu();

    // The QEMU bridge is an explicitly configured runtime dependency.  Keep
    // its location out of the shell environment by recording the directory
    // in the executable's RUNPATH at link time.
    if let Some(library) = env::var_os("LIBAFL_QEMU_LIBRARY") {
        if let Some(directory) = Path::new(&library).parent() {
            println!(
                "cargo:rustc-link-arg-bins=-Wl,-rpath,{}",
                directory.display()
            );
        }
    }
}
