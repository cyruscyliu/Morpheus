# Morpheus

Morpheus is a research platform from North Star Systems Security Lab (NS3L).

## Quick start

Install dependencies:

```bash
pnpm install
```

Build the workspace:

```bash
pnpm build
```

Set up all tools:

```bash
pnpm setup
```

This builds the tool entrypoints and installs repo-local CLI wrappers under
`bin/`.

List available project scripts:

```bash
pnpm run
```

## Development

Start the documentation site locally:

```bash
pnpm dev:docs
```

Then open `http://127.0.0.1:4173`.

## Tool setup

Set up one tool at a time when needed:

```bash
pnpm setup:llbase
pnpm setup:llbic
pnpm setup:llcg
pnpm setup:buildroot
```

Install or refresh the repo-local CLI wrappers directly:

```bash
pnpm run install:bin
```

Use the wrappers from `bin/`:

```bash
./bin/buildroot --help
./bin/llbic --help
./bin/llcg --help
./bin/morpheus --help
./bin/morpheus tool resolve buildroot --json
./bin/morpheus --json tool inspect --id <run-id>
```

For a repo-local Morpheus config, start from:

```bash
cp morpheus.example.yaml morpheus.yaml
```

For Buildroot kernel patching, keep a Buildroot global patch tree in the
workspace, for example `hyperarm-workspace/tools/buildroot/patches/linux/`,
and point Morpheus at it with `patch-dir` in `morpheus.yaml`.
Set `reuse-build-dir: true` when you want Morpheus to reuse a persistent
Buildroot `O=` directory across runs instead of rebuilding from scratch.
Use `build-dir-key` to keep separate incremental build trees when needed.
When a custom kernel version is selected, Morpheus also records the matching
`linux.hash` and `linux-headers.hash` entries in that workspace patch tree.
When `patch-dir/linux/*.patch` exists, Morpheus stages those kernel patches
into a patched kernel tarball for the run, so `linux-headers` keeps the hash
metadata but does not try to apply full kernel patches.
Morpheus also writes run-local hash entries for that patched tarball so
Buildroot accepts both the kernel and kernel-headers download step.
The patched tarball name includes a kernel patch fingerprint, so reusable
Buildroot trees do not collide with stale cached tarballs after patch changes.

## TODO

- Add a remote task callback mechanism where the Morpheus-managed remote
  runner triggers the callback after final manifest update.
