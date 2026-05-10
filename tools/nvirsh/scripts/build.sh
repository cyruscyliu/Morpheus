#!/usr/bin/env bash
set -euo pipefail

source_dir="${MORPHEUS_NVIRSH_SOURCE:?}"
build_dir="${MORPHEUS_NVIRSH_BUILD_DIR:?}"
install_dir="${MORPHEUS_NVIRSH_INSTALL_DIR:?}"
profile_name="${MORPHEUS_NVIRSH_BUILD_VERSION:-default}"
build_dir_key="${MORPHEUS_NVIRSH_BUILD_DIR_KEY:-${profile_name}}"
result_file="${MORPHEUS_NVIRSH_RESULT_FILE:-${MORPHEUS_SCRIPT_RESULT_FILE:?}}"
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
log_file="${build_dir}/build.log"
profile_file="${source_dir}/profile.json"
state_file="${install_dir}/state.json"
build_l0_dir="${build_dir}/l0"
build_l1_dir="${build_dir}/l1"

rm -rf "${install_dir}/plan" "${build_l0_dir}" "${build_l1_dir}"
mkdir -p "${build_dir}" "${install_dir}" "${build_l0_dir}" "${build_l1_dir}"
: > "${log_file}"

if [ ! -f "${profile_file}" ]; then
  echo "missing fetched profile source: ${profile_file}" >&2
  exit 1
fi

run_profile_script() {
  local field="$1"
  local script_rel
  script_rel="$(node -e 'const fs=require("fs"); const file=process.argv[1]; const dotted=process.argv[2]; const obj=JSON.parse(fs.readFileSync(file,"utf8")); const parts=dotted.split("."); let cur=obj; for (const part of parts) { if (!cur || typeof cur !== "object" || !(part in cur)) { process.exit(0); } cur=cur[part]; } if (typeof cur === "string") process.stdout.write(cur);' "${profile_file}" "${field}")"
  if [ -z "${script_rel}" ]; then
    return 0
  fi
  if [[ "${script_rel}" = /* ]]; then
    script_path="${script_rel}"
  else
    script_path="${script_dir}/${script_rel}"
  fi
  if [ ! -x "${script_path}" ]; then
    echo "missing nvirsh provision script: ${script_path}" >&2
    exit 1
  fi
  MORPHEUS_NVIRSH_PROFILE_FILE="${profile_file}" \
  MORPHEUS_NVIRSH_RUN_DIR="${build_dir}" \
  MORPHEUS_NVIRSH_INSTALL_DIR="${install_dir}" \
  MORPHEUS_NVIRSH_SOURCE="${source_dir}" \
  MORPHEUS_NVIRSH_PROFILE_NAME="${profile_name}" \
  MORPHEUS_NVIRSH_PHASE="build" \
  MORPHEUS_NVIRSH_LOG_FILE="${log_file}" \
  "${script_path}" >> "${log_file}" 2>&1
}

run_profile_script "l0.provisionScript"
MORPHEUS_NVIRSH_RUN_DIR="${build_dir}" \
run_profile_script "l1.provisionScript"

node - "${profile_file}" "${state_file}" "${source_dir}" "${build_dir}" "${install_dir}" "${profile_name}" "${build_dir_key}" <<'NODE'
const fs = require("fs");
const path = require("path");
const [profileFile, stateFile, sourceDir, buildDir, installDir, profileName, buildDirKey] = process.argv.slice(2);
const profile = JSON.parse(fs.readFileSync(profileFile, "utf8"));
const state = {
  schemaVersion: 1,
  tool: "nvirsh",
  profile: profileName,
  profileData: profile,
  buildVersion: profileName,
  buildDirKey,
  source: sourceDir,
  buildDir,
  installDir,
  status: "prepared",
  currentPhase: "prepared",
  runtime: { pid: null },
  layeredState: {
    l0: {
      status: "prepared",
      hostName: profile.l0 && profile.l0.hostName ? profile.l0.hostName : null,
      workspace: profile.l0 && profile.l0.workspace ? profile.l0.workspace : null,
    },
    l1: {
      status: "prepared",
      launcher: profile.l1 && profile.l1.launcher ? profile.l1.launcher : null,
      launcherArgs: profile.l1 && Array.isArray(profile.l1.launcherArgs) ? profile.l1.launcherArgs : [],
      sshPort: profile.l1 && profile.l1.sshPort ? profile.l1.sshPort : null,
      memoryMb: profile.l1 && profile.l1.memoryMb ? profile.l1.memoryMb : null,
      cpus: profile.l1 && profile.l1.cpus ? profile.l1.cpus : null,
      workspace: profile.l0 && profile.l0.workspace ? profile.l0.workspace : null,
    },
    l2: {
      status: "pending",
      launcher: profile.l2 && profile.l2.launcher ? profile.l2.launcher : null,
      launcherArgs: profile.l2 && Array.isArray(profile.l2.launcherArgs) ? profile.l2.launcherArgs : [],
      kernel: profile.l2 && profile.l2.kernel ? profile.l2.kernel : null,
      initrd: profile.l2 && profile.l2.initrd ? profile.l2.initrd : null
    }
  },
  phases: {
    build: "success",
    launch: "pending"
  },
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
};
fs.writeFileSync(stateFile, `${JSON.stringify(state, null, 2)}\n`);
fs.writeFileSync(path.join(installDir, "profile.json"), `${JSON.stringify(profile, null, 2)}\n`);
fs.writeFileSync(path.join(installDir, "l0-provision.json"), `${JSON.stringify(profile.l0 || {}, null, 2)}\n`);
fs.writeFileSync(path.join(installDir, "l1-provision.json"), `${JSON.stringify({
  ...((profile.l1 && typeof profile.l1 === "object") ? profile.l1 : {}),
  workspace: profile.l0 && profile.l0.workspace ? profile.l0.workspace : null,
}, null, 2)}\n`);
NODE

cat > "${result_file}" <<EOF
{"details":{"source":"${source_dir}","build_dir":"${build_dir}","install_dir":"${install_dir}","state_file":"${state_file}","profile":"${profile_name}","reused":false}}
EOF

printf '[nvirsh] prepared l0/l1 state for %s\n' "${profile_name}" >> "${log_file}"
