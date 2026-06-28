#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "${script_dir}/../.." && pwd)"
cd "${repo_root}"

usage() {
  cat <<'EOF'
Usage:
  projects/hyperarm/run-libafl-fuzzing.sh

Runs the long-lived HyperArm fuzzing workflow:

  nvirsh-aarch64-libafl-nesting-injected-bug-fuzz
EOF
}

if [ "${1:-}" = "-h" ] || [ "${1:-}" = "--help" ]; then
  usage
  exit 0
fi

if [ "$#" -gt 0 ]; then
  echo "error: run-libafl-fuzzing.sh does not accept replay arguments" >&2
  usage >&2
  exit 1
fi

exec ./bin/morpheus \
  --config projects/hyperarm/morpheus.yaml \
  workflow run nvirsh-aarch64-libafl-nesting-injected-bug-fuzz
