#!/bin/sh
set -euo pipefail

uname -a || true
ifconfig -a || ip addr || true
cat /proc/net/dev || true
ping -c 1 10.0.2.2 || true
ping -c 1 10.0.2.2 || true
cat /root/mmio-upload.txt >/root/mmio-upload.copy || true
sync
