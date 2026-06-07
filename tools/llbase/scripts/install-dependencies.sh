#!/usr/bin/env bash
set -euo pipefail

if ! command -v apt-get >/dev/null 2>&1; then
  echo "install-dependencies.sh currently supports apt-based systems only" >&2
  exit 1
fi

sudo apt-get update
sudo apt-get install -y \
  build-essential \
  ca-certificates \
  curl \
  docker-buildx \
  docker-cli \
  docker-compose \
  docker.io \
  gawk \
  make \
  python3.13-venv

for bin in docker dockerd make gawk; do
  if ! command -v "${bin}" >/dev/null 2>&1; then
    echo "failed to provision required host binary: ${bin}" >&2
    exit 1
  fi
done
