#!/usr/bin/env bash
set -euo pipefail

if ! command -v apt-get >/dev/null 2>&1; then
  echo "install-dependencies.sh currently supports apt-based systems only" >&2
  exit 1
fi

sudo apt-get update
sudo apt-get install -y \
  python3 \
  python3-pip \
  python3-setuptools \
  meson \
  ninja-build \
  pkg-config \
  build-essential \
  cloud-image-utils \
  libglib2.0-dev \
  libpixman-1-dev \
  libslirp-dev

for bin in pkg-config meson ninja cloud-localds; do
  if ! command -v "${bin}" >/dev/null 2>&1; then
    echo "failed to provision required host binary: ${bin}" >&2
    exit 1
  fi
done
