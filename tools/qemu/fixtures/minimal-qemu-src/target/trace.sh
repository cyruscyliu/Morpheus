#!/usr/bin/env sh
if [ "${1:-}" = "--version" ]; then
  echo "qemu fixture 1.0"
  exit 0
fi
echo "trace=base"
