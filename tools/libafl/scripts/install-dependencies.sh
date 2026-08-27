#!/usr/bin/env bash
set -euo pipefail

rust_toolchain="${MORPHEUS_LIBAFL_RUST_TOOLCHAIN:-1.93.1}"
guest_target="aarch64-unknown-linux-gnu"

if command -v apt-get >/dev/null 2>&1; then
  sudo apt-get update
  sudo apt-get install -y \
    git \
    curl \
    build-essential \
    pkg-config \
    cmake \
    clang \
    llvm \
    gcc-aarch64-linux-gnu \
    meson \
    ninja-build \
    libglib2.0-dev \
    libattr1-dev \
    libpixman-1-dev \
    libslirp-dev \
    zlib1g-dev
fi

for bin in git curl aarch64-linux-gnu-gcc meson ninja cmake llvm-config; do
  if ! command -v "${bin}" >/dev/null 2>&1; then
    echo "failed to provision required host binary: ${bin}" >&2
    exit 1
  fi
done

if [ -f "${HOME}/.cargo/env" ]; then
  # shellcheck disable=SC1090
  . "${HOME}/.cargo/env"
fi

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

rustup toolchain install "${rust_toolchain}" \
  --profile minimal \
  --component clippy \
  --component rustfmt
rustup default "${rust_toolchain}"
rustup target add --toolchain "${rust_toolchain}" "${guest_target}"

for bin in cargo rustc rustdoc cargo-clippy rustfmt; do
  if ! rustup run "${rust_toolchain}" "${bin}" --version >/dev/null 2>&1; then
    echo "failed to provision ${bin} for Rust ${rust_toolchain}" >&2
    exit 1
  fi
done

printf 'LibAFL Rust toolchain: %s\n' "$(rustup run "${rust_toolchain}" rustc --version)"
