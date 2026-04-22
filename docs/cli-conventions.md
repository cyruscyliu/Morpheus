# CLI Conventions

Shared subcommands across Morpheus repo-local tools follow a small common
contract.

## Common subcommands

These subcommands should exist on any repo-local tool unless there is a clear
reason not to:

- `inspect`: read or validate local state and expose stable machine-readable
  metadata
- `version`: print the tool CLI version
- `help`: print top-level or command help

Treat `--json` as a first-class interface for each of them.

## Build-oriented tools

Tools that materialize outputs or workspace-managed state should prefer a
single `build` subcommand.

`build` may:

- reuse existing local source state
- fetch missing upstream inputs automatically
- unpack or stage managed sources
- compile or otherwise materialize tool outputs

This keeps the public surface small while still allowing the implementation to
handle source acquisition internally. There should not be a separate `fetch`
subcommand for these tools: `build` is the public entrypoint for both fetching
and building.

Current build-oriented tools:

- `buildroot`: `build`
- `qemu`: `build`
- `microkit-sdk`: `build`
- `sel4`: `build`

## Morpheus config modes

In `morpheus.yaml`, `tools.<name>.mode` is reserved for Morpheus execution
placement, not the underlying tool subcommand.

Allowed values:

- `local`
- `remote`

The `morpheus config check` command validates this explicitly.

## Why `buildroot clean` exists

`buildroot` keeps a `clean` subcommand because its output trees can be large,
incremental, and intentionally reusable across runs.

`clean` gives an explicit way to:

- remove a stale Buildroot output tree
- reset a reusable `O=` directory
- discard local build state without overloading `build`

For the other tools, explicit cleanup is either unnecessary today or handled
by replacing managed state on the next `build`.
