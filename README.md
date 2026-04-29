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

Start the local runs viewer:

```bash
pnpm dev:runs-viewer
```

Then open `http://127.0.0.1:4174`.

Validate `morpheus.yaml` with:

```bash
./bin/morpheus config check --json
```

The checker currently enforces one important rule: `tools.<name>.mode` should
be only `local` or `remote`.

## Usage

Install or refresh the repo-local CLI wrappers directly:

```bash
pnpm run install:bin
```

Use the wrappers from `bin/`:

```bash
./bin/buildroot --help
./bin/microkit-sdk --help
./bin/qemu --help
./bin/llbic --help
./bin/llcg --help
./bin/nvirsh --help
./bin/sel4 --help
./bin/libvmm --help
./bin/morpheus --help
./bin/morpheus tool list --json
```

For Morpheus-managed execution, prefer:

```bash
./bin/morpheus workflow run --name <workflow> --json
./bin/morpheus workflow inspect --id <workflow-run-id> --json
./bin/morpheus workflow logs --id <workflow-run-id>
./bin/morpheus tool list --json
```

Tool-specific usage and workflow guidance now live in the skills under
`.codex/skills/`.

Use those as the authoritative source for:

- per-tool setup
- managed dependency wiring
- remote transport expectations
- artifact path conventions
- realistic examples

## TODO

- Add a remote task callback mechanism where the Morpheus-managed remote
  runner triggers the callback after final manifest update.
