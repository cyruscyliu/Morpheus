#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/../../_shared/scripts/state.sh"

source_dir="${MORPHEUS_PKVM_AARCH64_SOURCE:?}"
patch_dir="${MORPHEUS_PKVM_AARCH64_PATCH_DIR:?}"
result_file="${MORPHEUS_PKVM_AARCH64_RESULT_FILE:-${MORPHEUS_SCRIPT_RESULT_FILE:?}}"
state_file="${source_dir}/.morpheus-patches.json"

if [ ! -d "${source_dir}" ]; then
  echo "missing pKVM source directory: ${source_dir}" >&2
  exit 1
fi
if [ ! -d "${patch_dir}" ]; then
  echo "missing pKVM patch directory: ${patch_dir}" >&2
  exit 1
fi

fingerprint_files="$(find "${patch_dir}" -type f | sort)"
fingerprint="$(printf '%s\n' "${fingerprint_files}" | morpheus_hash_files_from_stdin)"

apply_overlay() {
  if [ -d "${patch_dir}/scripts" ]; then
  find "${patch_dir}/scripts" -type f -print0 | while IFS= read -r -d '' file; do
    rel="${file#${patch_dir}/scripts/}"
    install -D -m 0755 "${file}" "${source_dir}/scripts/${rel}"
  done
  fi

  virt_makefile="${source_dir}/platform/virt/Makefile"
  if [ -f "${virt_makefile}" ]; then
    sed -i 's/hostfwd=tcp:$(WAYOUT):$(PORT)-192.168.7.2:22/hostfwd=tcp:127.0.0.1:$(PORT)-192.168.7.2:22/' "${virt_makefile}"
  fi

  root_makefile="${source_dir}/Makefile"
  if [ -f "${root_makefile}" ]; then
    sed -i \
      -e 's/@sudo -E \.\/scripts\/create_guestimg\.sh \$(USER)/@.\/scripts\/create_guestimg.sh $(USER)/' \
      -e 's/@sudo -E \.\/scripts\/create_guestimg2\.sh \$(USER)/@.\/scripts\/create_guestimg2.sh $(USER)/' \
      -e 's/@sudo -E \.\/scripts\/create_hostimg\.sh \$(USER)/@.\/scripts\/create_hostimg.sh $(USER)/' \
      -e 's/@sudo -E \.\/scripts\/add_guest2host\.sh \$(USER)/@.\/scripts\/add_guest2host.sh $(USER)/' \
      "${root_makefile}"
  fi
}

if morpheus_patch_state_matches "${state_file}" "${fingerprint}"; then
  apply_overlay
  cat > "${result_file}" <<EOF
{"details":{"reused":true,"applied":true,"fingerprint":"${fingerprint}","source":"${source_dir}","patch_dir":"${patch_dir}"}}
EOF
  exit 0
fi

printf '[pkvm-aarch64] patch fingerprint changed, refetching clean source before apply\n'
rm -rf "${source_dir}"
"$(dirname "$0")/fetch.sh"

apply_overlay

morpheus_write_patch_state "${state_file}" "${patch_dir}" "${fingerprint}"

cat > "${result_file}" <<EOF
{"details":{"applied":true,"fingerprint":"${fingerprint}","source":"${source_dir}","patch_dir":"${patch_dir}"}}
EOF
