#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="${1:-$(pwd)}"
PYTHON_BIN="${PYTHON_BIN:-python3.12}"
RUSTUP_BIN="${RUSTUP_BIN:-rustup}"

cd "${ROOT_DIR}"

if ! command -v cargo >/dev/null 2>&1; then
  curl https://sh.rustup.rs -sSf | sh -s -- -y
fi

"${RUSTUP_BIN}" target add x86_64-unknown-linux-musl
"${RUSTUP_BIN}" component add rust-src --toolchain stable-x86_64-unknown-linux-gnu

if command -v apt-get >/dev/null 2>&1; then
  sudo apt-get update
  sudo apt-get install -y \
    build-essential git cmake ninja-build \
    device-tree-compiler libxml2-utils \
    pandoc texlive-latex-base texlive-latex-recommended \
    texlive-fonts-recommended texlive-fonts-extra \
    python3.12 python3.12-venv \
    qemu-system-arm qemu-system-misc qemu-system-x86 \
    gcc-riscv64-unknown-elf \
    gcc-x86-64-linux-gnu
fi

if [ ! -x "${ROOT_DIR}/pyenv/bin/python" ]; then
  "${PYTHON_BIN}" -m venv "${ROOT_DIR}/pyenv"
fi

"${ROOT_DIR}/pyenv/bin/pip" install --upgrade pip setuptools wheel
"${ROOT_DIR}/pyenv/bin/pip" install -r "${ROOT_DIR}/requirements.txt"
