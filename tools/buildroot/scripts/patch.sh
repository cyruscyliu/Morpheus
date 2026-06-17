#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/../../_shared/scripts/state.sh"

source_dir="${MORPHEUS_BUILDROOT_SOURCE:?}"
patch_dir="${MORPHEUS_BUILDROOT_PATCH_DIR:?}"
result_file="${MORPHEUS_BUILDROOT_RESULT_FILE:-${MORPHEUS_SCRIPT_RESULT_FILE:?}}"
state_file="${source_dir}/.morpheus-patches.json"
patch_strategies="${MORPHEUS_BUILDROOT_PATCH_STRATEGIES:-${MORPHEUS_SCRIPT_PATCH_STRATEGIES:-source-tree}}"

if [ ! -d "${source_dir}" ]; then
  echo "missing source directory: ${source_dir}" >&2
  exit 1
fi
if [ ! -d "${patch_dir}" ]; then
  echo "missing patch directory: ${patch_dir}" >&2
  exit 1
fi

has_strategy() {
  case ",${patch_strategies}," in
    *,"$1",*) return 0 ;;
    *) return 1 ;;
  esac
}

collect_source_tree_patch_files() {
  local root="$1"
  local file

  for file in "${root}"/*.patch "${root}"/*.diff; do
    [ -f "${file}" ] && printf '%s\n' "${file}"
  done | sort

  if [ -d "${root}/buildroot" ]; then
    for file in "${root}/buildroot"/*.patch "${root}/buildroot"/*.diff; do
      [ -f "${file}" ] && printf '%s\n' "${file}"
    done | sort
  fi

  # Linux patches are applied by Buildroot itself via BR2_GLOBAL_PATCH_DIR or
  # the package patch hooks during the build step. Do not patch the Buildroot
  # source tree with them here, or they will be applied twice.

  return 0
}

collect_fingerprint_files() {
  local root="$1"
  local file

  {
    for file in "${root}"/*; do
      [ -f "${file}" ] && printf '%s\n' "${file}"
    done
    for file in "${root}"/linux/* "${root}"/linux-headers/* "${root}"/buildroot/*; do
      [ -f "${file}" ] && printf '%s\n' "${file}"
    done
  } | sort

  return 0
}

patch_files=""
if has_strategy "source-tree"; then
  patch_files="$(collect_source_tree_patch_files "${patch_dir}")"
fi
fingerprint_files="$(collect_fingerprint_files "${patch_dir}")"
fingerprint="$(printf '%s\n' "${fingerprint_files}" | morpheus_hash_files_from_stdin)"

if morpheus_patch_state_matches "${state_file}" "${fingerprint}"; then
  printf '[buildroot] reuse patch state %s fingerprint=%s\n' "${patch_dir}" "${fingerprint}"
  cat > "${result_file}" <<EOF
{"details":{"reused":true,"applied":true,"fingerprint":"${fingerprint}"}}
EOF
  exit 0
fi

if has_strategy "source-tree" && [ -n "${patch_files}" ]; then
  while IFS= read -r patch_file; do
    [ -n "${patch_file}" ] || continue
    printf '>>> %s\n' "${patch_file#${patch_dir}/}"
    patch -d "${source_dir}" -p1 -N -i "${patch_file}"
  done <<EOF
${patch_files}
EOF
else
  printf 'no direct buildroot source patches under %s\n' "${patch_dir}"
fi

morpheus_write_patch_state "${state_file}" "${patch_dir}" "${fingerprint}"

printf '[buildroot] applied patch contract %s fingerprint=%s\n' "${patch_dir}" "${fingerprint}"
cat > "${result_file}" <<EOF
{"details":{"applied":true,"fingerprint":"${fingerprint}"}}
EOF
