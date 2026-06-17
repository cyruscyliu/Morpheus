#!/usr/bin/env bash

morpheus_host_cpu_count() {
  local count=""
  count="$(getconf _NPROCESSORS_ONLN 2>/dev/null || true)"
  if [ -z "${count}" ]; then
    count="$(nproc 2>/dev/null || true)"
  fi
  if ! [[ "${count}" =~ ^[0-9]+$ ]] || [ "${count}" -lt 1 ]; then
    count=1
  fi
  printf '%s\n' "${count}"
}

morpheus_default_jobs() {
  local cpus
  cpus="$(morpheus_host_cpu_count)"
  printf '%s\n' "$(( cpus / 2 > 0 ? cpus / 2 : 1 ))"
}
