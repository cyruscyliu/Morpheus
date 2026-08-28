#!/usr/bin/env bash
set -euo pipefail

# Exercise the real LibAFL grammar path without constructing a QEMU command.
# The probe loads the generated phase files, generates one ScenarioInput,
# mutates it, validates both paths, checks the encoded size, and prints the
# readable actions before and after mutation. A grammar with only one valid
# path may legitimately report a skipped mutation.
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

probe_status=0
probe_output="$(cargo run \
  --manifest-path "${source_dir}/Cargo.toml" \
  --package libafl_nesting \
  --example devilang_grammar_probe \
  -- "${grammar_path}" 2>&1)" || probe_status=$?
printf '%s\n' "${probe_output}" >&2
[ "${probe_status}" -eq 0 ] || exit "${probe_status}"

mutation_summary="$(printf '%s\n' "${probe_output}" | grep -E 'mutation validated: attempts=[0-9]+ distinct=(true|false)' | tail -n 1 || true)"
[ -n "${mutation_summary}" ] || {
  echo "grammar probe did not report mutation validation" >&2
  exit 1
}

node - "${result_file}" "${source_dir}" "${grammar_path}" "${mutation_summary}" <<'NODE'
const fs = require("fs");
const [resultFile, source, grammar, mutationSummary] = process.argv.slice(2);
const mutation = /mutation validated: attempts=(\d+) distinct=(true|false)/.exec(mutationSummary);
if (!mutation) {
  throw new Error("grammar probe did not report mutation validation");
}
fs.mkdirSync(require("path").dirname(resultFile), { recursive: true });
fs.writeFileSync(resultFile, `${JSON.stringify({
  details: {
    source,
    grammar,
    generated: true,
    mutation_attempts: Number(mutation[1]),
    distinct_mutation: mutation[2] === "true",
    validated: true,
    max_encoded_bytes: 4096,
  },
})}\n`);
NODE
