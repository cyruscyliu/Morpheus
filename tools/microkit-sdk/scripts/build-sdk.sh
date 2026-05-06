#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -lt 4 ]; then
  echo "usage: build-sdk.sh <source-dir> <sel4-dir> <boards> <configs> [toolchain-bin-dir] [toolchain-prefix-aarch64] [tool-target-triple]" >&2
  exit 2
fi

SOURCE_DIR="$1"
SEL4_DIR="$2"
BOARDS="$3"
CONFIGS="$4"
TOOLCHAIN_BIN_DIR="${5:-}"
TOOLCHAIN_PREFIX_AARCH64="${6:-}"
TOOL_TARGET_TRIPLE="${7:-}"

PYTHON_BIN="${PYTHON_BIN:-/usr/bin/python3}"

cd "${SOURCE_DIR}"

if [ -n "${TOOLCHAIN_BIN_DIR}" ]; then
  export PATH="${PATH}:/usr/sbin:${TOOLCHAIN_BIN_DIR}"
fi

REAL_TOOLCHAIN_BIN="${PWD}/arm-gnu-toolchain-12.3.rel1-x86_64-aarch64-none-elf/bin"
if [ -d "${REAL_TOOLCHAIN_BIN}" ]; then
  export PATH="${PATH}:/usr/sbin:${REAL_TOOLCHAIN_BIN}"
fi

ARGS=(
  build_sdk.py
  --sel4 "${SEL4_DIR}"
  --boards "${BOARDS}"
  --configs "${CONFIGS}"
  --skip-docs
  --skip-tar
)

if [ -n "${TOOLCHAIN_PREFIX_AARCH64}" ]; then
  ARGS+=(--gcc-toolchain-prefix-aarch64 "${TOOLCHAIN_PREFIX_AARCH64}")
fi

if [ -n "${TOOL_TARGET_TRIPLE}" ]; then
  ARGS+=(--tool-target-triple "${TOOL_TARGET_TRIPLE}")
fi

exec "${PYTHON_BIN}" "${ARGS[@]}"
