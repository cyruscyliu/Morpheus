#!/usr/bin/env bash
set -euo pipefail

result_file="${MORPHEUS_LLBIC_RESULT_FILE:-${MORPHEUS_SCRIPT_RESULT_FILE:?}}"
target="${MORPHEUS_LLBIC_TARGET:?}"

node - "${target}" "${result_file}" <<'EOF'
const fs = require("fs");
const path = require("path");

const target = path.resolve(process.argv[2]);
const resultFile = path.resolve(process.argv[3]);
const outputDir = path.basename(target) === "llbic.json" ? path.dirname(target) : target;
const logPath = path.join(outputDir, "llbic.log");
if (!fs.existsSync(logPath)) {
  throw new Error(`llbic.log not found under: ${outputDir}`);
}
fs.writeFileSync(
  resultFile,
  JSON.stringify({
    details: {
      target,
      log_file: logPath,
      text: fs.readFileSync(logPath, "utf8"),
    },
  }, null, 2) + "\n",
  "utf8",
);
EOF
