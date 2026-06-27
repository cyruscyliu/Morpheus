#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "${script_dir}/../.." && pwd)"
cd "${repo_root}"

seed_path="projects/hyperarm/workspace/tools/libafl/seeds/qemu_nesting/oracle-trigger.raw"

usage() {
  cat <<'EOF'
Usage:
  projects/hyperarm/run-libafl-fuzzing.sh [replay options]

Replays the default HyperArm oracle-trigger seed through the
nvirsh-aarch64-libafl-nesting-injected-bug artifacts.

This wrapper now delegates to run-libafl-replay.sh with:

  --input projects/hyperarm/workspace/tools/libafl/seeds/qemu_nesting/oracle-trigger.raw
EOF
}

if [ "${1:-}" = "-h" ] || [ "${1:-}" = "--help" ]; then
  usage
  exit 0
fi

[ -f "${seed_path}" ] || {
  echo "error: missing default seed: ${seed_path}" >&2
  exit 1
}

exec "${script_dir}/run-libafl-replay.sh" --input "${seed_path}" "$@"
