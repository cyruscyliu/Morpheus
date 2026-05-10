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
log_file="${run_dir}/stdout.log"
manifest_file="${run_dir}/manifest.json"
state_file="${install_dir}/state.json"
attach_mode="${MORPHEUS_STEP_ATTACH:-false}"
export MORPHEUS_NVIRSH_L2_PID="$$"
runtime_pid="${MORPHEUS_NVIRSH_L2_PID}"

mkdir -p "${run_dir}"
: > "${log_file}"

if [ "${phase}" != "launch" ]; then
  echo "unsupported nvirsh exec phase: ${phase}" >&2
  exit 1
fi

if [ ! -f "${state_file}" ]; then
  echo "missing prepared nvirsh state: ${state_file}" >&2
  exit 1
fi
if [ ! -f "${profile_file}" ]; then
  echo "missing nvirsh profile: ${profile_file}" >&2
  exit 1
fi

node - "${state_file}" "${profile_file}" "${manifest_file}" "${source_dir}" "${run_dir}" "${install_dir}" "${profile_name}" "${build_dir_key}" <<'NODE'
const fs = require("fs");
const [stateFile, profileFile, manifestFile, sourceDir, runDir, installDir, profileName, buildDirKey] = process.argv.slice(2);
const state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
const profile = JSON.parse(fs.readFileSync(profileFile, "utf8"));
const now = new Date().toISOString();
const runtimePid = Number(process.env.MORPHEUS_NVIRSH_L2_PID || process.pid);
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
  status: "running",
  runtime: { pid: runtimePid },
  layeredState: {
    ...state.layeredState,
    l2: {
      status: "running",
      launcher: profile.l2 && profile.l2.launcher ? profile.l2.launcher : null,
      launcherArgs: profile.l2 && Array.isArray(profile.l2.launcherArgs) ? profile.l2.launcherArgs : [],
      kernel: profile.l2 && profile.l2.kernel ? profile.l2.kernel : null,
      initrd: profile.l2 && profile.l2.initrd ? profile.l2.initrd : null
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
{"details":{"run_dir":"${run_dir}","log_file":"${log_file}","manifest":"${manifest_file}","phase":"${phase}","profile":"${profile_name}","pid":${runtime_pid}}}
EOF

printf '[nvirsh] launched l2 for %s\n' "${profile_name}" >> "${log_file}"

if [ "${attach_mode}" = "true" ]; then
  export PS1='l2$ '
  printf 'l2 shell spawned\n'
  exec bash --noprofile --norc -i
fi
