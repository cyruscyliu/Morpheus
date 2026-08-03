#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "${script_dir}/../../.." && pwd)"
cd "${repo_root}"

config="$("${script_dir}/config-path.sh")"

while [ "$#" -gt 0 ]; do
  case "$1" in
    --config)
      shift
      config="${1:-}"
      ;;
    -h|--help)
      cat <<'EOF'
Usage:
  projects/hyperarm/scripts/workspace-root.sh [--config PATH]

Print the resolved HyperArm workspace root.
EOF
      exit 0
      ;;
    *)
      echo "error: unknown argument: $1" >&2
      exit 1
      ;;
  esac
  shift
done

[ -f "${config}" ] || {
  echo "error: missing config: ${config}" >&2
  exit 1
}

./bin/morpheus --config "${config}" config show --json \
  | node -e '
const fs = require("fs");
const payload = JSON.parse(fs.readFileSync(0, "utf8"));
const root = payload && payload.details && payload.details.workspace_root;
if (!root) {
  throw new Error("missing workspace_root in config check output");
}
process.stdout.write(String(root));
'
