#!/usr/bin/env bash
set -euo pipefail

source_dir="${MORPHEUS_NVIRSH_SOURCE:?}"
build_dir="${MORPHEUS_NVIRSH_BUILD_DIR:?}"
install_dir="${MORPHEUS_NVIRSH_INSTALL_DIR:?}"
profile_name="${MORPHEUS_NVIRSH_BUILD_VERSION:-default}"
build_dir_key="${MORPHEUS_NVIRSH_BUILD_DIR_KEY:-${profile_name}}"
result_file="${MORPHEUS_NVIRSH_RESULT_FILE:-${MORPHEUS_SCRIPT_RESULT_FILE:?}}"
qemu="${MORPHEUS_NVIRSH_QEMU:?}"
firmware="${MORPHEUS_NVIRSH_FIRMWARE:?}"
buildroot_output_dir="${MORPHEUS_NVIRSH_BUILDROOT_OUTPUT_DIR:?}"
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
profile_file="${source_dir}/profile.json"
state_file="${install_dir}/state.json"
build_l0_dir="${build_dir}/l0"
build_l1_dir="${build_dir}/l1"
l1_console_log="${install_dir}/l1-console.log"

if [ -f "${build_l0_dir}/l1.pid" ]; then
  old_pid="$(cat "${build_l0_dir}/l1.pid" 2>/dev/null || true)"
  if [ -n "${old_pid}" ]; then
    kill "${old_pid}" 2>/dev/null || true
  fi
fi
rm -rf "${install_dir}/plan" "${build_l0_dir}" "${build_l1_dir}"
mkdir -p "${build_dir}" "${install_dir}" "${build_l0_dir}" "${build_l1_dir}"
: > "${l1_console_log}"

if [ ! -f "${profile_file}" ]; then
  echo "missing fetched profile source: ${profile_file}" >&2
  exit 1
fi

profile_arg_value() {
  local layer="$1"
  local key="$2"
  node - "${profile_file}" "${layer}" "${key}" <<'NODE'
const fs = require("fs");
const [profileFile, layer, key] = process.argv.slice(2);
const profile = JSON.parse(fs.readFileSync(profileFile, "utf8"));
const args = Array.isArray(profile[layer] && profile[layer].launcherArgs)
  ? profile[layer].launcherArgs
  : [];
for (let index = 0; index < args.length - 1; index += 1) {
  if (args[index] === key) {
    process.stdout.write(String(args[index + 1]));
    process.exit(0);
  }
}
NODE
}

generate_ssh_key() {
  local keyfile="${build_l0_dir}/id_ed25519"
  if [ ! -f "${keyfile}" ]; then
    ssh-keygen -q -t ed25519 -N '' -f "${keyfile}" >/dev/null
  fi
  cat "${keyfile}.pub"
}

wait_for_ssh() {
  local keyfile="$1"
  local port="$2"
  local qemu_pid="$3"
  local deadline=$((SECONDS + 600))
  while [ "${SECONDS}" -lt "${deadline}" ]; do
    if [ -n "${qemu_pid}" ] && ! kill -0 "${qemu_pid}" 2>/dev/null; then
      echo "l1 qemu exited before SSH became available" >&2
      return 1
    fi
    if ssh -i "${keyfile}" -o BatchMode=yes -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=5 -p "${port}" root@127.0.0.1 true >/dev/null 2>&1; then
      return 0
    fi
    sleep 2
  done
  echo "timed out waiting for l1 SSH" >&2
  return 1
}

ssh_guest() {
  local keyfile="$1"
  local port="$2"
  shift 2
  ssh \
    -i "${keyfile}" \
    -o BatchMode=yes \
    -o StrictHostKeyChecking=no \
    -o UserKnownHostsFile=/dev/null \
    -o ConnectTimeout=5 \
    -p "${port}" \
    root@127.0.0.1 \
    "$@"
}

