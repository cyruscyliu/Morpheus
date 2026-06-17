#!/usr/bin/env bash
set -euo pipefail

if command -v apt-get >/dev/null 2>&1; then
  sudo apt-get update
  sudo apt-get install -y \
    git \
    curl \
    build-essential \
    pkg-config \
    cmake \
    cargo \
    rustc \
    gcc-aarch64-linux-gnu \
    meson \
    ninja-build \
    libglib2.0-dev \
    libpixman-1-dev \
    libslirp-dev \
    zlib1g-dev
fi

for bin in git cargo rustc aarch64-linux-gnu-gcc meson ninja cmake; do
  if ! command -v "${bin}" >/dev/null 2>&1; then
    echo "failed to provision required host binary: ${bin}" >&2
    exit 1
  fi
done

if ! command -v rustup >/dev/null 2>&1; then
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \
    | sh -s -- -y --profile minimal
fi

if [ -f "${HOME}/.cargo/env" ]; then
  # shellcheck disable=SC1090
  . "${HOME}/.cargo/env"
fi

if ! command -v rustup >/dev/null 2>&1; then
  echo "failed to provision required host binary: rustup" >&2
  exit 1
fi

rustup target add aarch64-unknown-linux-gnu
