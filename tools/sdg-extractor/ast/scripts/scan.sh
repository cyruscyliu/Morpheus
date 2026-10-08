#!/usr/bin/env bash
set -euo pipefail

# Run the AST source catalog on one translation unit.
#
# Usage: scan.sh <build-dir>/ast_source_scan <compile-args-file> <source.c>
#
# The compile-args file holds one compiler flag per line (for example the
# kernel per-TU flags extracted from the build's .cmd files); the tool runs
# from the build directory so relative -I paths resolve.
tool_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
tool="${1:?usage: scan.sh <ast_source_scan> <compile-args-file> <source.c>}"
args_file="${2:?}"
source_file="${3:?}"

exec "$tool" "$args_file" "$source_file"
