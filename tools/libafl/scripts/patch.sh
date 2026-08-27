#!/usr/bin/env bash
set -euo pipefail

repo_root="${MORPHEUS_REPO_ROOT:?missing MORPHEUS_REPO_ROOT}"
source "${repo_root}/tools/_shared/scripts/state.sh"

source_dir="${MORPHEUS_LIBAFL_SOURCE:?}"
patch_dir="${MORPHEUS_LIBAFL_PATCH_DIR:?}"
result_file="${MORPHEUS_LIBAFL_RESULT_FILE:-${MORPHEUS_SCRIPT_RESULT_FILE:?}}"
state_file="${source_dir}/.morpheus-qemu-nesting.json"
crate_dir="${source_dir}/crates/libafl_nesting"
example_dir="${source_dir}/fuzzers/full_system/qemu_nesting"
workspace_toml="${source_dir}/Cargo.toml"

mkdir -p "$(dirname "${result_file}")"
[ -d "${source_dir}" ] || { echo "missing source directory: ${source_dir}" >&2; exit 1; }
[ -d "${patch_dir}" ] || { echo "missing patch directory: ${patch_dir}" >&2; exit 1; }
[ -d "${patch_dir}/crates/libafl_nesting" ] || { echo "missing libafl_nesting patch tree under ${patch_dir}" >&2; exit 1; }
[ -d "${patch_dir}/fuzzers/full_system/qemu_nesting" ] || { echo "missing qemu_nesting patch tree under ${patch_dir}" >&2; exit 1; }

fingerprint_files="$(find "${patch_dir}/crates/libafl_nesting" "${patch_dir}/fuzzers/full_system/qemu_nesting" -type f | sort)"
fingerprint="$(printf 'external-qemu-build-adapter-v2\n%s\n' "${fingerprint_files}" | morpheus_hash_files_from_stdin)"

if morpheus_patch_state_matches "${state_file}" "${fingerprint}"; then
  cat > "${result_file}" <<EOF
{"details":{"reused":true,"applied":true,"fingerprint":"${fingerprint}","crate_dir":"${crate_dir}","example_dir":"${example_dir}"}}
EOF
  exit 0
fi

rm -rf "${crate_dir}" "${example_dir}"
mkdir -p "${source_dir}/crates" "${source_dir}/fuzzers/full_system"
cp -a "${patch_dir}/crates/libafl_nesting" "${crate_dir}"
cp -a "${patch_dir}/fuzzers/full_system/qemu_nesting" "${example_dir}"

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

# The LibAFL QEMU build helper predates externally prebuilt bridge trees. Keep
# its normal configure/build behavior intact, but add an explicit external
# build mode that consumes the already-configured QEMU tree. These edits are
# deliberately idempotent because the managed source is reused between runs.
node - "${source_dir}" <<'NODE'
const fs = require("fs");
const path = require("path");
const source = process.argv[2];

function edit(file, replacements) {
  const full = path.join(source, file);
  let text = fs.readFileSync(full, "utf8");
  for (const [from, to] of replacements) {
    if (text.includes(to)) continue;
    if (!text.includes(from)) {
      throw new Error(`cannot adapt ${file}: missing expected text`);
    }
    text = text.replace(from, to);
  }
  fs.writeFileSync(full, text);
}

edit("crates/libafl_qemu/libafl_qemu_build/src/build.rs", [
  [
    '    let libafl_qemu_no_build = env::var("LIBAFL_QEMU_NO_BUILD").is_ok();\n',
    '    let libafl_qemu_no_build = env::var("LIBAFL_QEMU_NO_BUILD").is_ok();\n' +
      '    let libafl_qemu_external_build = env::var("LIBAFL_QEMU_EXTERNAL_BUILD").is_ok();\n',
  ],
  [
    '    println!("cargo:rerun-if-env-changed=LIBAFL_QEMU_NO_BUILD");\n',
    '    println!("cargo:rerun-if-env-changed=LIBAFL_QEMU_NO_BUILD");\n' +
      '    println!("cargo:rerun-if-env-changed=LIBAFL_QEMU_EXTERNAL_BUILD");\n',
  ],
  [
    '    let must_reconfigure = if libafl_qemu_force_configure {\n',
    '    let must_reconfigure = if libafl_qemu_external_build {\n' +
      '        false\n' +
      '    } else if libafl_qemu_force_configure {\n',
  ],
  [
    '    if !libafl_qemu_no_build {\n',
    '    if !libafl_qemu_no_build && !libafl_qemu_external_build {\n',
  ],
]);

edit("crates/libafl_qemu/libafl_qemu_build/src/lib.rs", [
  [
    ') -> Vec<String> {\n    if env::var("LLVM_CONFIG_PATH").is_err() {\n',
    ') -> Vec<String> {\n    let build_dir = fs::canonicalize(build_dir)\n' +
      '        .expect("failed to resolve QEMU build directory");\n' +
      '    if env::var("LLVM_CONFIG_PATH").is_err() {\n',
  ],
  ['include_path(build_dir, incpath)', 'include_path(&build_dir, incpath)'],
  ['include_path(build_dir, &arg)', 'include_path(&build_dir, &arg)'],
]);

edit("crates/libafl_qemu/libafl_qemu_build/src/bindings.rs", [
  ['#include "hw/qdev-core.h"', '#include "hw/core/qdev.h"'],
  ['#include "hw/qdev-properties.h"', '#include "hw/core/qdev-properties.h"'],
]);
NODE

morpheus_write_patch_state "${state_file}" "${patch_dir}" "${fingerprint}"

cat > "${result_file}" <<EOF
{"details":{"applied":true,"fingerprint":"${fingerprint}","crate_dir":"${crate_dir}","example_dir":"${example_dir}"}}
EOF
