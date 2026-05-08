#!/usr/bin/env bash
set -euo pipefail

install_dir="${MORPHEUS_NQC2_INSTALL_DIR:?}"
result_file="${MORPHEUS_NQC2_RESULT_FILE:-${MORPHEUS_SCRIPT_RESULT_FILE:?}}"
cli="${install_dir}/bin/nqc2"
plugin="${install_dir}/lib/nqc2/nqc2-plugin.so"

if [ ! -x "${cli}" ]; then
  echo "missing NQC2 CLI: ${cli}" >&2
  exit 1
fi
if [ ! -f "${plugin}" ]; then
  echo "missing NQC2 plugin: ${plugin}" >&2
  exit 1
fi

cat > "${result_file}" <<EOF
{"details":{"install_dir":"${install_dir}","cli":"${cli}","plugin":"${plugin}"}}
EOF
