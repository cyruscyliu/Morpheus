#!/usr/bin/env bash
set -euo pipefail

source_dir="${MORPHEUS_NVIRSH_SOURCE:?}"
run_dir="${MORPHEUS_NVIRSH_RUN_DIR:?}"
install_dir="${MORPHEUS_NVIRSH_INSTALL_DIR:?}"
profile_name="${MORPHEUS_NVIRSH_BUILD_VERSION:-default}"
build_dir_key="${MORPHEUS_NVIRSH_BUILD_DIR_KEY:-${profile_name}}"
phase="${MORPHEUS_NVIRSH_PHASE:?}"
result_file="${MORPHEUS_NVIRSH_RESULT_FILE:-${MORPHEUS_SCRIPT_RESULT_FILE:?}}"
profile_file="${source_dir}/profile.json"
state_file="${install_dir}/state.json"
build_dir="${install_dir}/../build"
attach_mode="${MORPHEUS_STEP_ATTACH:-false}"
runtime_pid="${MORPHEUS_NVIRSH_L2_PID:-$$}"
step_log_file="${MORPHEUS_SCRIPT_LOG_FILE:-${MORPHEUS_NVIRSH_LOG_FILE:-${run_dir}/stdout.log}}"
step_log_dir="$(dirname "${step_log_file}")"
build_l0_dir="${build_dir}/l0"
l1_boot_log="${build_l0_dir}/l1-boot.log"
l1_provision_log="${build_l0_dir}/l1-provision.log"
l2_boot_log="${step_log_dir}/l2-boot.log"

mkdir -p "${run_dir}"
: > "${run_dir}/stdout.log"
mkdir -p "${step_log_dir}"

copy_boot_logs() {
  if [ -f "${l1_boot_log}" ]; then
    cp -f "${l1_boot_log}" "${step_log_dir}/l1-boot.log"
  fi
  if [ -f "${l1_provision_log}" ]; then
    cp -f "${l1_provision_log}" "${step_log_dir}/l1-provision.log"
  fi
}

if [ "${phase}" != "launch" ]; then
  echo "unsupported nvirsh exec phase: ${phase}" >&2
  exit 1
fi
if [ ! -f "${state_file}" ]; then
  echo "missing prepared nvirsh state: ${state_file}" >&2
  exit 1
fi

ssh_key="${build_dir}/l0/id_ed25519"
if [ ! -f "${ssh_key}" ]; then
  echo "missing ssh key for l1 access: ${ssh_key}" >&2
  exit 1
fi

launch_script="${build_dir}/l1/launch-l2.sh"
if [ ! -f "${launch_script}" ]; then
  echo "missing prepared l2 launch script: ${launch_script}" >&2
  exit 1
fi

ssh_base=(
  ssh
  -i "${ssh_key}"
  -o StrictHostKeyChecking=no
  -o UserKnownHostsFile=/dev/null
  -p 2222
  root@127.0.0.1
)

launch_cmd="bash -lc $(printf '%q' "/root/launch-l2.sh")"
printf '[nvirsh] exec launching l2 from l1\n' >> "${run_dir}/stdout.log"
"${ssh_base[@]}" "test -x /root/launch-l2.sh" >> "${run_dir}/stdout.log" 2>&1
copy_boot_logs

if [ "${attach_mode}" = "true" ]; then
  "${ssh_base[@]}" -tt "${launch_cmd}" | tee -a "${run_dir}/stdout.log" | tee -a "${l2_boot_log}"
else
  "${ssh_base[@]}" -tt "${launch_cmd}" | tee -a "${run_dir}/stdout.log" | tee -a "${l2_boot_log}" >/dev/null
fi
copy_boot_logs

node - "${state_file}" "${profile_file}" "${run_dir}/manifest.json" "${source_dir}" "${run_dir}" "${install_dir}" "${profile_name}" "${build_dir_key}" <<'NODE'
const fs = require("fs");
const path = require("path");
const [stateFile, profileFile, manifestFile, sourceDir, runDir, installDir, profileName, buildDirKey] = process.argv.slice(2);
const state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
const profile = JSON.parse(fs.readFileSync(profileFile, "utf8"));
const now = new Date().toISOString();
const manifest = {
  schemaVersion: 1,
  tool: "nvirsh",
  profile: profileName,
  buildVersion: profileName,
  buildDirKey,
  source: sourceDir,
  buildDir: state.buildDir,
  installDir,
  runDir,
  logFile: `${runDir}/stdout.log`,
  currentPhase: "launch",
  status: "success",
  runtime: state.runtime || null,
  layeredState: {
    ...state.layeredState,
    l2: {
      status: "running",
      launcher: profile.l2 && profile.l2.launcher ? profile.l2.launcher : null,
      launcherArgs: profile.l2 && Array.isArray(profile.l2.launcherArgs) ? profile.l2.launcherArgs : [],
      kernel: profile.l2 && profile.l2.kernel ? profile.l2.kernel : null,
      initrd: profile.l2 && profile.l2.initrd ? profile.l2.initrd : null,
      bootLog: path.join(path.dirname(process.env.MORPHEUS_SCRIPT_LOG_FILE || `${runDir}/stdout.log`), "l2-boot.log"),
    }
  },
  phases: {
    ...state.phases,
    launch: "success"
  },
  phaseHistory: [{ phase: "launch", at: now }],
  createdAt: now,
  updatedAt: now
};
fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
NODE

cat > "${result_file}" <<EOF
{"details":{"run_dir":"${run_dir}","log_file":"${run_dir}/stdout.log","manifest":"${run_dir}/manifest.json","phase":"${phase}","profile":"${profile_name}","pid":${runtime_pid}}}
EOF
