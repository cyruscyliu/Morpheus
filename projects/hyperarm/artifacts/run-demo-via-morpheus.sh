#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "${script_dir}/../../.." && pwd)"
cd "${repo_root}"

config="projects/hyperarm/morpheus.yaml"
mode="replay"
json="false"

usage() {
  cat <<'EOF'
Usage:
  projects/hyperarm/artifacts/run-demo-via-morpheus.sh [--mode replay|fuzz]
    [--json]

Modes:
  replay  Run the deterministic injected-bug replay workflow.
  fuzz    Run the long-lived timed fuzzing workflow.
EOF
}

die() {
  echo "error: $*" >&2
  exit 1
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --mode)
      shift
      mode="${1:-}"
      ;;
    --json)
      json="true"
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      die "unknown argument: $1"
      ;;
  esac
  shift
done

case "${mode}" in
  replay)
    workflow="nvirsh-aarch64-libafl-nesting-injected-bug"
    ;;
  fuzz)
    workflow="nvirsh-aarch64-libafl-nesting-injected-bug-fuzz"
    ;;
  *)
    die "--mode must be one of: replay, fuzz"
    ;;
esac

cmd=(
  ./bin/morpheus
  --config "${config}"
  workflow run
  --name "${workflow}"
)

if [ "${json}" = "true" ]; then
  cmd+=(--json)
fi

exec "${cmd[@]}"
