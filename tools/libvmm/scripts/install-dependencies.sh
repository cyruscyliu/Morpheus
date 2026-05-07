#!/usr/bin/env bash
set -euo pipefail

if command -v apt-get >/dev/null 2>&1; then
  sudo apt-get update
  sudo apt-get install -y cpio lld
fi

if python3 -m pip --version >/dev/null 2>&1; then
  python3 -m pip install --break-system-packages 'sdfgen==0.26.0'
fi
