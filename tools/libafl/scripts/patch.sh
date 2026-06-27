#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/../../_shared/scripts/state.sh"
source "$(dirname "${BASH_SOURCE[0]}")/../../_shared/scripts/project-hook.sh"

source_dir="${MORPHEUS_LIBAFL_SOURCE:?}"
patch_dir="${MORPHEUS_LIBAFL_PATCH_DIR:?}"
patch_script="${MORPHEUS_LIBAFL_PATCH_SCRIPT:-}"
result_file="${MORPHEUS_LIBAFL_RESULT_FILE:-${MORPHEUS_SCRIPT_RESULT_FILE:?}}"
state_file="${source_dir}/.morpheus-libafl-nesting.json"
crate_dir="${source_dir}/crates/libafl_nesting"
workspace_toml="${source_dir}/Cargo.toml"

mkdir -p "$(dirname "${result_file}")"
[ -d "${source_dir}" ] || { echo "missing source directory: ${source_dir}" >&2; exit 1; }
[ -d "${patch_dir}" ] || { echo "missing patch directory: ${patch_dir}" >&2; exit 1; }
[ -d "${patch_dir}/crates/libafl_nesting" ] || { echo "missing libafl_nesting patch tree under ${patch_dir}" >&2; exit 1; }

morpheus_delegate_project_hook "${BASH_SOURCE[0]}" "${patch_script}" "libafl patch" || true

fingerprint_files="$(find "${patch_dir}/crates/libafl_nesting" -type f | sort)"
fingerprint="$(printf '%s\n' "${fingerprint_files}" | morpheus_hash_files_from_stdin)"

if morpheus_patch_state_matches "${state_file}" "${fingerprint}"; then
  cat > "${result_file}" <<EOF
{"details":{"reused":true,"applied":true,"fingerprint":"${fingerprint}","crate_dir":"${crate_dir}"}}
EOF
  exit 0
fi

rm -rf "${crate_dir}"
mkdir -p "${source_dir}/crates"
cp -a "${patch_dir}/crates/libafl_nesting" "${crate_dir}"

node - "${workspace_toml}" <<'NODE'
const fs = require("fs");
const path = process.argv[2];
let text = fs.readFileSync(path, "utf8");
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

morpheus_write_patch_state "${state_file}" "${patch_dir}" "${fingerprint}"

cat > "${result_file}" <<EOF
{"details":{"applied":true,"fingerprint":"${fingerprint}","crate_dir":"${crate_dir}"}}
EOF
