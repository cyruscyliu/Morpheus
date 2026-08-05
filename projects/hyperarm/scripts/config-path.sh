#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "${script_dir}/../../.." && pwd)"
cd "${repo_root}"

workspace_id="hyperarm"
config="${MORPHEUS_CONFIG:-}"
data_root="${MORPHEUS_DATA_ROOT:-}"

if [ -z "${data_root}" ] && [ -n "${MORPHEUS_WORKSPACES_ROOT:-}" ]; then
  data_root="$(dirname "${MORPHEUS_WORKSPACES_ROOT%/}")"
fi

if [ -z "${config}" ]; then
  if [ -n "${data_root}" ]; then
    config="${data_root%/}/workspaces/${workspace_id}/morpheus.yaml"
  elif [ -f "projects/${workspace_id}/morpheus.yaml" ]; then
    config="projects/${workspace_id}/morpheus.yaml"
  fi
fi

if [ -z "${config}" ]; then
  echo "error: unable to resolve HyperArm morpheus.yaml; set MORPHEUS_DATA_ROOT" >&2
  exit 1
fi

[ -f "${config}" ] || {
  echo "error: missing config: ${config}" >&2
  exit 1
}

printf '%s\n' "${config}"
