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

mapfile -t manifest_fields < <(
  node - "${manifest_file}" <<'NODE'
const fs = require("fs");
const manifest = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
process.stdout.write(`${String(manifest.status || "")}\n`);
const values = [
  manifest.runtime && manifest.runtime.pid ? Number(manifest.runtime.pid) : null,
  manifest.runtime && manifest.runtime.supervisorPid ? Number(manifest.runtime.supervisorPid) : null,
  manifest.runtime && manifest.runtime.l1 && manifest.runtime.l1.pid ? Number(manifest.runtime.l1.pid) : null,
].filter((value) => Number.isInteger(value) && value > 0);
process.stdout.write([...new Set(values)].join("\n"));
NODE
)

current_status="${manifest_fields[0]:-}"
pids=("${manifest_fields[@]:1}")
had_live_pid=false
for pid in "${pids[@]}"; do
  [ -n "${pid}" ] || continue
  if kill -0 "${pid}" 2>/dev/null; then
    had_live_pid=true
  fi
  kill "${pid}" 2>/dev/null || true
done

node - "${manifest_file}" "${current_status}" "${had_live_pid}" <<'NODE'
const fs = require("fs");
const manifestFile = process.argv[2];
const currentStatus = String(process.argv[3] || "").trim().toLowerCase();
const hadLivePid = process.argv[4] === "true";
const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
const preserveTerminalStatus = !hadLivePid && (currentStatus === "success" || currentStatus === "error");
manifest.status = preserveTerminalStatus ? currentStatus : "stopped";
manifest.currentPhase = "stopped";
manifest.updatedAt = new Date().toISOString();
manifest.runtime = manifest.runtime || {};
manifest.runtime.pid = null;
manifest.runtime.supervisorPid = null;
manifest.runtime.l1 = manifest.runtime.l1 || {};
manifest.runtime.l1.pid = null;
if (manifest.phases) {
  for (const key of Object.keys(manifest.phases)) {
    if (manifest.phases[key] === "pending") {
      manifest.phases[key] = preserveTerminalStatus ? manifest.phases[key] : "stopped";
    }
    if (!preserveTerminalStatus && manifest.phases[key] === "running") {
      manifest.phases[key] = "stopped";
    }
  }
}
fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
NODE

cat > "${result_file}" <<EOF
{"details":{"stopped":true,"pid":${pids[0]:-null},"manifest":"${manifest_file}"}}
EOF
