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

mkdir -p "${run_dir}"

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
printf '[nvirsh] exec launching l2 from l1\n'
"${ssh_base[@]}" "test -x /root/launch-l2.sh"

if [ "${attach_mode}" = "true" ]; then
  "${ssh_base[@]}" -tt "${launch_cmd}"
else
  "${ssh_base[@]}" -tt "${launch_cmd}"
fi

node - "${state_file}" "${profile_file}" "${run_dir}/manifest.json" "${source_dir}" "${run_dir}" "${install_dir}" "${profile_name}" "${build_dir_key}" <<'NODE'
const fs = require("fs");
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
      bootLog: null,
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
