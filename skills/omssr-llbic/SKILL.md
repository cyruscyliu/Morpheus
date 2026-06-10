---
name: llbic
description: Build Linux kernels reproducibly, collect LLVM bitcode artifacts, inspect build manifests, and choose between host and Docker backends. Use when the user wants to compile a kernel, produce bitcode, inspect a prior build, or reason about kernel build environment requirements.
license: MIT
compatibility: Designed for Claude Code (or similar products)
---

# llbic Skill

Use this skill when you need to compile Linux kernels reproducibly with the
`llbic` tool and collect LLVM bitcode artifacts, logs, and a stable
machine-readable manifest.

## Purpose

`llbic` is a Linux kernel build CLI with a stable command surface and a
machine-readable output contract. The main workflow is:

```bash
./llbic build <version> --out-of-tree --json
```

That command downloads the kernel source if needed, extracts it, builds it, and
writes the resulting artifacts under `out/linux-<version>-<arch>-clang<version>/`.

## First Steps

When operating as an agent in this repo:

1. Run `./llbic --help` to discover the current command surface.
2. Prefer `--json` when a command result will be consumed programmatically.
3. Use `inspect` to re-read a finished build instead of rebuilding it.
4. Expect matching successful `build` or `compile` requests to reuse the
   recorded `llbic.json` output instead of recompiling.
5. For Morpheus-managed runs, prefer Morpheus scripted commands instead of
   invoking the legacy wrapper path through ad hoc workflow glue.

For Morpheus-managed execution, prefer:

```bash
./bin/morpheus build --tool llbic --build-version 6.18.16 --json
./bin/morpheus inspect --tool llbic --target /path/to/llbic.json --json
```

Morpheus-managed runs use the stable workspace layout:

- `tools/llbic/downloads/` for downloaded kernel archives
- `tools/llbic/src/` for extracted kernel source trees
- `tools/llbic/builds/<key>/output/` for build manifests, logs, and bitcode

Typical flow:

```bash
./llbic --help
./llbic build 6.18.16 --out-of-tree --json
./llbic inspect out/linux-6.18.16-x86_64-clang18/llbic.json --json
```

## Backend Selection

`llbic` uses the prepared host toolchain by default.

Use the host path when:

- the required host Clang version exists
- you want the fastest iteration
- the environment is already prepared for the target kernel/toolchain, or
  `llbic` can install the required host Rust toolchain automatically for
  `--rust`

Use Docker when:

- the required host Clang version does not exist
- the host Clang major does not match the kernel-era default and that mismatch
  is not intentional
- you want the Docker image-defined toolchain path for reproducibility

Force Docker with:

```bash
LLBIC_BACKEND=docker ./llbic build <version> --json
```

Force an image rebuild with:

```bash
LLBIC_REBUILD=1 LLBIC_BACKEND=docker ./llbic build <version> --json
```

## Clang Defaults

If `--clang` is not provided, `llbic` selects a default Clang version based on
the kernel era:

- `18` for `6.x` and newer
- `12` for `4.x` and `5.x`
- `7` for `2.6.x` and `3.x`

On the host backend, `llbic` checks whether the expected `clang-<ver>` exists.
If it does not, the command fails early and recommends using Docker. If the
host LLVM major differs from the kernel-era default, `llbic` warns and suggests
`LLBIC_BACKEND=docker` unless the mismatch is intentional.

Rust mode is different. For `--rust`, `llbic` does not use the generic kernel
era default and does not accept `--clang`. Instead, it normalizes the kernel
version to a published family (`6.19`, `6.18`, `6.17`, `6.12`, `6.6`, `6.1`)
and selects the matching LLVM+Rust toolchain for that family automatically.

## Important Commands

One-shot build:

```bash
./llbic build 6.18.16 --out-of-tree --json
```

Scoped build for a single C translation unit:

```bash
./llbic build 6.18.16 --out-of-tree --file kernel/sched/core.c --json
```

Rust-enabled build:

```bash
./llbic build 6.19.7 --out-of-tree --rust --json
```

Prepare a host Rust toolchain manually when needed:

```bash
./scripts/install_rust_env.sh --toolchain 1.93.0
```

Compile an already extracted tree:

```bash
./llbic compile linux-6.18.16 --json
```

Inspect a prior result:

```bash
./llbic inspect out/linux-6.18.16-x86_64-clang18/llbic.json --json
```

## Scoped Build Semantics

`--file` maps cleanly to Kbuild targets for standalone C and assembly inputs.
For example, `kernel/sched/core.c` maps to `kernel/sched/core.o` and can be
compiled as an individual translation unit.

Rust is different. A path like `rust/kernel/workqueue.rs` is a Rust module
inside the kernel Rust crate, not a standalone crate target. Asking Kbuild to
compile that `.rs` file directly loses the expected crate context and fails on
kernel imports/macros such as `crate::prelude::*`, `pin_init!`, and
`#[pin_data]`.

Use `--rust` to enable Rust support, Rust samples, and the required Kconfig
fragment for Rust-capable kernels. `llbic` also injects a small compatibility
fragment there today, including a temporary `CONFIG_DRM_I915=n` workaround for
the current `6.19.x` full-LTO `i915` assertion failure. Do not assume that an
arbitrary `.rs` path under `rust/` behaves like a standalone C translation
unit.

