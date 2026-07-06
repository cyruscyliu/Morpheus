#!/usr/bin/env bash
set -euo pipefail

if ! command -v sudo >/dev/null 2>&1; then
  echo "sudo is required to install devilang dependencies" >&2
  exit 1
fi

sudo apt-get update
sudo apt-get install -y cmake clang-15 llvm-15-dev
