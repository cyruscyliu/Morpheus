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
export RUSTUP_TOOLCHAIN="${RUSTUP_TOOLCHAIN:-nightly}"

cd "${SOURCE_DIR}"

"${PYTHON_BIN}" - <<'PY'
from pathlib import Path

path = Path("build_sdk.py")
source = path.read_text()
source = source.replace(
    '    cargo_cross_options = "-Z build-std=core,alloc,compiler_builtins -Z build-std-features=compiler-builtins-mem"\n',
    '    cargo_cross_options = "-Z json-target-spec -Z build-std=core,alloc,compiler_builtins -Z build-std-features=compiler-builtins-mem"\n',
    1,
)
source = source.replace(
    "    cargo_target = board.arch.rust_toolchain()\n    rust_target_path = Path(\"initialiser/support/targets\").absolute()\n",
    "    rust_target_path = Path(\"initialiser/support/targets\").absolute()\n    cargo_target = str(rust_target_path / f\"{board.arch.rust_toolchain()}.json\")\n",
    1,
)
source = source.replace(
    '    capdl_init_elf = rust_target_dir / cargo_target / "release" / "initialiser.elf"\n',
    '    capdl_init_elf = rust_target_dir / board.arch.rust_toolchain() / "release" / "initialiser.elf"\n',
    1,
)
path.write_text(source)
PY

if [ -n "${TOOLCHAIN_BIN_DIR}" ]; then
  export PATH="${PATH}:/usr/sbin:${TOOLCHAIN_BIN_DIR}"
fi

REAL_TOOLCHAIN_BIN="${PWD}/arm-gnu-toolchain-12.3.rel1-x86_64-aarch64-none-elf/bin"
if [ -d "${REAL_TOOLCHAIN_BIN}" ]; then
  export PATH="${PATH}:/usr/sbin:${REAL_TOOLCHAIN_BIN}"
fi

if [ -z "${LIBCLANG_PATH:-}" ]; then
  libclang_dir="$(find /usr/lib /usr/lib64 -path '*/libclang.so' -printf '%h\n' 2>/dev/null | head -n 1)"
  if [ -n "${libclang_dir}" ]; then
    export LIBCLANG_PATH="${libclang_dir}"
  fi
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
