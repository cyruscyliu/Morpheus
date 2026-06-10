#!/usr/bin/env bash
set -euo pipefail

source_dir="${MORPHEUS_LIBAFL_SOURCE:?}"
patch_dir="${MORPHEUS_LIBAFL_PATCH_DIR:?}"
result_file="${MORPHEUS_LIBAFL_RESULT_FILE:-${MORPHEUS_SCRIPT_RESULT_FILE:?}}"
state_file="${source_dir}/.morpheus-libafl-nesting.json"
crate_dir="${source_dir}/crates/libafl_nesting"
example_dir="${source_dir}/fuzzers/full_system/qemu_nesting"
workspace_toml="${source_dir}/Cargo.toml"

mkdir -p "$(dirname "${result_file}")"

if [ ! -d "${source_dir}" ]; then
  echo "missing source directory: ${source_dir}" >&2
  exit 1
fi
if [ ! -d "${patch_dir}" ]; then
  echo "missing patch directory: ${patch_dir}" >&2
  exit 1
fi

repo_root="$(git -C "$(dirname "$0")/../.." rev-parse --show-toplevel 2>/dev/null || true)"
patch_dir_abs="$(realpath "${patch_dir}")"
if [ -n "${repo_root}" ] && [ "${patch_dir_abs#${repo_root}/}" != "${patch_dir_abs}" ]; then
  patch_dir_rel="${patch_dir_abs#${repo_root}/}"
  fingerprint_files="$(git -C "${repo_root}" ls-files -- "${patch_dir_rel}" | sed "s#^#${repo_root}/#")"
else
  fingerprint_files="$(find "${patch_dir}" -type f | sort)"
fi
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

rm -rf "${crate_dir}"
rm -rf "${example_dir}"
mkdir -p "${source_dir}/crates"
mkdir -p "${source_dir}/fuzzers/full_system"
cp -R "${patch_dir}/crates/libafl_nesting" "${crate_dir}"
cp -R "${patch_dir}/fuzzers/full_system/qemu_nesting" "${example_dir}"

node - "${workspace_toml}" <<'NODE'
const fs = require('fs');
const path = process.argv[2];
let text = fs.readFileSync(path, 'utf8');
if (!text.includes('"crates/libafl_nesting"')) {
  text = text.replace(
    '  "crates/libafl_nyx",\n',
    '  "crates/libafl_nyx",\n  "crates/libafl_nesting",\n'
  );
}
if (!text.includes('libafl_nesting = { path = "./crates/libafl_nesting"')) {
  text = text.replace(
    'libafl_nyx = { path = "./crates/libafl_nyx", version = "0.16.0", default-features = false }\n',
    'libafl_nyx = { path = "./crates/libafl_nyx", version = "0.16.0", default-features = false }\nlibafl_nesting = { path = "./crates/libafl_nesting", version = "0.16.0", default-features = false }\n'
  );
}
fs.writeFileSync(path, text);
NODE

cat > "${state_file}" <<EOF
{
  "appliedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "dir": "${patch_dir}",
  "fingerprint": "${fingerprint}"
}
EOF

cat > "${result_file}" <<EOF
{"details":{"applied":true,"fingerprint":"${fingerprint}","crate_dir":"${crate_dir}","example_dir":"${example_dir}"}}
EOF
