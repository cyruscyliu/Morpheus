#!/usr/bin/env bash
set -euo pipefail

if command -v apt-get >/dev/null 2>&1; then
  sudo apt-get update
  sudo apt-get install -y \
    build-essential \
    gcc \
    g++ \
    gawk \
    make \
    ninja-build \
    meson \
    pkg-config \
    python3 \
    python3-pip \
    python3-venv \
    flex \
    bison \
    bc \
    rsync \
    git \
    curl \
    wget \
    file \
    iproute2 \
    cpio \
    unzip \
    xz-utils \
    zstd \
    device-tree-compiler \
    e2fsprogs \
    parted \
    texinfo \
    kmod \
    glslang-tools \
    llvm-dev \
    clang \
    libclang-dev \
    crossbuild-essential-arm64 \
    gcc-aarch64-linux-gnu \
    g++-aarch64-linux-gnu \
    binutils-aarch64-linux-gnu \
    qemu-utils \
    qemu-user-static \
    libglib2.0-dev \
    libpixman-1-dev \
    libfdt-dev \
    zlib1g-dev \
    libslirp-dev \
    libcapstone-dev \
    liburing-dev \
    libnuma-dev \
    libaio-dev \
    libattr1-dev \
    libcap-ng-dev \
    libgmp-dev \
    libmpfr-dev \
    libmpc-dev \
    libgnutls28-dev \
    libmount-dev \
    libseccomp-dev \
    libdrm-dev \
    libgbm-dev \
    libepoxy-dev \
    libspice-server-dev \
    libvirglrenderer-dev \
    libgtk-3-dev \
    libsdl2-dev \
    libwayland-dev \
    libwayland-egl-backend-dev \
    libssl-dev
fi

python3 -m pip install "mako>=0.8.0" --break-system-packages
