#!/usr/bin/env bash
# Compatibility shim: qemu_nesting is now the default libafl tool implementation.
set -euo pipefail
exec "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/exec.sh" "$@"
