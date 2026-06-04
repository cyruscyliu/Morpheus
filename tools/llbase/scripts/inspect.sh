#!/usr/bin/env bash
set -euo pipefail

target="${MORPHEUS_LLBASE_TARGET:?}"
result_file="${MORPHEUS_LLBASE_RESULT_FILE:-${MORPHEUS_SCRIPT_RESULT_FILE:?}}"

node - "${target}" "${result_file}" <<'EOF'
const fs = require("fs");
const path = require("path");

const [targetArg, resultFileArg] = process.argv.slice(2);
const target = path.resolve(targetArg);
const contractPath = path.basename(target) === "runtime-contract.json"
  ? target
  : path.join(target, "runtime-contract.json");
if (!fs.existsSync(contractPath)) {
  throw new Error(`runtime-contract.json not found under: ${target}`);
}
const payload = JSON.parse(fs.readFileSync(contractPath, "utf8"));
fs.writeFileSync(path.resolve(resultFileArg), JSON.stringify({
  details: {
    target,
    runtime_contract: contractPath,
    provider: payload.provider || "",
    source: payload.sourceDir || "",
  },
  artifacts: [
    { path: "runtime-contract", location: contractPath },
    ...(payload.sourceDir ? [{ path: "source-dir", location: payload.sourceDir }] : []),
  ],
}, null, 2) + "\n", "utf8");
EOF
