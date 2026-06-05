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
  make \
  python3.13-venv

sudo mkdir -p /usr/local/lib/llbase-udocker-venv /var/tmp/llbase-udocker-home
if [ ! -x /usr/local/lib/llbase-udocker-venv/bin/udocker ]; then
  sudo python3 -m venv /usr/local/lib/llbase-udocker-venv
fi
sudo /usr/local/lib/llbase-udocker-venv/bin/pip install --upgrade pip
sudo /usr/local/lib/llbase-udocker-venv/bin/pip install udocker
sudo ln -sf /usr/local/lib/llbase-udocker-venv/bin/udocker /usr/local/bin/udocker-llbase
sudo env HOME=/var/tmp/llbase-udocker-home /usr/local/bin/udocker-llbase --allow-root install >/dev/null

for bin in docker dockerd make; do
  if ! command -v "${bin}" >/dev/null 2>&1; then
    echo "failed to provision required host binary: ${bin}" >&2
    exit 1
  fi
done

for bin in /usr/local/bin/udocker-llbase /usr/local/lib/llbase-udocker-venv/bin/udocker; do
  if [ ! -x "${bin}" ]; then
    echo "failed to provision required udocker binary: ${bin}" >&2
    exit 1
  fi
done
