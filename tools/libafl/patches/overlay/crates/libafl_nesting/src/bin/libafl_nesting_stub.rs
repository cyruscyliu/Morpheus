use std::{
    ffi::c_void,
    fs,
    process::{Child, Command},
    thread,
    time::Duration,
};

use libvharness_sys::{
    LibaflQemuEndStatus_LIBAFL_QEMU_END_CRASH, LibaflQemuEndStatus_LIBAFL_QEMU_END_OK,
    lqprintf, libafl_qemu_end, libafl_qemu_start_virt,
};

const INPUT_LEN: usize = 4096;
const RUNTIME_DIR: &str = "/run/morpheus-libafl";
const INPUT_PATH: &str = "/run/morpheus-libafl/morpheus-qemu-input.bin";
const LAUNCH_MARKER_PATH: &str = "/run/morpheus-libafl/launch-l2.marker";
const QEMU_STDOUT_PATH: &str = "/run/morpheus-libafl/qemu.stdout.log";
const QEMU_STDERR_PATH: &str = "/run/morpheus-libafl/qemu.stderr.log";
const L2_CONSOLE_PATH: &str = "/run/morpheus-libafl/l2-console.log";
const L2_CONSOLE_PTY_PATH: &str = "/run/morpheus-libafl/l2-console.pty";

#[unsafe(no_mangle)]
pub static mut FUZZ_INPUT: [u8; INPUT_LEN] = [0; INPUT_LEN];

fn run_window_ms() -> u64 {
    5_000
}

fn prepare_runtime() {
    let remount = ["/bin/mount", "/usr/bin/mount"]
        .into_iter()
        .find_map(|path| {
            Command::new(path)
                .args(["-o", "remount,rw", "/"])
                .status()
                .ok()
        })
        .is_some_and(|status| status.success());

    if !remount {
        unsafe {
            lqprintf(c"stub: failed to remount rootfs rw\n".as_ptr());
        }
    }
}

fn log_text(prefix: &str, text: &str) {
    if text.is_empty() {
        return;
    }
    for line in text.lines().take(32) {
        println!("{prefix}{line}");
    }
}

fn log_file_size(path: &str, label: &str) {
    let msg = match fs::metadata(path) {
        Ok(meta) => format!("stub: {label} size={}\n", meta.len()),
        Err(err) => format!("stub: {label} error={err}\n"),
    };
    let mut bytes = msg.into_bytes();
    bytes.push(0);
    unsafe {
        lqprintf(bytes.as_ptr().cast());
  }
}

fn log_runtime_file(path: &str, label: &str, prefix: &str) {
    log_file_size(path, label);
    if let Ok(text) = fs::read_to_string(path) {
        log_text(prefix, &text);
    }
}

fn log_runtime_snapshot() {
    log_runtime_file(LAUNCH_MARKER_PATH, "launch-l2.marker", "stub: launch marker: ");
    log_runtime_file(QEMU_STDOUT_PATH, "qemu.stdout.log", "stub: qemu stdout: ");
    log_runtime_file(QEMU_STDERR_PATH, "qemu.stderr.log", "stub: qemu stderr: ");
    log_runtime_file(L2_CONSOLE_PATH, "l2-console.log", "stub: l2 console: ");
    log_runtime_file(L2_CONSOLE_PTY_PATH, "l2-console.pty", "stub: l2 console pty: ");
}

fn probe_inner_qemu_binary() {
    let output = Command::new("/root/morpheus-qemu/bin/qemu-system-aarch64")
        .arg("--version")
        .output();

    match output {
        Ok(output) => {
            println!("stub: inner qemu --version status={:?}", output.status.code());
            log_text(
                "stub: inner qemu stdout: ",
                &String::from_utf8_lossy(&output.stdout),
            );
            log_text(
                "stub: inner qemu stderr: ",
                &String::from_utf8_lossy(&output.stderr),
            );
        }
        Err(err) => {
            eprintln!("stub: inner qemu probe failed: {err}");
        }
    }
}

fn write_input_snapshot(data: &[u8]) -> std::io::Result<()> {
    fs::create_dir_all(RUNTIME_DIR)?;
    fs::write(INPUT_PATH, data)
}

fn launch_l2() -> std::io::Result<Child> {
    unsafe {
        lqprintf(c"stub: launch_l2 entering\n".as_ptr());
    }
    let mut command = Command::new("/bin/bash");
    command.arg("/root/launch-l2.sh");
    command.env("MORPHEUS_QEMU_INPUT_PATH", INPUT_PATH);
    command.env("MORPHEUS_L2_RUNTIME_DIR", RUNTIME_DIR);
    command.spawn()
}

fn terminate_child_gracefully(child: &mut Child) -> bool {
    let pid = child.id().to_string();
    let term = ["/bin/kill", "/usr/bin/kill"]
        .into_iter()
        .find_map(|path| {
            Command::new(path)
                .args(["-TERM", &pid])
                .status()
                .ok()
        })
        .is_some_and(|status| status.success());

    if !term {
        return false;
    }

    for _ in 0..10 {
        thread::sleep(Duration::from_millis(100));
        match child.try_wait() {
            Ok(Some(status)) => return status.success(),
            Ok(None) => continue,
            Err(_) => return false,
        }
    }

    let _ = child.kill();
    child.wait().is_ok()
}

fn run_iteration(data: &[u8]) -> bool {
    if write_input_snapshot(data).is_err() {
        return false;
    }

    let mut child = match launch_l2() {
        Ok(child) => child,
        Err(_) => return false,
    };

    let msg = format!("stub: launch_l2 spawned child pid={}\n", child.id());
    let mut bytes = msg.into_bytes();
    bytes.push(0);
    unsafe {
        lqprintf(bytes.as_ptr().cast());
    }

    thread::sleep(Duration::from_millis(run_window_ms()));

    match child.try_wait() {
        Ok(Some(status)) => {
            log_runtime_snapshot();
            status.success()
        }
        Ok(None) => {
            let ok = terminate_child_gracefully(&mut child);
            log_runtime_snapshot();
            ok
        }
        Err(_) => false,
    }
}

fn main() {
    prepare_runtime();
    probe_inner_qemu_binary();

    unsafe {
        lqprintf(c"libafl_nesting stub ready\n".as_ptr());
    }

    loop {
        let len = unsafe {
            libafl_qemu_start_virt(
                core::ptr::addr_of_mut!(FUZZ_INPUT) as *mut c_void,
                INPUT_LEN as u64,
            )
        } as usize;

        let bounded_len = len.min(INPUT_LEN);
        let data = unsafe { &FUZZ_INPUT[..bounded_len] };
        let ok = run_iteration(data);

        unsafe {
            libafl_qemu_end(if ok {
                LibaflQemuEndStatus_LIBAFL_QEMU_END_OK
            } else {
                LibaflQemuEndStatus_LIBAFL_QEMU_END_CRASH
            });
        }
    }
}
