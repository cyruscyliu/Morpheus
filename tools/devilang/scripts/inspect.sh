#!/usr/bin/env bash
set -euo pipefail

result_file="${MORPHEUS_DEVILANG_RESULT_FILE:-${MORPHEUS_SCRIPT_RESULT_FILE:?}}"
target="${MORPHEUS_DEVILANG_TARGET:?}"

node - "${target}" "${result_file}" <<'EOF'
const fs = require("fs");
const path = require("path");

const [targetPathArg, resultFileArg] = process.argv.slice(2);
const targetPath = path.resolve(targetPathArg);
const resultFile = path.resolve(resultFileArg);
const payload = JSON.parse(fs.readFileSync(targetPath, "utf8"));
fs.writeFileSync(
  resultFile,
  JSON.stringify({
    summary: payload.summary || "inspected existing devilang manifest",
    details: payload.details || {},
    artifacts: Array.isArray(payload.artifacts) ? payload.artifacts : [],
  }, null, 2) + "\n",
  "utf8",
);
EOF
