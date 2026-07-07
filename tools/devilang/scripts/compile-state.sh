#!/usr/bin/env bash
set -euo pipefail

tool_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
result_file="${MORPHEUS_DEVILANG_RESULT_FILE:-${MORPHEUS_SCRIPT_RESULT_FILE:?}}"
output_c="${MORPHEUS_DEVILANG_OUTPUT_C:-}"
output_h="${MORPHEUS_DEVILANG_OUTPUT_H:-}"
symbol_prefix="${MORPHEUS_DEVILANG_SYMBOL_PREFIX:-devilang}"
input_inline="${MORPHEUS_DEVILANG_INPUT:-}"

[ -n "${output_c}" ] || {
  echo "devilang compile-state requires --output-c" >&2
  exit 1
}
[ -n "${output_h}" ] || {
  echo "devilang compile-state requires --output-h" >&2
  exit 1
}

inputs=()
if [ -n "${input_inline}" ]; then
  while IFS= read -r item; do
    [ -n "${item}" ] || continue
    inputs+=("${item}")
  done <<< "${input_inline}"
fi

[ "${#inputs[@]}" -gt 0 ] || {
  echo "devilang compile-state requires at least one --input" >&2
  exit 1
}

mkdir -p "$(dirname "${output_c}")" "$(dirname "${output_h}")"

cmd=(
  python3
  "${tool_root}/scripts/compile_state.py"
  --output-c "${output_c}"
  --output-h "${output_h}"
  --symbol-prefix "${symbol_prefix}"
)
for input_path in "${inputs[@]}"; do
  cmd+=(--input "${input_path}")
done
"${cmd[@]}"

node - "${result_file}" "${output_c}" "${output_h}" "${symbol_prefix}" "${inputs[@]}" <<'EOF'
const fs = require("fs");
const path = require("path");

const [resultFileArg, outputCArg, outputHArg, symbolPrefixArg, ...inputs] =
  process.argv.slice(2);
const payload = {
  summary: "compiled devilang state into C sources",
  details: {
    output_c: path.resolve(outputCArg),
    output_h: path.resolve(outputHArg),
    symbol_prefix: String(symbolPrefixArg || "devilang"),
    inputs: inputs.map((item) => path.resolve(item)),
  },
  artifacts: [
    { path: "output-c", location: path.resolve(outputCArg) },
    { path: "output-h", location: path.resolve(outputHArg) },
  ],
};
fs.writeFileSync(path.resolve(resultFileArg), JSON.stringify(payload, null, 2) + "\n");
EOF
