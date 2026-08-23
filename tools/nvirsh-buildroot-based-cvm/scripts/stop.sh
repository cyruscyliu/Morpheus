#!/usr/bin/env bash
set -euo pipefail

run_dir="${MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_RUN_DIR:-${PWD}}"
result_file="${MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_RESULT_FILE:-${MORPHEUS_SCRIPT_RESULT_FILE:?}}"
manifest_file="${run_dir}/manifest.json"
stop_request_file="${run_dir}/stop-requested"
l1_pid_file="${run_dir}/l1.pid"

if [ ! -f "${manifest_file}" ]; then
  echo "missing buildroot-based CVM manifest: ${manifest_file}" >&2
  exit 1
fi

mapfile -d '' -t manifest_fields < <(
  node - "${manifest_file}" <<'NODE'
const fs = require("fs");
const manifest = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const l1 = manifest.runtime && manifest.runtime.l1 && typeof manifest.runtime.l1 === "object"
  ? manifest.runtime.l1
  : {};
const values = [
  String(manifest.status || ""),
  Number.isInteger(Number(l1.pid)) && Number(l1.pid) > 0 ? String(Number(l1.pid)) : "",
  Number.isInteger(Number(l1.processGroupId)) && Number(l1.processGroupId) > 0
    ? String(Number(l1.processGroupId))
    : "",
];
process.stdout.write(values.join("\0"));
process.stdout.write("\0");
NODE
)

current_status="${manifest_fields[0]:-}"
l1_pid="${manifest_fields[1]:-}"
l1_process_group_id="${manifest_fields[2]:-}"
if [ -z "${l1_pid}" ] && [ -f "${l1_pid_file}" ]; then
  l1_pid="$(tr -d '[:space:]' < "${l1_pid_file}")"
fi

terminate_l1_process() {
  local pid="$1"
  local process_group_id="$2"
  local use_process_group="false"
  if [ -z "${pid}" ]; then
    return 1
  fi
  if [[ "${process_group_id}" =~ ^[1-9][0-9]*$ ]] \
    && kill -0 -- "-${process_group_id}" 2>/dev/null; then
    use_process_group="true"
    kill -TERM -- "-${process_group_id}" 2>/dev/null || true
  elif kill -0 "${pid}" 2>/dev/null; then
    kill -TERM "${pid}" 2>/dev/null || true
  else
    return 1
  fi

  for _ in $(seq 1 30); do
    if [ "${use_process_group}" = "true" ]; then
      if ! kill -0 -- "-${process_group_id}" 2>/dev/null; then
        return 0
      fi
    elif ! kill -0 "${pid}" 2>/dev/null; then
      return 0
    fi
    sleep 0.1
  done

  if [ "${use_process_group}" = "true" ]; then
    kill -KILL -- "-${process_group_id}" 2>/dev/null || true
  else
    kill -KILL "${pid}" 2>/dev/null || true
  fi
  return 0
}

mkdir -p "${run_dir}"
: > "${stop_request_file}"
had_live_pid="false"
if terminate_l1_process "${l1_pid}" "${l1_process_group_id}"; then
  had_live_pid="true"
fi
rm -f "${l1_pid_file}"

node - "${manifest_file}" "${current_status}" "${had_live_pid}" <<'NODE'
const fs = require("fs");
const manifestFile = process.argv[2];
const currentStatus = String(process.argv[3] || "").trim().toLowerCase();
const hadLivePid = process.argv[4] === "true";
const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
const preserveTerminalStatus = !hadLivePid
  && (currentStatus === "success" || currentStatus === "error" || currentStatus === "stopped");
if (!preserveTerminalStatus) {
  manifest.status = "stopped";
  manifest.currentPhase = "stopped";
  manifest.exitCode = 130;
  manifest.signal = "SIGTERM";
  manifest.stopReason = "stop requested";
  manifest.completedAt = new Date().toISOString();
}
manifest.updatedAt = new Date().toISOString();
manifest.runtime = manifest.runtime || {};
manifest.runtime.l1 = manifest.runtime.l1 || {};
manifest.runtime.l1.pid = null;
manifest.runtime.l1.processGroupId = null;
if (manifest.phases && !preserveTerminalStatus) {
  for (const key of Object.keys(manifest.phases)) {
    if (manifest.phases[key] === "created" || manifest.phases[key] === "pending" || manifest.phases[key] === "running") {
      manifest.phases[key] = "stopped";
    }
  }
}
fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
NODE

node - "${result_file}" "${manifest_file}" "${l1_pid}" <<'NODE'
const fs = require("fs");
const [resultFile, manifestFile, pidRaw] = process.argv.slice(2);
const pid = Number(pidRaw);
fs.writeFileSync(resultFile, `${JSON.stringify({
  details: {
    stopped: true,
    pid: Number.isInteger(pid) && pid > 0 ? pid : null,
    manifest: manifestFile,
  },
})}\n`);
NODE
