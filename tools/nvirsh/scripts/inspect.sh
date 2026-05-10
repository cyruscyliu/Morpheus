#!/usr/bin/env bash
set -euo pipefail

source_dir="${MORPHEUS_NVIRSH_SOURCE:?}"
run_dir="${MORPHEUS_NVIRSH_RUN_DIR:-}"
install_dir="${MORPHEUS_NVIRSH_INSTALL_DIR:-}"
build_dir="${MORPHEUS_NVIRSH_BUILD_DIR:-}"
profile_name="${MORPHEUS_NVIRSH_BUILD_VERSION:-default}"
build_dir_key="${MORPHEUS_NVIRSH_BUILD_DIR_KEY:-${profile_name}}"
result_file="${MORPHEUS_NVIRSH_RESULT_FILE:-${MORPHEUS_SCRIPT_RESULT_FILE:?}}"

manifest_file=""
if [ -n "${run_dir}" ] && [ -f "${run_dir}/manifest.json" ]; then
  manifest_file="${run_dir}/manifest.json"
elif [ -n "${install_dir}" ] && [ -f "${install_dir}/state.json" ]; then
  manifest_file="${install_dir}/state.json"
else
  manifest_file="${install_dir}/state.json"
fi

if [ ! -f "${manifest_file}" ]; then
  echo "missing nvirsh manifest: ${manifest_file}" >&2
  exit 1
fi

node - "${manifest_file}" "${source_dir}" "${run_dir}" "${build_dir}" "${install_dir}" "${profile_name}" "${build_dir_key}" "${result_file}" <<'NODE'
const fs = require("fs");
const [manifestFile, sourceDir, runDir, buildDir, installDir, profileName, buildDirKey, resultFile] = process.argv.slice(2);
const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
const details = {
  profile: profileName,
  build_dir_key: buildDirKey,
  source: sourceDir || null,
  build_dir: buildDir || null,
  install_dir: installDir || null,
  run_dir: runDir || null,
  manifest: manifestFile,
  status: manifest.status || "unknown",
  current_phase: manifest.currentPhase || null,
  runtime_pid: manifest.runtime && manifest.runtime.pid != null ? manifest.runtime.pid : null,
  phases: manifest.phases || null,
  layered_state: manifest.layeredState || null
};
fs.writeFileSync(resultFile, `${JSON.stringify({ details }, null, 2)}\n`);
NODE
