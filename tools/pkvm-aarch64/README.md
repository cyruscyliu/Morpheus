# pkvm-aarch64

Managed checkout and build wrapper for
[`vrosendahl/pkvm-aarch64`](https://github.com/vrosendahl/pkvm-aarch64).

## Commands

- `fetch` clones the upstream tree.
- `build` runs `make PLATFORM=virt all` by default.
- `exec` runs `make PLATFORM=virt run`.
- `exec --detach` records the runtime pid and returns once QEMU is started.
- `exec --timeout-seconds N` kills the run after `N` seconds.
- `inspect`, `logs`, and `stop` read or manage managed state.
- `qemu` can be supplied from the managed QEMU tool for build and run paths.
- `fetch-submodules` stays off by default.
- Fetch applies workspace-safe overrides for image creation in restricted
  environments.

## Dependencies

Use `tools/pkvm-aarch64/scripts/install-dependencies.sh` on Ubuntu.

## Notes

- `build-target` defaults to `all`.
- `guest2host` can be built with `--build-target guest2host`.
- Extra make variables can be passed with `--make-arg`.
