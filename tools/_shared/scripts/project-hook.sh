#!/usr/bin/env bash

morpheus_delegate_project_hook() {
  local current_script="$1"
  local delegated_script="$2"
  local hook_label="$3"

  if [ -z "${delegated_script}" ]; then
    return 1
  fi

  [ -f "${delegated_script}" ] || {
    echo "missing ${hook_label} script: ${delegated_script}" >&2
    exit 1
  }

  local current_resolved
  local delegated_resolved
  current_resolved="$(realpath "${current_script}")"
  delegated_resolved="$(realpath "${delegated_script}")"

  if [ "${delegated_resolved}" = "${current_resolved}" ]; then
    return 1
  fi

  exec "${delegated_resolved}"
}