## Artifact Contract

The main output directory is:

```text
out/linux-<version>-<arch>-clang<version>/
```

The key files are:

- `llbic.json`: final machine-readable build manifest
- `bitcode_files.txt`: discovered LLVM bitcode files
- `llbic.log`: end-to-end llbic log
- `kernel-build.log`: underlying kernel build log

Treat portable scalar paths in `llbic.json` such as `source_dir`, `output_dir`,
`bitcode_root`, and `bitcode_list_file` as the stable artifact identities.
`runtime` and `paths` are environment-dependent resolution helpers. llbic
resolves portable fields through the runtime root before scanning or writing
final artifacts, so finalization should not depend on the caller's current
working directory. The default JSON payload is intentionally compact: it
records `bitcode_count` and `bitcode_list_file` instead of embedding the full
bitcode file list inline. The build
manifest also records `requested_clang`, which is important for distinguishing
support rows when the same kernel and arch are tested under different requested
toolchains, including failed host runs where the requested Clang is missing.

## Documentation Priorities

When explaining or updating behavior, prefer these sources in order:

1. `./llbic --help`
2. `README.md`
3. the implementation in `llbic`

If command behavior changes, update the documentation in the same change.

## Supplementary Notes

The material below preserves the older `tools/llbic/docs/index.md` narrative as
supplementary context for contributors who want the design background, not just
the command contract.

### Why llbic Exists

`llbic` is aimed at researchers, tool builders, and agent workflows that need
reproducible LLVM bitcode and kernel build artifacts. The problem it addresses
is narrower than "build Linux kernels." The real problem is "emit LLVM IR from
kernel builds in a way that is reproducible and reusable."

That is difficult because kernel builds are heavily versioned, configuration
dependent, architecture sensitive, and toolchain sensitive. The hard part is
not merely invoking Clang. The hard part is deciding what artifact should count
as "the LLVM IR for the kernel" and producing it consistently across different
build contexts.

Historically, people tend to rely on:

- shell scripts that only work for one kernel era
- one-off build wrappers
- handwritten command rewriting
- locally meaningful output layouts

That may be enough for one experiment, but it is not enough for a reusable
human-in-the-loop workflow.

### Design Goal

`llbic` is not intended to be a new kernel build system. Its role is to provide
a stable command surface and a stable artifact contract around the kernel build
you are already trying to run.

In practice that means:

- one stable entry point for building a kernel
- explicit output artifacts under `out/`
- a machine-readable manifest in `llbic.json`
- a clean inspection step for already completed builds
- a path for status collection and regression tracking

The core design is:

1. run a real kernel build, not a synthetic imitation
2. preserve a stable artifact layout
3. collect LLVM artifacts that the chosen strategy naturally produces
4. record everything in a manifest that agents and scripts can read

The most important design choice is what `llbic` does not do. It does not force
every build into one monolithic `vmlinux.bc` pipeline when the native kernel
build does not naturally support that.

### Why Earlier Approaches Were Replaced

Earlier `llbic` logic tried to reconstruct a monolithic LLVM link graph by:

- capturing kernel build commands from `make V=1`
- rewriting compile commands into `clang --emit-llvm`
- parsing `ld` commands to rebuild the dependency tree
- running `llvm-link` to synthesize one giant bitcode blob

That worked as a proof of concept, but it was fragile:

- assembly inputs were always incomplete in that model
- native linker behavior does not map cleanly to `llvm-link`
- the wrapper effectively became a second kernel build system

That last point was decisive. Once you rewrite compile commands and reconstruct
link structure yourself, you are no longer faithfully using the kernel build.

### The Two Modern Execution Paths

Modern `llbic` settled on two practical paths instead.

#### 1. Kernel-native Clang LTO

When the target kernel supports it, `llbic` prefers the kernel's own Clang LTO
path. In this mode, `llbic` enables the appropriate kernel configuration, builds
with `LLVM=1`, then scans the real build output for verified LLVM bitcode.

This approach keeps the native build semantics intact and records the LLVM
artifacts the build already knows how to produce.

#### 2. IRDumper Fallback

When native LTO is not the right answer, `llbic` falls back to the `IRDumper`
Clang pass plugin. The kernel still produces its normal object files, but the
plugin also emits one `.bc` file per compiled translation unit.

That fallback avoids reconstructing a fake LLVM link graph and produces
per-file bitcode that is often more useful for indexing and analysis anyway.
Today that path is supported only with Clang `14` and `15`; other toolchains
should use the native LTO strategy instead.

### Artifact Philosophy

One practical caveat is that not every file ending in `.bc` inside a kernel
tree is LLVM bitcode. `llbic` therefore verifies bitcode by file content rather
than trusting filenames alone.

More broadly, modern `llbic` is designed around reusable build artifacts, not
around one giant derived bitcode file. The important output remains:

- `llbic.json`
- `bitcode_files.txt`
- `llbic.log`
- `kernel-build.log`

The old approach optimized for a seductive output: a single monolithic LLVM
file. The current approach optimizes for correctness, portability, and
repeatability.
