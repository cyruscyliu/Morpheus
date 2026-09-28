#!/usr/bin/env bash

# Small, dependency-free inter-process lock helper. Callers must keep the
# returned file descriptor open for the duration of the critical section.
morpheus_lock_acquire() {
  local lock_path="$1"
  local timeout="${2:-0}"
  mkdir -p "$(dirname "${lock_path}")"
  exec {MORPHEUS_LOCK_FD}>"${lock_path}"
  if [ "${timeout}" -gt 0 ]; then
    flock -w "${timeout}" "${MORPHEUS_LOCK_FD}"
  else
    flock "${MORPHEUS_LOCK_FD}"
  fi
}

morpheus_lock_release() {
  if [ -n "${MORPHEUS_LOCK_FD:-}" ]; then
    flock -u "${MORPHEUS_LOCK_FD}" || true
    eval "exec ${MORPHEUS_LOCK_FD}>&-"
    unset MORPHEUS_LOCK_FD
  fi
}

morpheus_build_lock() {
  local tool="$1"
  local key="$2"
  local root="${MORPHEUS_LOCK_ROOT:-${TMPDIR:-/tmp}/morpheus-locks}"
  morpheus_lock_acquire "${root}/build-${tool}-${key}.lock"
  trap morpheus_lock_release EXIT INT TERM
}