wait_for_guest_command() {
  local keyfile="$1"
  local port="$2"
  local qemu_pid="$3"
  shift 3
  local deadline=$((SECONDS + 600))
  while [ "${SECONDS}" -lt "${deadline}" ]; do
    if [ -n "${qemu_pid}" ] && ! kill -0 "${qemu_pid}" 2>/dev/null; then
      echo "l1 qemu exited before guest became ready" >&2
      return 1
    fi
    if ssh_guest "${keyfile}" "${port}" "$@" >/dev/null 2>&1; then
      return 0
    fi
    sleep 2
  done
  echo "timed out waiting for guest command: $*" >&2
  return 1
}

copy_to_guest() {
  local keyfile="$1"
  local port="$2"
  local src="$3"
  local dst="$4"
  local attempts=0
  while [ "${attempts}" -lt 10 ]; do
    if scp \
      -i "${keyfile}" \
      -o BatchMode=yes \
      -o StrictHostKeyChecking=no \
      -o UserKnownHostsFile=/dev/null \
      -o ConnectTimeout=5 \
      -O \
      -P "${port}" \
      "${src}" \
      "root@127.0.0.1:${dst}" >/dev/null; then
      return 0
    fi
    attempts=$((attempts + 1))
    sleep 2
  done
  echo "failed to copy ${src} to guest:${dst}" >&2
  return 1
}

run_in_guest() {
  local keyfile="$1"
  local port="$2"
  local script="$3"
  ssh_guest "${keyfile}" "${port}" "bash -s" < "${script}"
}

ssh_public_key="$(generate_ssh_key)"
export MORPHEUS_NVIRSH_SSH_PUBLIC_KEY="${ssh_public_key}"

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
  "${script_path}"
}

run_profile_script "l0.provisionScript"
run_profile_script "l1.provisionScript"

guest_image_dir="/root/nvirsh-images"
guest_launch="/root/launch-l2.sh"
base_image_path="${build_l0_dir}/base-image.qcow2"
overlay_image_path="${build_l0_dir}/overlay.qcow2"
seed_image_path="${build_l0_dir}/seed.img"
qemu_pid_file="${build_l0_dir}/l1.pid"
l1_cpu="$(profile_arg_value l1 -cpu)"
l1_memory="$(profile_arg_value l1 -m)"
l1_cpus="$(profile_arg_value l1 -smp)"
l1_ssh_port="$(node -e 'const fs=require("fs"); const p=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(String((p.l1 && p.l1.sshPort) || 2222));' "${profile_file}")"
l2_cpu="$(profile_arg_value l2 -cpu)"
l2_memory="$(profile_arg_value l2 -m)"
l2_memory="${l2_memory:-1024}"

cat > "${build_l1_dir}/launch-l2.sh" <<EOF
#!/usr/bin/env bash
set -euo pipefail
guest_qemu="/usr/bin/qemu-system-aarch64"
if [ ! -x "\${guest_qemu}" ]; then
  echo "missing qemu-system-aarch64 in l1" >&2
  exit 1
fi
exec "\${guest_qemu}" \
  -machine virt,virtualization=on,gic-version=3 \
  -cpu "${l2_cpu}" \
  -m "${l2_memory}" \
  -nographic \
  -kernel "${guest_image_dir}/Image" \
  -initrd "${guest_image_dir}/rootfs.cpio.gz" \
  -append "console=ttyAMA0 rdinit=/bin/sh"
EOF
chmod +x "${build_l1_dir}/launch-l2.sh"

cat > "${build_l1_dir}/provision-l1.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
if [ -x /root/install-dependencies.sh ]; then
  bash /root/install-dependencies.sh
fi
if [ ! -x /usr/bin/qemu-system-aarch64 ]; then
  sudo apt-get install -y qemu-system-arm
fi
mkdir -p /root/nvirsh-images
chmod 0755 /root/launch-l2.sh
EOF
chmod +x "${build_l1_dir}/provision-l1.sh"

"${qemu}" \
  -machine virt,virtualization=on,gic-version=3 \
  -cpu "${l1_cpu}" \
  -m "${l1_memory}" \
  -smp "${l1_cpus}" \
  -nographic \
  -bios "${firmware}" \
  -drive file="${overlay_image_path}",if=virtio,format=qcow2 \
  -drive file="${seed_image_path}",if=virtio,format=raw \
  -netdev user,id=net0,hostfwd=tcp::${l1_ssh_port}-:22 \
  -device virtio-net-pci,netdev=net0 \
  >> "${l1_console_log}" 2>&1 < /dev/null &
