#!/usr/bin/env bash
set -euo pipefail

if ! command -v apt-get >/dev/null 2>&1; then
  echo "install-dependencies.sh currently supports apt-based systems only" >&2
  exit 1
fi

sudo apt-get update
sudo apt-get install -y \
  bc \
  file \
  build-essential \
  gcc \
  g++ \
  make \
  patch \
  rsync \
  cpio \
  unzip \
  bzip2 \
  gzip \
  xz-utils \
  tar \
  perl \
  sed \
  grep \
  findutils

for bin in file cpio unzip rsync bc; do
  if ! command -v "${bin}" >/dev/null 2>&1; then
    echo "failed to provision required host binary: ${bin}" >&2
    exit 1
  fi
done
