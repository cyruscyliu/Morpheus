#!/usr/bin/env bash
set -euo pipefail

run_dir="${MORPHEUS_NVIRSH_RUN_DIR:-}"
install_dir="${MORPHEUS_NVIRSH_INSTALL_DIR:-}"
result_file="${MORPHEUS_NVIRSH_RESULT_FILE:-${MORPHEUS_SCRIPT_RESULT_FILE:?}}"

manifest_file=""
if [ -n "${run_dir}" ] && [ -f "${run_dir}/manifest.json" ]; then
  manifest_file="${run_dir}/manifest.json"
elif [ -n "${install_dir}" ] && [ -f "${install_dir}/state.json" ]; then
  manifest_file="${install_dir}/state.json"
else
  manifest_file="${run_dir}/manifest.json"
fi

if [ ! -f "${manifest_file}" ]; then
  echo "missing nvirsh manifest: ${manifest_file}" >&2
  exit 1
fi

pid="$(node -e 'const fs=require("fs"); const m=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(String(m.runtime && m.runtime.pid ? m.runtime.pid : ""));' "${manifest_file}")"
if [ -n "${pid}" ]; then
  kill "${pid}" 2>/dev/null || true
fi

node - "${manifest_file}" <<'NODE'
const fs = require("fs");
const manifestFile = process.argv[2];
const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
manifest.status = "stopped";
manifest.currentPhase = "stopped";
manifest.updatedAt = new Date().toISOString();
manifest.runtime = manifest.runtime || {};
manifest.runtime.pid = null;
if (manifest.phases) {
  for (const key of Object.keys(manifest.phases)) {
    if (manifest.phases[key] === "pending") {
      manifest.phases[key] = "stopped";
    }
  }
}
fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
NODE

cat > "${result_file}" <<EOF
{"details":{"stopped":true,"pid":${pid:-null},"manifest":"${manifest_file}"}}
EOF
