#!/usr/bin/env bash
set -euo pipefail

source_dir="${MORPHEUS_BUILDROOT_SOURCE:?}"
patch_dir="${MORPHEUS_BUILDROOT_PATCH_DIR:?}"
result_file="${MORPHEUS_BUILDROOT_RESULT_FILE:-${MORPHEUS_SCRIPT_RESULT_FILE:?}}"
log_file="${source_dir}/.morpheus-patches.log"
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
  find "${root}" -mindepth 1 -maxdepth 1 -type f \( -name '*.patch' -o -name '*.diff' \) | sort
  if [ -d "${root}/buildroot" ]; then
    find "${root}/buildroot" -type f \( -name '*.patch' -o -name '*.diff' \) | sort
  fi
}

collect_fingerprint_files() {
  local root="$1"
  find "${root}" -type f ! -path '*/.*' | sort
}

patch_files=""
if has_strategy "source-tree"; then
  patch_files="$(collect_source_tree_patch_files "${patch_dir}")"
fi
fingerprint_files="$(collect_fingerprint_files "${patch_dir}")"
fingerprint="$(
  {
    printf '%s\n' "${fingerprint_files}"
    while IFS= read -r file; do
      [ -n "${file}" ] || continue
      cat "${file}"
    done <<EOF
${fingerprint_files}
EOF
  } | sha256sum | awk '{print $1}'
)"

if [ -f "${state_file}" ] && grep -q "\"fingerprint\": \"${fingerprint}\"" "${state_file}"; then
  cat > "${result_file}" <<EOF
{"details":{"reused":true,"applied":true,"fingerprint":"${fingerprint}"}}
EOF
  exit 0
fi

: > "${log_file}"
if has_strategy "source-tree" && [ -n "${patch_files}" ]; then
  while IFS= read -r patch_file; do
    [ -n "${patch_file}" ] || continue
    printf '>>> %s\n' "${patch_file#${patch_dir}/}" >> "${log_file}"
    patch -d "${source_dir}" -p1 -N -i "${patch_file}" >> "${log_file}" 2>&1
  done <<EOF
${patch_files}
EOF
else
  printf 'no direct buildroot source patches under %s\n' "${patch_dir}" >> "${log_file}"
fi

cat > "${state_file}" <<EOF
{
  "appliedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "dir": "${patch_dir}",
  "fingerprint": "${fingerprint}"
}
EOF

cat > "${result_file}" <<EOF
{"details":{"applied":true,"fingerprint":"${fingerprint}"}}
EOF
