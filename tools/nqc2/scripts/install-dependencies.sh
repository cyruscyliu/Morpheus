#!/usr/bin/env bash
set -euo pipefail

export DEBIAN_FRONTEND="${DEBIAN_FRONTEND:-noninteractive}"

if command -v apt-get >/dev/null 2>&1; then
  sudo dpkg --configure -a || true
  sudo apt-get -y --fix-broken install || true
  sudo apt-get update
  sudo apt-get install -y \
    lcov \
    binutils-dev \
    dwarfdump \
    libglib2.0-dev \
    libiberty-dev
fi
