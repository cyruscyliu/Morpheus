#!/usr/bin/env bash
set -euo pipefail

qemu_path="${MORPHEUS_QEMU_PATH:?}"
result_file="${MORPHEUS_QEMU_RESULT_FILE:-${MORPHEUS_SCRIPT_RESULT_FILE:?}}"

if [ ! -x "${qemu_path}" ]; then
  echo "missing executable: ${qemu_path}" >&2
  exit 1
fi

version="$("${qemu_path}" --version | head -n 1)"
cat > "${result_file}" <<EOF
{"details":{"executable":{"path":"${qemu_path}","version":"${version}"}}}
EOF
