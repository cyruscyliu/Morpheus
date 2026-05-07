#!/usr/bin/env bash
set -euo pipefail

if command -v apt-get >/dev/null 2>&1; then
  sudo apt-get update
  sudo apt-get install -y cpio lld llvm dosfstools gdisk
fi

if python3 -m pip --version >/dev/null 2>&1; then
  python3 -m pip install --break-system-packages 'sdfgen==0.26.0'
fi

export PATH="${PATH}:/usr/sbin"

for bin in cpio ld.lld llvm-ar llvm-objcopy mkfs.fat gdisk; do
  if ! command -v "${bin}" >/dev/null 2>&1; then
    echo "failed to provision required host binary: ${bin}" >&2
    exit 1
  fi
done

python3 - <<'PY'
import importlib
import sys

try:
    importlib.import_module("sdfgen")
except Exception:
    print("failed to provision required python package: sdfgen", file=sys.stderr)
    raise SystemExit(1)
PY
