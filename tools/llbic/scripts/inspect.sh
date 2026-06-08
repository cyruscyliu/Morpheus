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
const manifestPath = path.basename(target) === "llbic.json" ? target : path.join(outputDir, "llbic.json");
if (!fs.existsSync(manifestPath)) {
  throw new Error(`llbic.json not found under: ${outputDir}`);
}
const payload = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const details = {
  target,
  source: payload.source_dir || "",
  output: outputDir,
  kernel_version: payload.kernel_version || "",
  arch: payload.arch || "",
  status: payload.status || "",
  bitcode_count: payload.bitcode_count || 0,
};
const artifacts = [
  ["source-dir", payload.source_dir || ""],
  ["output-dir", outputDir],
  ["llbic-json", manifestPath],
  ["bitcode-files", path.join(outputDir, "bitcode_files.txt")],
  ["llbic-log", path.join(outputDir, "llbic.log")],
  ["kernel-build-log", path.join(outputDir, "kernel-build.log")],
].filter(([, location]) => location && fs.existsSync(location))
  .map(([artifactPath, location]) => ({ path: artifactPath, location }));
fs.writeFileSync(
  resultFile,
  JSON.stringify({ details, artifacts }, null, 2) + "\n",
  "utf8",
);
EOF
