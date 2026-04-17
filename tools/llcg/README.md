# llcg

Given a LLVM bitcode file list, generate a callgraph with indirect calls
resolved, plus a few opt-in mutators.

[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)

`llcg` is a Linux kernel callgraph generation CLI for researchers and agent
harnesses that want a reproducible path from LLVM bitcode inputs to callgraph
artifacts. It uses [KallGraph](https://github.com/seclab-ucr/KallGraph) to
resolve indirect calls and `llvm-cg` to emit a raw DOT callgraph. The minimum
input is a bitcode file list. When you want source-derived scoping, the tool
can also generate an interface mutator manifest from a kernel tree, reuse that
manifest through `run --filter ...` by path or unique name to reduce the
bitcode scope, and carry the same mutator metadata forward for later graph
cleanup or beautification. The built-in blocklist, extra-edge rules, and
reachability pruning are applied automatically on the graph side. The final
pipeline artifacts are a final callgraph plus a collapsed grouped view.

## Quick Start

Build the launcher and native dependencies first:

```bash
cmake -S . -B build
cmake --build build
cmake --install build
```

This repo publishes the CLI launcher as `bin/llcg`.

Given the bitcode file list `bitcode_files.txt`, generate a file-scoped mutator
for `virtio_mmio.c` and `virtio_net.c`:

```bash
./bin/llcg genmutator files \
  --source-dir ../llbic/sources/linux-6.18.16 \
  --file drivers/virtio/virtio_mmio.c \
  --file drivers/net/virtio_net.c \
  --scope-name virtio-mmio-net \
  --output ./out \
  --json
```

Run the pipeline with that generated mutator. The real bitcode list path is
passed as `--all-bc-list ../llbic/out/linux-6.18.16-x86_64-clang15/bitcode_files.txt`:

```bash
./bin/llcg run \
  --clang 15 \
  --llbic-json ../llbic/out/linux-6.18.16-x86_64-clang15/llbic.json \
  --all-bc-list ../llbic/out/linux-6.18.16-x86_64-clang15/bitcode_files.txt \
  --filter ./out/virtio-mmio-net-mutator-6.18.16-x86_64.json \
  --output ./out \
  --json
```

Inspect the resulting run manifest to confirm the test run and artifacts:

```bash
./bin/llcg inspect ./out/llcg-manifest.json --json
```

## Usage

The public command tree is:

```text
llcg genmutator interfaces
llcg genmutator files
llcg run
llcg inspect <manifest.json>
```

To run `llcg` inside Docker, invoke it explicitly with `llbase`:

```bash
docker run --rm \
  --user "$(id -u):$(id -g)" \
  --entrypoint /work/bin/llcg \
  -e HOME=/tmp \
  -v "$PWD:/work" \
  -w /work \
  ghcr.io/jianxiaoyitech/llbase:latest \
  run --clang 15 --bitcode-list /work/out/bitcode_files.txt --json
```

### genmutator interfaces

Use it to generate a reusable interface mutator manifest plus supporting
artifacts from a kernel source tree.

During `run`, an interface mutator first narrows the bitcode scope, then
carries its groups into the graph stage for cluster rendering.
[`mutators/groups.txt`](./mutators/groups.txt) can refine those groups and mark
selected ones with `[not_reach_then_discard]` to drive reachability pruning.

The current interface presets are: 9p, balloon, bt, console, crypto, display,
fs, gpio, input, iommu, kvm, mem, networking, pmem, rng, scsi, sound, storage,
vsock.

```bash
./bin/llcg genmutator interfaces \
  --source-dir /path/to/linux-6.18.16 \
  --interfaces networking,storage \
  --output ./out \
  --json
```

Flags:

- `--source-dir`: Linux kernel source tree.
- `--interfaces`: comma-separated interface preset list to generate.
- `--arch`: target architecture. Defaults to `x86_64`.
- `--output, -o`: output directory. Defaults to `./out`.
- `--json`: emit a machine-readable result to stdout.

### genmutator files

Use it to generate a reusable pure scoped-file mutator manifest from an
explicit source-file selection. This mutator is primarily a pre-mutator: it
reduces the size of the bitcode list before analysis.

```bash
./bin/llcg genmutator files \
  --source-dir /path/to/linux-6.18.16 \
  --file net/core/dev.c \
  --file net/socket.c \
  --scope-name networking-core \
  --output ./out \
  --json
```

Flags:

- `--source-dir`: Linux kernel source tree.
- `--file`: repeatable source-relative file selector for the generated
  file-scoped mutator.
- `--scope-name`: optional explicit label for the generated file-scoped
  mutator manifest.
- `--arch`: target architecture. Defaults to `x86_64`.
- `--output, -o`: output directory. Defaults to `./out`.
- `--json`: emit a machine-readable result to stdout.

### run

Direct mode uses only a bitcode list. This is the minimum input:

```bash
./bin/llcg run \
  --clang 15 \
  --bitcode-list /path/to/bitcode_files.list \
  --output ./out \
  --json
```

Source-derived mode starts from generated mutator manifests and resolves those
selections back to bitcode through `llbic` metadata:

```bash
./bin/llcg run \
  --clang 15 \
  --llbic-json /path/to/llbic.json \
  --all-bc-list /path/to/bitcode_files.txt \
  --filter ./out/networking-mutator-6.18.16-x86_64.json \
  --output ./out \
  --json
```

You can also refer to a mutator by its unique generated name instead of the
full manifest path:

```bash
./bin/llcg run \
  --clang 15 \
  --llbic-json /path/to/llbic.json \
  --all-bc-list /path/to/bitcode_files.txt \
  --filter networking \
  --output ./out \
  --json
```

If you already have a mutator manifest from a previous run, reuse it directly:

```bash
./bin/llcg run \
  --clang 15 \
  --llbic-json /path/to/llbic.json \
  --all-bc-list /path/to/bitcode_files.txt \
  --filter ./out/networking-mutator-6.18.16-x86_64.json \
  --json
```

Flags:

- `--bitcode-list`: direct input mode; pass a newline-delimited list of
  bitcode files.
- `--clang`: clang toolchain version used for the default `opt-<version>`
  selection. Pass the version that was used to compile the input bitcode.
- `--llbic-json`: `llbic` build manifest used for source-to-bitcode
  resolution.
- `--all-bc-list`: complete `bitcode_files.txt` index for the selected kernel
  build.
- `--filter`: repeatable mutator selector. Each value can be either a mutator
  manifest path or a unique generated mutator name, and `run` automatically
  applies the matching pre-mutator and post-mutator callbacks.
- `--scope-name`: optional explicit label for direct runs or merged mutator
  scopes.
- `--output, -o`: output directory for manifests, lists, logs, and graphs.
  Defaults to `./out`.
- `--json`: emit a machine-readable result to stdout instead of compact text.

### inspect

Use it to summarize a previous run or mutator manifest JSON.

```bash
./bin/llcg inspect ./out/llcg-manifest.json --json
```

Flags:

- `--json`: emit a machine-readable result to stdout instead of compact text.

## Manifest

`llcg-manifest.json` is the stable machine-readable summary of a run. It
records the command result (`status`, `summary`, `exit_code`), the resolved
analysis context in `details` such as scope, mutators, kernel version, arch,
and artifact names, the concrete artifact paths in `artifacts`, and runtime
environment data in `runtime`. Use `inspect` when you want a compact summary,
and use the manifest directly when another tool or agent needs to discover the
generated files without guessing names.

## Contributing

Contributions should preserve the small public CLI and the manifest contract.

## License

This repository is licensed under the MIT License. See [LICENSE](./LICENSE).

Vendored components may carry their own upstream licensing terms. In
particular:

- [`src/KallGraph/LICENSE`](src/KallGraph/LICENSE)
- [`src/KallGraph/SVF-3.3`](src/KallGraph/SVF-3.3)
