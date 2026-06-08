#!/usr/bin/env bash
set -euo pipefail

tool_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
legacy="${tool_root}/bin/llcg"
result_file="${MORPHEUS_LLCG_RESULT_FILE:-${MORPHEUS_SCRIPT_RESULT_FILE:?}}"
target="${MORPHEUS_LLCG_TARGET:?}"

tmp_json="$(mktemp)"
trap 'rm -f "${tmp_json}"' EXIT
"${legacy}" inspect "${target}" --json > "${tmp_json}"
node - "${tmp_json}" "${result_file}" <<'EOF'
const fs = require("fs");

const payload = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const resultFile = process.argv[3];
const pathEntries = payload.paths && typeof payload.paths === "object" ? payload.paths : {};
const artifacts = Object.entries(pathEntries)
  .filter(([, entry]) => entry && typeof entry.resolved_path === "string")
  .map(([artifactPath, entry]) => ({ path: artifactPath, location: entry.resolved_path }));
fs.writeFileSync(
  resultFile,
  JSON.stringify({
    summary: payload.summary || "inspected existing llcg manifest",
    details: payload.details || {},
    artifacts,
  }, null, 2) + "\n",
  "utf8",
);
EOF
