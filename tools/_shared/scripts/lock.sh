#!/usr/bin/env bash

# Small, dependency-free inter-process lock helper. Callers must keep the
# returned file descriptor open for the duration of the critical section.
morpheus_lock_acquire() {
  local lock_path="$1"
  local timeout="${2:-0}"
  morpheus_lock_acquire_named MORPHEUS_LOCK_FD "${lock_path}" "${timeout}"
}

morpheus_lock_acquire_named() {
  local fd_name="$1"
  local lock_path="$2"
  local timeout="${3:-0}"
  mkdir -p "$(dirname "${lock_path}")"
  exec {lock_fd}>"${lock_path}"
  if [ "${timeout}" -gt 0 ]; then
    flock -w "${timeout}" "${lock_fd}"
  else
    flock "${lock_fd}"
  fi
  printf -v "${fd_name}" '%s' "${lock_fd}"
}

morpheus_lock_release() {
  if [ -n "${MORPHEUS_LOCK_FD:-}" ]; then
    flock -u "${MORPHEUS_LOCK_FD}" || true
    eval "exec ${MORPHEUS_LOCK_FD}>&-"
    unset MORPHEUS_LOCK_FD
  fi
  if [ -n "${MORPHEUS_BUILD_LOCK_FD:-}" ]; then
    flock -u "${MORPHEUS_BUILD_LOCK_FD}" || true
    eval "exec ${MORPHEUS_BUILD_LOCK_FD}>&-"
    unset MORPHEUS_BUILD_LOCK_FD
  fi
}

morpheus_build_lock() {
  local tool="$1"
  local key="$2"
  if [ "${MORPHEUS_BUILD_LOCK_KEY:-}" = "${tool}:${key}" ]; then
    return 0
  fi
  local root="${MORPHEUS_LOCK_ROOT:-${TMPDIR:-/tmp}/morpheus-locks}"
  morpheus_lock_acquire_named MORPHEUS_BUILD_LOCK_FD "${root}/build-${tool}-${key}.lock"
  MORPHEUS_BUILD_LOCK_KEY="${tool}:${key}"
}
