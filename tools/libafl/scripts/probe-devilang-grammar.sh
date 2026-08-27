#!/usr/bin/env bash
set -euo pipefail

# Exercise the real LibAFL grammar path without constructing a QEMU command.
# The probe loads the generated phase files, generates one ScenarioInput,
# mutates it, validates both paths, checks the encoded size, and prints the
# readable actions before and after mutation.
source_dir="${MORPHEUS_LIBAFL_SOURCE:?}"
grammar_path="${MORPHEUS_LIBAFL_GRAMMAR:-${MORPHEUS_LIBAFL_DEVILANG_GRAMMAR:-}}"
result_file="${MORPHEUS_LIBAFL_RESULT_FILE:-${MORPHEUS_SCRIPT_RESULT_FILE:?}}"

[ -n "${grammar_path}" ] || {
  echo "missing grammar path (set MORPHEUS_LIBAFL_GRAMMAR)" >&2
  exit 1
}

[ -d "${source_dir}" ] || {
  echo "missing LibAFL source directory: ${source_dir}" >&2
  exit 1
}
[ -e "${grammar_path}" ] || {
  echo "missing Devilang grammar: ${grammar_path}" >&2
  exit 1
}

if [ -f "${HOME}/.cargo/env" ]; then
  # shellcheck disable=SC1090
  source "${HOME}/.cargo/env"
fi
command -v cargo >/dev/null 2>&1 || {
  echo "missing cargo; run tools/libafl/scripts/install-dependencies.sh" >&2
  exit 1
}

export CARGO_NET_OFFLINE="${CARGO_NET_OFFLINE:-true}"
export RUSTFLAGS="${RUSTFLAGS:-} -Adeprecated"

cargo run \
  --manifest-path "${source_dir}/Cargo.toml" \
  --package libafl_nesting \
  --example devilang_grammar_probe \
  -- "${grammar_path}" >&2

node - "${result_file}" "${source_dir}" "${grammar_path}" <<'NODE'
const fs = require("fs");
const [resultFile, source, grammar] = process.argv.slice(2);
fs.mkdirSync(require("path").dirname(resultFile), { recursive: true });
fs.writeFileSync(resultFile, `${JSON.stringify({
  details: {
    source,
    grammar,
    generated: true,
    mutated: true,
    validated: true,
    max_encoded_bytes: 4096,
  },
})}\n`);
NODE
