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

morpheus_default_l1_qemu_cpus() {
  morpheus_default_jobs
}

morpheus_default_l1_qemu_memory_mb() {
  local cpus
  local memory_mb

  cpus="$(morpheus_default_l1_qemu_cpus)"
  if ! [[ "${cpus}" =~ ^[0-9]+$ ]] || [ "${cpus}" -lt 1 ]; then
    cpus=1
  fi

  memory_mb="$(( cpus * 1024 ))"
  if [ "${memory_mb}" -lt 2048 ]; then
    memory_mb=2048
  fi

  printf '%s\n' "${memory_mb}"
}

morpheus_default_cvm_l1_qemu_cpus() {
  printf '%s\n' "1"
}

morpheus_default_cvm_l1_qemu_memory_mb() {
  printf '%s\n' "4096"
}

morpheus_resolve_positive_int_with_cap() {
  local requested="${1:-}"
  local cap="${2:-}"
  local fallback="${3:-}"

  if ! [[ "${cap}" =~ ^[0-9]+$ ]] || [ "${cap}" -lt 1 ]; then
    cap="${fallback}"
  fi
  if ! [[ "${fallback}" =~ ^[0-9]+$ ]] || [ "${fallback}" -lt 1 ]; then
    fallback="${cap}"
  fi

  if ! [[ "${requested}" =~ ^[0-9]+$ ]] || [ "${requested}" -lt 1 ]; then
    requested="${fallback}"
  fi
  if [ "${requested}" -gt "${cap}" ]; then
    requested="${cap}"
  fi

  printf '%s\n' "${requested}"
}

morpheus_resolve_l1_qemu_cpus() {
  morpheus_resolve_positive_int_with_cap \
    "${1:-}" \
    "$(morpheus_default_l1_qemu_cpus)" \
    "$(morpheus_default_l1_qemu_cpus)"
}

morpheus_resolve_l1_qemu_memory_mb() {
  morpheus_resolve_positive_int_with_cap \
    "${1:-}" \
    "$(morpheus_default_l1_qemu_memory_mb)" \
    "$(morpheus_default_l1_qemu_memory_mb)"
}