qemu_pid="$!"
echo "${qemu_pid}" > "${qemu_pid_file}"

if ! wait_for_ssh "${build_l0_dir}/id_ed25519" "${l1_ssh_port}" "${qemu_pid}"; then
  exit 1
fi

wait_for_guest_command "${build_l0_dir}/id_ed25519" "${l1_ssh_port}" "${qemu_pid}" "cloud-init status --wait"

copy_to_guest "${build_l0_dir}/id_ed25519" "${l1_ssh_port}" "${build_l1_dir}/install-dependencies.sh" "/root/install-dependencies.sh"
copy_to_guest "${build_l0_dir}/id_ed25519" "${l1_ssh_port}" "${build_l1_dir}/launch-l2.sh" "${guest_launch}"
ssh_guest "${build_l0_dir}/id_ed25519" "${l1_ssh_port}" "mkdir -p ${guest_image_dir}"
copy_to_guest "${build_l0_dir}/id_ed25519" "${l1_ssh_port}" "${buildroot_output_dir}/Image" "${guest_image_dir}/Image"
copy_to_guest "${build_l0_dir}/id_ed25519" "${l1_ssh_port}" "${buildroot_output_dir}/rootfs.cpio.gz" "${guest_image_dir}/rootfs.cpio.gz"

run_in_guest "${build_l0_dir}/id_ed25519" "${l1_ssh_port}" "${build_l1_dir}/provision-l1.sh"

node - "${profile_file}" "${state_file}" "${source_dir}" "${build_dir}" "${install_dir}" "${profile_name}" "${build_dir_key}" <<'NODE'
const fs = require("fs");
const path = require("path");
const [profileFile, stateFile, sourceDir, buildDir, installDir, profileName, buildDirKey] = process.argv.slice(2);
const profile = JSON.parse(fs.readFileSync(profileFile, "utf8"));
const l0 = profile.l0 || {};
const l1 = profile.l1 || {};
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
  runtime: {
    pid: Number(fs.readFileSync(path.join(buildDir, "l0", "l1.pid"), "utf8").trim() || 0),
    l1: {
      host: "127.0.0.1",
      port: 2222,
      user: "root",
    },
  },
  layeredState: {
    l0: {
      status: "running",
      hostName: l0.hostName || null,
      workspace: l0.workspace || null,
      image: l0.image || null,
      bootLog: path.join(installDir, "l1-console.log"),
    },
    l1: {
      status: "prepared",
      launcher: l1.launcher || null,
      launcherArgs: Array.isArray(l1.launcherArgs) ? l1.launcherArgs : [],
      sshPort: l1.sshPort || null,
      memoryMb: l1.memoryMb || null,
      cpus: l1.cpus || null,
      workspace: l0.workspace || null,
      provisionLog: null,
      launchScript: path.join(buildDir, "l1", "launch-l2.sh"),
    },
    l2: {
      status: "prepared",
      launcher: profile.l2 && profile.l2.launcher ? profile.l2.launcher : null,
      launcherArgs: profile.l2 && Array.isArray(profile.l2.launcherArgs) ? profile.l2.launcherArgs : [],
      kernel: profile.l2 && profile.l2.kernel ? profile.l2.kernel : null,
      initrd: profile.l2 && profile.l2.initrd ? profile.l2.initrd : null,
      bootLog: null,
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
  workspace: l0.workspace || null,
}, null, 2)}\n`);
NODE

cat > "${result_file}" <<EOF
{"details":{"source":"${source_dir}","build_dir":"${build_dir}","install_dir":"${install_dir}","state_file":"${state_file}","profile":"${profile_name}","reused":false}}
EOF

printf '[nvirsh] prepared l1 runtime and l2 launch script for %s\n' "${profile_name}" >> "${log_file}"
