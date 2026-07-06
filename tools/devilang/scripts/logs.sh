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
const artifacts = Array.isArray(payload.artifacts) ? payload.artifacts : [];
const logFile = artifacts.find((entry) => entry && entry.path === "log-file");
if (!logFile || !logFile.location) {
  throw new Error("devilang manifest does not contain a log-file artifact");
}
fs.writeFileSync(
  resultFile,
  JSON.stringify({
    summary: payload.summary || "read devilang log",
    details: {
      log_file: logFile.location,
      content: fs.readFileSync(logFile.location, "utf8"),
    },
  }, null, 2) + "\n",
  "utf8",
);
EOF
