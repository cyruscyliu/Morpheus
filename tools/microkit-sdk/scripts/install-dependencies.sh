#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="${1:-$(cd "${SCRIPT_DIR}/.." && pwd)}"
PYTHON_BIN="${PYTHON_BIN:-python3}"
RUSTUP_BIN="${RUSTUP_BIN:-rustup}"

cd "${ROOT_DIR}"

if ! command -v cargo >/dev/null 2>&1; then
  curl https://sh.rustup.rs -sSf | sh -s -- -y
fi

"${RUSTUP_BIN}" target add x86_64-unknown-linux-musl
"${RUSTUP_BIN}" component add rust-src --toolchain stable-x86_64-unknown-linux-gnu
"${RUSTUP_BIN}" toolchain install nightly --profile minimal
"${RUSTUP_BIN}" target add x86_64-unknown-linux-musl --toolchain nightly-x86_64-unknown-linux-gnu
"${RUSTUP_BIN}" component add rust-src --toolchain nightly-x86_64-unknown-linux-gnu

if command -v apt-get >/dev/null 2>&1; then
  PYTHON_PKG="$(python3 - <<'PY'
import sys
print(f"python{sys.version_info.major}.{sys.version_info.minor}")
PY
)"
  sudo apt-get update
  sudo apt-get install -y \
    build-essential git cmake ninja-build \
    device-tree-compiler libxml2-utils \
    clang libclang-dev \
    pandoc texlive-latex-base texlive-latex-recommended \
    texlive-fonts-recommended texlive-fonts-extra \
    "${PYTHON_PKG}" "${PYTHON_PKG}-venv" python3-yaml \
    qemu-system-arm qemu-system-misc qemu-system-x86 \
    gcc-riscv64-unknown-elf \
    gcc-x86-64-linux-gnu
fi

for bin in cmake ninja cargo rustup; do
  if ! command -v "${bin}" >/dev/null 2>&1; then
    echo "failed to provision required host binary: ${bin}" >&2
    exit 1
  fi
done

if ! python3 -m venv --help >/dev/null 2>&1; then
  echo "failed to provision python3 venv support" >&2
  exit 1
fi

if [ ! -x "${ROOT_DIR}/pyenv/bin/python" ]; then
  "${PYTHON_BIN}" -m venv "${ROOT_DIR}/pyenv"
fi

"${ROOT_DIR}/pyenv/bin/pip" install --upgrade pip setuptools wheel
if [ -f "${ROOT_DIR}/requirements.txt" ]; then
  "${ROOT_DIR}/pyenv/bin/pip" install -r "${ROOT_DIR}/requirements.txt"
fi
"${ROOT_DIR}/pyenv/bin/pip" install pyyaml pyfdt jinja2 ply lxml

if python3 -m pip --version >/dev/null 2>&1; then
  python3 -m pip install --break-system-packages pyfdt jinja2 ply lxml
fi
