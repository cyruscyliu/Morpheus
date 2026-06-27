#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/../../_shared/scripts/parallelism.sh"

source_dir="${MORPHEUS_NVIRSH_SOURCE:?}"
build_dir="${MORPHEUS_NVIRSH_BUILD_DIR:?}"
install_dir="${MORPHEUS_NVIRSH_INSTALL_DIR:?}"
profile_name="${MORPHEUS_NVIRSH_BUILD_VERSION:-default}"
build_dir_key="${MORPHEUS_NVIRSH_BUILD_DIR_KEY:-${profile_name}}"
result_file="${MORPHEUS_NVIRSH_RESULT_FILE:-${MORPHEUS_SCRIPT_RESULT_FILE:?}}"
qemu="${MORPHEUS_NVIRSH_QEMU:?}"
firmware="${MORPHEUS_NVIRSH_FIRMWARE:?}"
buildroot_output_dir="${MORPHEUS_NVIRSH_BUILDROOT_OUTPUT_DIR:?}"
buildroot_images_dir="${buildroot_output_dir}/images"
guest_stub_src="${MORPHEUS_NVIRSH_GUEST_STUB:-}"
guest_qemu_source="${MORPHEUS_NVIRSH_GUEST_QEMU_SOURCE:-}"
guest_nqc2_plugin="${MORPHEUS_NVIRSH_GUEST_NQC2_PLUGIN:-}"
reuse_build_dir="${MORPHEUS_NVIRSH_REUSE_BUILD_DIR:-false}"
guest_jobs="${MORPHEUS_NVIRSH_GUEST_JOBS:-$(morpheus_default_jobs)}"
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
profile_file="${source_dir}/profile.json"
state_file="${install_dir}/state.json"
build_l0_dir="${build_dir}/l0"
build_l1_dir="${build_dir}/l1"
build_l1_host_boot_dir="${build_l1_dir}/host-boot"
provisioned_overlay_image="${build_l0_dir}/l1-provisioned.qcow2"
l1_console_log="${install_dir}/l1-console.log"
qemu_pid=""
qemu_pid_file=""
l1_ssh_port=""
guest_qemu_sync_files=(
  "configure"
  "hw/intc/arm_gicv3_common.c"
  "hw/intc/arm_gicv3_cpuif.c"
  "hw/intc/trace-events"
  "hw/virtio/trace-events"
  "hw/virtio/virtio-mmio.c"
  "include/hw/intc/arm_gicv3_common.h"
  "target/arm/helper.c"
  "target/arm/tcg/helper-a64.c"
  "target/arm/trace-events"
)

if ! [[ "${guest_jobs}" =~ ^[0-9]+$ ]] || [ "${guest_jobs}" -lt 1 ]; then
  guest_jobs=1
fi

shutdown_l1() {
  local pid="${qemu_pid:-}"
  [ -n "${pid}" ] || return 0
  if ! kill -0 "${pid}" 2>/dev/null; then
    qemu_pid=""
    return 0
  fi

  set +e
  if [ -n "${l1_ssh_port:-}" ] && [ -f "${build_l0_dir}/id_ed25519" ]; then
    ssh_guest "${build_l0_dir}/id_ed25519" "${l1_ssh_port}" "sync" >/dev/null 2>&1
    ssh_guest "${build_l0_dir}/id_ed25519" "${l1_ssh_port}" "systemctl poweroff" >/dev/null 2>&1
    for _ in $(seq 1 60); do
      if ! kill -0 "${pid}" 2>/dev/null; then
        break
      fi
      sleep 1
    done
  fi
  kill "${pid}" 2>/dev/null || true
  wait "${pid}" 2>/dev/null || true
  qemu_pid=""
  set -e
}

trap shutdown_l1 EXIT INT TERM

state_matches_build() {
  local state_path="$1"
  node - "${state_path}" "${profile_name}" "${build_dir_key}" "${source_dir}" "${build_dir}" "${install_dir}" "${guest_stub_src}" "${guest_qemu_source}" "${guest_nqc2_plugin}" "${buildroot_output_dir}" "${BASH_SOURCE[0]}" "${guest_qemu_sync_files[@]}" <<'NODE'
const crypto = require("crypto");
const fs = require("fs");
const [
  statePath,
  profileName,
  buildDirKey,
  sourceDir,
  buildDir,
  installDir,
  guestStub,
  guestQemuSource,
  guestNqc2Plugin,
  buildrootOutputDir,
  scriptPath,
  ...guestQemuSyncFiles
] = process.argv.slice(2);
function sha256File(path) {
  return crypto.createHash("sha256").update(fs.readFileSync(path)).digest("hex");
}
function sha256GuestQemuSyncFiles(sourceDir, files) {
  if (!sourceDir) {
    return "";
  }
  const hash = crypto.createHash("sha256");
  for (const file of files) {
    const path = `${sourceDir}/${file}`;
    hash.update(file);
    hash.update("\0");
    hash.update(fs.readFileSync(path));
    hash.update("\0");
  }
  return hash.digest("hex");
}
try {
  const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
  const recordedStub = state.layeredState
    && state.layeredState.l1
    && state.layeredState.l1.guestStubSource
      ? state.layeredState.l1.guestStubSource
      : "";
  const recordedQemu = state.layeredState
    && state.layeredState.l1
    && state.layeredState.l1.guestQemuSource
      ? state.layeredState.l1.guestQemuSource
      : "";
  const recordedNqc2Plugin = state.layeredState
    && state.layeredState.l1
    && state.layeredState.l1.guestNqc2Plugin
      ? state.layeredState.l1.guestNqc2Plugin
      : "";
  const recordedStubSha256 = state.layeredState
    && state.layeredState.l1
    && state.layeredState.l1.guestStubSha256
      ? state.layeredState.l1.guestStubSha256
      : "";
  const currentStubSha256 = guestStub
    ? sha256File(guestStub)
    : "";
  const currentScriptSha256 = sha256File(scriptPath);
  const recordedScriptSha256 = state.layeredState
    && state.layeredState.l1
    && state.layeredState.l1.nvirshBuildScriptSha256
      ? state.layeredState.l1.nvirshBuildScriptSha256
      : "";
  const currentGuestQemuSourceSha256 = sha256GuestQemuSyncFiles(
    guestQemuSource,
    guestQemuSyncFiles,
  );
  const recordedGuestQemuSourceSha256 = state.layeredState
    && state.layeredState.l1
    && state.layeredState.l1.guestQemuSourceSha256
      ? state.layeredState.l1.guestQemuSourceSha256
      : "";
  const imagePath = `${buildrootOutputDir}/images/Image`;
  const initrdPath = `${buildrootOutputDir}/images/rootfs.cpio.gz`;
  const currentBuildrootImages =
    fs.existsSync(imagePath) && fs.existsSync(initrdPath)
      ? {
          imageSha256: sha256File(imagePath),
          initrdSha256: sha256File(initrdPath),
        }
      : null;
  const recordedBuildrootImages = state.layeredState
    && state.layeredState.l2
    && state.layeredState.l2.buildrootImages
      ? state.layeredState.l2.buildrootImages
      : null;
  const buildrootImagesMatch =
    currentBuildrootImages
    && recordedBuildrootImages
    && recordedBuildrootImages.imageSha256 === currentBuildrootImages.imageSha256
    && recordedBuildrootImages.initrdSha256 === currentBuildrootImages.initrdSha256;
  const statusOk = state.status === "prepared" || state.status === "stopped";
  const phaseOk =
    state.currentPhase === "prepared" || state.currentPhase === "stopped";
  const currentRequestedNqc2Plugin = guestNqc2Plugin || "";
  const nqc2PluginCompatible =
    !currentRequestedNqc2Plugin ||
    recordedNqc2Plugin === currentRequestedNqc2Plugin;
  const matches =
    state
    && state.tool === "nvirsh"
    && state.profile === profileName
    && state.buildDirKey === buildDirKey
    && state.source === sourceDir
    && state.buildDir === buildDir
    && state.installDir === installDir
    && statusOk
    && phaseOk
    && state.phases
    && state.phases.build === "success"
    && recordedStub === (guestStub || "")
    && recordedStubSha256 === currentStubSha256
    && recordedScriptSha256 === currentScriptSha256
    && recordedQemu === (guestQemuSource || "")
    && recordedGuestQemuSourceSha256 === currentGuestQemuSourceSha256
    && nqc2PluginCompatible
    && buildrootImagesMatch;
  process.exit(matches ? 0 : 1);
} catch {
  process.exit(1);
}
NODE
}

state_matches_l1_provision() {
  local state_path="$1"
  node - "${state_path}" "${profile_name}" "${build_dir_key}" "${source_dir}" "${build_dir}" "${install_dir}" "${guest_qemu_source}" "${BASH_SOURCE[0]}" "${guest_qemu_sync_files[@]}" <<'NODE'
const crypto = require("crypto");
const fs = require("fs");
const [
  statePath,
  profileName,
  buildDirKey,
  sourceDir,
  buildDir,
  installDir,
  guestQemuSource,
  scriptPath,
  ...guestQemuSyncFiles
] = process.argv.slice(2);
function sha256File(path) {
  return crypto.createHash("sha256").update(fs.readFileSync(path)).digest("hex");
}
function sha256GuestQemuSyncFiles(sourceDir, files) {
  if (!sourceDir) {
    return "";
  }
  const hash = crypto.createHash("sha256");
  for (const file of files) {
    const path = `${sourceDir}/${file}`;
    hash.update(file);
    hash.update("\0");
    hash.update(fs.readFileSync(path));
    hash.update("\0");
  }
  return hash.digest("hex");
}
try {
  const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
  const statusOk = state.status === "prepared" || state.status === "stopped";
  const phaseOk =
    state.currentPhase === "prepared" || state.currentPhase === "stopped";
  const recordedScriptSha256 = state.layeredState
    && state.layeredState.l1
    && state.layeredState.l1.nvirshBuildScriptSha256
      ? state.layeredState.l1.nvirshBuildScriptSha256
      : "";
  const recordedQemu = state.layeredState
    && state.layeredState.l1
    && state.layeredState.l1.guestQemuSource
      ? state.layeredState.l1.guestQemuSource
      : "";
  const recordedGuestQemuSourceSha256 = state.layeredState
    && state.layeredState.l1
    && state.layeredState.l1.guestQemuSourceSha256
      ? state.layeredState.l1.guestQemuSourceSha256
      : "";
  const currentScriptSha256 = sha256File(scriptPath);
  const currentGuestQemuSourceSha256 = sha256GuestQemuSyncFiles(
    guestQemuSource,
    guestQemuSyncFiles,
  );
  const matches =
    state
    && state.tool === "nvirsh"
    && state.profile === profileName
    && state.buildDirKey === buildDirKey
    && state.source === sourceDir
    && state.buildDir === buildDir
    && state.installDir === installDir
    && statusOk
    && phaseOk
    && state.phases
    && state.phases.build === "success"
    && recordedScriptSha256 === currentScriptSha256
    && recordedQemu === (guestQemuSource || "")
    && recordedGuestQemuSourceSha256 === currentGuestQemuSourceSha256;
  process.exit(matches ? 0 : 1);
} catch {
  process.exit(1);
}
NODE
}

recreate_overlay_from_backing() {
  local backing_image="$1"
  rm -f "${build_l0_dir}/overlay.qcow2"
  qemu-img create \
    -f qcow2 \
    -F qcow2 \
    -b "${backing_image}" \
    "${build_l0_dir}/overlay.qcow2" >/dev/null
}

if [ "${reuse_build_dir}" = "true" ] && [ -f "${state_file}" ]; then
  if state_matches_build "${state_file}" \
    && [ -x "${build_l1_dir}/launch-l2.sh" ] \
    && [ -f "${build_l1_host_boot_dir}/vmlinuz" ] \
    && [ -f "${build_l1_host_boot_dir}/initrd.img" ] \
    && [ -f "${build_l1_host_boot_dir}/cmdline.txt" ] \
    && [ -f "${build_l0_dir}/base-image.qcow2" ] \
    && [ -f "${build_l0_dir}/overlay.qcow2" ] \
    && [ -f "${build_l0_dir}/seed.img" ]; then
    cat > "${result_file}" <<EOF
{"details":{"source":"${source_dir}","build_dir":"${build_dir}","install_dir":"${install_dir}","state_file":"${state_file}","profile":"${profile_name}","reused":true}}
EOF
    printf '[nvirsh] reused prepared build tree for %s\n' "${profile_name}"
    exit 0
  fi
fi

if [ -f "${build_l0_dir}/l1.pid" ]; then
  old_pid="$(cat "${build_l0_dir}/l1.pid" 2>/dev/null || true)"
  if [ -n "${old_pid}" ]; then
    kill "${old_pid}" 2>/dev/null || true
    wait "${old_pid}" 2>/dev/null || true
  fi
  rm -f "${build_l0_dir}/l1.pid"
fi

preserve_l0="false"
reuse_provisioned_l1="false"
if [ "${reuse_build_dir}" = "true" ] \
   && [ -f "${state_file}" ] \
   && [ -f "${provisioned_overlay_image}" ] \
   && [ -f "${build_l0_dir}/base-image.qcow2" ] \
   && [ -f "${build_l0_dir}/seed.img" ] \
   && [ -f "${build_l0_dir}/id_ed25519" ] \
   && [ -f "${build_l1_host_boot_dir}/vmlinuz" ] \
   && [ -f "${build_l1_host_boot_dir}/initrd.img" ] \
   && [ -f "${build_l1_host_boot_dir}/cmdline.txt" ] \
   && state_matches_l1_provision "${state_file}"; then
  preserve_l0="true"
  reuse_provisioned_l1="true"
fi

rm -rf "${install_dir}/plan" "${build_l1_dir}"
mkdir -p "${build_l0_dir}"
if [ "${preserve_l0}" != "true" ]; then
  rm -f \
    "${build_l0_dir}/overlay.qcow2" \
    "${build_l0_dir}/seed.img" \
    "${build_l0_dir}/user-data" \
    "${build_l0_dir}/meta-data" \
    "${build_l0_dir}/provision.json"
fi
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

copy_from_guest() {
  local keyfile="$1"
  local port="$2"
  local src="$3"
  local dst="$4"
  local attempts=0
  mkdir -p "$(dirname "${dst}")"
  while [ "${attempts}" -lt 10 ]; do
    if scp \
      -i "${keyfile}" \
      -o BatchMode=yes \
      -o StrictHostKeyChecking=no \
      -o UserKnownHostsFile=/dev/null \
      -o ConnectTimeout=5 \
      -O \
      -P "${port}" \
      "root@127.0.0.1:${src}" \
      "${dst}" >/dev/null; then
      return 0
    fi
    attempts=$((attempts + 1))
    sleep 2
  done
  echo "failed to copy guest:${src} to ${dst}" >&2
  return 1
}

copy_dir_to_guest() {
  local keyfile="$1"
  local port="$2"
  local src_dir="$3"
  local dst_dir="$4"
  if [ ! -d "${src_dir}" ]; then
    echo "missing source directory for guest copy: ${src_dir}" >&2
    return 1
  fi
  local parent_dir
  local base_name
  local dst_parent
  parent_dir="$(dirname "${src_dir}")"
  base_name="$(basename "${src_dir}")"
  dst_parent="$(dirname "${dst_dir}")"
  find "${src_dir}" -mindepth 1 -printf '%P\0' | tar \
    -C "${src_dir}" \
    --null \
    -T - \
    -czf - | ssh \
    -i "${keyfile}" \
    -o BatchMode=yes \
    -o StrictHostKeyChecking=no \
    -o UserKnownHostsFile=/dev/null \
    -o ConnectTimeout=5 \
    -p "${port}" \
    root@127.0.0.1 \
    "mkdir -p ${dst_dir} && find ${dst_dir} -mindepth 1 -maxdepth 1 ! -name build -exec rm -rf {} + && tar -C ${dst_dir} -xzf -" >/dev/null
  ssh_guest "${keyfile}" "${port}" "test -d ${dst_dir}"
}

copy_qemu_source_to_guest() {
  local keyfile="$1"
  local port="$2"
  local src_dir="$3"
  local dst_dir="$4"
  local source_hash_file="${build_l1_dir}/guest-qemu-source.sha256"

  node - "${src_dir}" "${source_hash_file}" "${guest_qemu_sync_files[@]}" <<'NODE'
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const [sourceDir, outFile, ...files] = process.argv.slice(2);
const hash = crypto.createHash("sha256");
for (const file of files) {
  hash.update(file);
  hash.update("\0");
  hash.update(fs.readFileSync(path.join(sourceDir, file)));
  hash.update("\0");
}
fs.writeFileSync(outFile, `${hash.digest("hex")}\n`);
NODE

  if ssh_guest "${keyfile}" "${port}" "test -f ${dst_dir}/build/build.ninja" >/dev/null 2>&1; then
    tar -C "${src_dir}" -czf - "${guest_qemu_sync_files[@]}" | ssh \
      -i "${keyfile}" \
      -o BatchMode=yes \
      -o StrictHostKeyChecking=no \
      -o UserKnownHostsFile=/dev/null \
      -o ConnectTimeout=5 \
      -p "${port}" \
      root@127.0.0.1 \
      "mkdir -p ${dst_dir} && tar -C ${dst_dir} -xzf -" >/dev/null
    copy_to_guest "${keyfile}" "${port}" "${source_hash_file}" "${dst_dir}/.morpheus-source-v2.sha256"
    return 0
  fi

  copy_dir_to_guest "${keyfile}" "${port}" "${src_dir}" "${dst_dir}"
  copy_to_guest "${keyfile}" "${port}" "${source_hash_file}" "${dst_dir}/.morpheus-source-v2.sha256"
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

if [ "${preserve_l0}" = "true" ]; then
  printf '[nvirsh] reusing provisioned l1 snapshot for %s\n' "${profile_name}"
  recreate_overlay_from_backing "${provisioned_overlay_image}"
else
  run_profile_script "l0.provisionScript"
fi
run_profile_script "l1.provisionScript"

guest_image_dir="/root/nvirsh-images"
guest_launch="/root/launch-l2.sh"
guest_stub="/root/libafl_nesting_stub"
guest_qemu_dir="/root/morpheus-qemu"
guest_qemu_src_dir="/root/morpheus-qemu-src"
guest_nqc2_dir="/root/morpheus-nqc2"
guest_nqc2_plugin_path="/root/morpheus-nqc2/lib/nqc2/nqc2-plugin.so"
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

printf '[nvirsh] guest build jobs=%s (l1-smp=%s)\n' \
  "${guest_jobs}" \
  "${l1_cpus:-unset}"

cat > "${build_l1_dir}/launch-l2.sh" <<EOF
#!/usr/bin/env bash
set -euo pipefail
runtime_dir="\${MORPHEUS_L2_RUNTIME_DIR:-/run/morpheus-libafl}"
mkdir -p "\${runtime_dir}"
launch_marker="\${runtime_dir}/launch-l2.marker"
guest_qemu_trace_events="\${runtime_dir}/morpheus-qemu-trace-events.txt"
printf 'script-start\n' > "\${launch_marker}"
echo "launch-l2 marker: script-start" >&2
guest_qemu="${guest_qemu_dir}/bin/qemu-system-aarch64"
guest_qemu_data_dir="${guest_qemu_dir}/share/qemu"
guest_qemu_data_args=()
guest_nqc2_trace="\${runtime_dir}/morpheus-nqc2.trace"
if [ ! -x "\${guest_qemu}" ]; then
  guest_qemu="/usr/bin/qemu-system-aarch64"
fi
printf 'resolved-qemu=%s\n' "\${guest_qemu}" >> "\${launch_marker}"
if [ ! -d "\${guest_qemu_data_dir}" ] && [ -d "${guest_qemu_src_dir}/pc-bios" ]; then
  guest_qemu_data_dir="${guest_qemu_src_dir}/pc-bios"
elif [ ! -d "\${guest_qemu_data_dir}" ] && [ -d "/usr/share/qemu" ]; then
  guest_qemu_data_dir="/usr/share/qemu"
fi
if [ ! -x "\${guest_qemu}" ]; then
  echo "missing qemu-system-aarch64 in l1" >&2
  exit 1
fi
if [ -d "\${guest_qemu_data_dir}" ]; then
  guest_qemu_data_args=(-L "\${guest_qemu_data_dir}")
fi
printf 'data-dir=%s\n' "\${guest_qemu_data_dir}" >> "\${launch_marker}"
printf 'virtio_mmio_fuzz_read\n' > "\${guest_qemu_trace_events}"
printf 'virtio_mmio_dma_fuzz\n' >> "\${guest_qemu_trace_events}"
printf 'net-transport=virtio-mmio\n' >> "\${launch_marker}"
printf 'trace-events-ready\n' >> "\${launch_marker}"
guest_qemu_plugin_args=()
if [ -f "${guest_nqc2_plugin_path}" ]; then
  printf 'plugin-file=present\n' >> "\${launch_marker}"
  if [ "\${MORPHEUS_L2_DISABLE_NQC2_PLUGIN:-0}" = "1" ]; then
    printf 'plugin-disabled=1\n' >> "\${launch_marker}"
  else
    guest_qemu_plugin_args=(-plugin "${guest_nqc2_plugin_path},trace=\${guest_nqc2_trace}")
    printf 'plugin-disabled=0\n' >> "\${launch_marker}"
  fi
else
  printf 'plugin-file=missing\n' >> "\${launch_marker}"
fi
printf 'plugin-args=%s\n' "\${guest_qemu_plugin_args[*]:-none}" >> "\${launch_marker}"
l2_append="console=ttyAMA0 oops=panic panic_on_warn=1 panic=-1 kasan.fault=panic"
if [ "\${MORPHEUS_L2_ENABLE_ORACLE_TEST_BUG:-0}" = "1" ]; then
  l2_append="\${l2_append} virtio_mmio.hyperarm_oracle_bug=1"
fi
printf 'append=%s\n' "\${l2_append}" >> "\${launch_marker}"
guest_qemu_cmd=(
  "\${guest_qemu}"
  "\${guest_qemu_data_args[@]}"
  -trace "events=\${guest_qemu_trace_events},file=\${runtime_dir}/morpheus-qemu-trace.log"
  "\${guest_qemu_plugin_args[@]}"
  -machine virt,virtualization=on,gic-version=3 \
  -accel tcg \
  -device pvpanic-pci \
  -action panic=exit-failure \
  -cpu "${l2_cpu}" \
  -m "${l2_memory}" \
  -nographic \
  -kernel "${guest_image_dir}/Image" \
  -initrd "${guest_image_dir}/rootfs.cpio.gz" \
  -netdev user,id=net0 \
  -device virtio-net-device,netdev=net0 \
  -append "\${l2_append}"
)
printf 'qemu-cmd=' >> "\${launch_marker}"
printf '%q ' "\${guest_qemu_cmd[@]}" >> "\${launch_marker}"
printf '\n' >> "\${launch_marker}"
printf 'input-path=%s\n' "\${MORPHEUS_QEMU_INPUT_PATH:-unset}" >> "\${launch_marker}"
input_size="missing"
if [ -n "\${MORPHEUS_QEMU_INPUT_PATH:-}" ]; then
  input_size="\$(stat -c %s "\${MORPHEUS_QEMU_INPUT_PATH}" 2>/dev/null || printf missing)"
fi
printf 'input-size=%s\n' "\${input_size}" >> "\${launch_marker}"
if LC_ALL=C grep -a -q 'virtio_mmio_fuzz_read' "\${guest_qemu}"; then
  printf 'qemu-patch-symbols=present\n' >> "\${launch_marker}"
else
  printf 'qemu-patch-symbols=missing\n' >> "\${launch_marker}"
fi
printf 1 >/proc/sys/kernel/print-fatal-signals 2>/dev/null || true
dmesg -n 8 2>/dev/null || true
printf 'qemu-exec-start\n' >> "\${launch_marker}"
set +e
"\${guest_qemu_cmd[@]}"
qemu_status="\$?"
set -e
printf 'qemu-exit-status=%s\n' "\${qemu_status}" >> "\${launch_marker}"
exit "\${qemu_status}"
EOF
chmod +x "${build_l1_dir}/launch-l2.sh"

cat > "${build_l1_dir}/provision-l1.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
build_guest_qemu="__MORPHEUS_BUILD_GUEST_QEMU__"
guest_jobs="__MORPHEUS_GUEST_JOBS__"
guest_qemu_bin="/root/morpheus-qemu/bin/qemu-system-aarch64"
guest_qemu_fallback_bin="/usr/bin/qemu-system-aarch64"
provision_marker="/root/.morpheus-l1-provisioned"
if [ -f "${provision_marker}" ]; then
  echo "reusing existing l1 provision marker"
  exit 0
fi
if [ -x /root/install-dependencies.sh ]; then
  bash /root/install-dependencies.sh
fi
if ! [[ "${guest_jobs}" =~ ^[0-9]+$ ]] || [ "${guest_jobs}" -lt 1 ]; then
  guest_jobs=1
fi
reuse_guest_qemu() {
  local installed_qemu="${guest_qemu_bin}"
  local built_qemu="/root/morpheus-qemu-src/build/qemu-system-aarch64"
  local installed_hash="/root/morpheus-qemu/.morpheus-source-v2.sha256"
  local source_hash="/root/morpheus-qemu-src/.morpheus-source-v2.sha256"

  has_hyperarm_qemu_patch() {
    [ -x "$1" ] && LC_ALL=C grep -a -q 'virtio_mmio_fuzz_read' "$1"
  }

  if has_hyperarm_qemu_patch "${installed_qemu}" &&
     [ -f "${source_hash}" ] &&
     [ -f "${installed_hash}" ] &&
     cmp -s "${source_hash}" "${installed_hash}"; then
    echo "reusing installed guest qemu"
    return 0
  fi
  if [ -x "${installed_qemu}" ]; then
    echo "installed guest qemu is stale; rebuilding"
  fi

  if has_hyperarm_qemu_patch "${built_qemu}" &&
     [ -f "${source_hash}" ] &&
     [ -f /root/morpheus-qemu-src/build/.morpheus-source-v2.sha256 ] &&
     cmp -s "${source_hash}" /root/morpheus-qemu-src/build/.morpheus-source-v2.sha256; then
    echo "repairing guest qemu install from existing build output"
    mkdir -p /root/morpheus-qemu/bin
    cp -f "${built_qemu}" "${installed_qemu}"
    cp -f "${source_hash}" "${installed_hash}"
    return 0
  fi
  return 1
}
if reuse_guest_qemu; then
  build_guest_qemu="false"
fi
if [ "${build_guest_qemu}" = "true" ] && [ -d /root/morpheus-qemu-src ]; then
  cd /root/morpheus-qemu-src
elif [ "${build_guest_qemu}" = "true" ] && [ -f /root/morpheus-qemu-src.tar.xz ]; then
  rm -rf /root/morpheus-qemu-src
  mkdir -p /root/morpheus-qemu-src
  tar -xJf /root/morpheus-qemu-src.tar.xz -C /root/morpheus-qemu-src --strip-components=1
  cd /root/morpheus-qemu-src
fi
if [ "${build_guest_qemu}" = "true" ] && [ -d /root/morpheus-qemu-src ]; then
  if [ -f /root/morpheus-qemu-src/build/build.ninja ]; then
    find /root/morpheus-qemu-src \
      -path /root/morpheus-qemu-src/build -prune \
      -o -type f -exec touch -d @0 {} +
    for path in \
      configure \
      hw/intc/arm_gicv3_common.c \
      hw/intc/arm_gicv3_cpuif.c \
      hw/intc/trace-events \
      hw/virtio/trace-events \
      hw/virtio/virtio-mmio.c \
      include/hw/intc/arm_gicv3_common.h \
      target/arm/helper.c \
      target/arm/tcg/helper-a64.c \
      target/arm/trace-events; do
      touch "/root/morpheus-qemu-src/${path}"
    done
  fi
  export MORPHEUS_QEMU_USE_SYSTEM_MESON=1
  export CFLAGS="-O0 -g1"
  export CXXFLAGS="-O0 -g1"
  # Skip test-only build subtrees inside the constrained L1 guest.
  python3 - <<'PY'
import os
from pathlib import Path

meson = Path("/root/morpheus-qemu-src/meson.build")
text = meson.read_text()
replacements = {
    "subdir('tests/qtest/libqos')":
        "# disabled in l1 provision: subdir('tests/qtest/libqos')",
    "subdir('tests/qtest/fuzz')":
        "# disabled in l1 provision: subdir('tests/qtest/fuzz')",
    "subdir('tests')":
        "# disabled in l1 provision: subdir('tests')",
}
for old, new in replacements.items():
    if old not in text:
        raise SystemExit(f"missing qemu meson stanza: {old}")
    text = text.replace(old, new)
meson.write_text(text)
PY
  ./configure \
    --target-list=aarch64-softmmu \
    --prefix=/root/morpheus-qemu \
    --disable-docs \
    --disable-gtk \
    --disable-sdl \
    --disable-vnc \
    --disable-curses \
    --disable-tools \
    --enable-plugins \
    --disable-install-blobs \
    --disable-guest-agent \
    --disable-guest-agent-msi \
    --disable-virtfs \
    --disable-virtfs-proxy-helper \
    --disable-vhost-user \
    --disable-vhost-user-blk-server \
    --disable-vhost-crypto \
    --disable-vduse-blk-export \
    --disable-cap-ng \
    --audio-drv-list=
  make -j"${guest_jobs}" qemu-system-aarch64
  cp -f /root/morpheus-qemu-src/.morpheus-source-v2.sha256 \
    /root/morpheus-qemu-src/build/.morpheus-source-v2.sha256
  mkdir -p /root/morpheus-qemu/bin
  cp -f /root/morpheus-qemu-src/build/qemu-system-aarch64 \
    /root/morpheus-qemu/bin/qemu-system-aarch64
  cp -f /root/morpheus-qemu-src/.morpheus-source-v2.sha256 \
    /root/morpheus-qemu/.morpheus-source-v2.sha256
elif [ ! -x "${guest_qemu_bin}" ] && \
     [ ! -x "${guest_qemu_fallback_bin}" ]; then
  install_guest_qemu_package() {
    local pkg
    sudo apt-get update
    for pkg in qemu-system-arm qemu-system-misc qemu-system; do
      if apt-cache show "${pkg}" >/dev/null 2>&1; then
        sudo apt-get install -y --no-install-recommends "${pkg}"
        return 0
      fi
    done
    echo "unable to find a guest qemu package providing qemu-system-aarch64" >&2
    return 1
  }
  install_guest_qemu_package
fi
mkdir -p /root/nvirsh-images
chmod 0755 /root/launch-l2.sh
if [ -x /root/libafl_nesting_stub ]; then
  python3 - <<'PY'
import os
from pathlib import Path

grub = Path("/etc/default/grub")
text = grub.read_text()
required = [
    "init=/root/libafl_nesting_stub",
    "norandmaps",
    "rw",
]
for variable in ("GRUB_CMDLINE_LINUX", "GRUB_CMDLINE_LINUX_DEFAULT"):
    needle = f'{variable}="'
    start = text.find(needle)
    if start < 0:
        text += f'\n{variable}=""\n'
        start = text.find(needle)
    start += len(needle)
    end = text.find('"', start)
    if end < 0:
        raise SystemExit(f"unterminated {variable} in /etc/default/grub")

    current = text[start:end]
    parts = [entry for entry in current.split() if entry and entry not in required]
    if variable == "GRUB_CMDLINE_LINUX":
        parts.extend(required)
    updated = " ".join(parts)
    text = text[:start] + updated + text[end:]
grub.write_text(text)
PY
  if systemctl list-unit-files | grep -q '^cloud-init\.service'; then
    sudo systemctl disable cloud-init.service cloud-init-local.service \
      cloud-config.service cloud-final.service || true
  fi
  if command -v update-grub >/dev/null 2>&1; then
    sudo update-grub
  elif command -v grub-mkconfig >/dev/null 2>&1; then
    sudo grub-mkconfig -o /boot/grub/grub.cfg
  else
    echo "missing grub update command in l1 guest" >&2
    exit 1
  fi
  python3 - <<'PY'
import os
from pathlib import Path

cfg = Path("/boot/grub/grub.cfg")
text = cfg.read_text()
required = [
    "init=/root/libafl_nesting_stub",
    "norandmaps",
    "rw",
]
updated_lines = []
for line in text.splitlines():
    stripped = line.lstrip()
    if stripped.startswith("linux") and "/boot/vmlinuz-" in stripped:
        parts = [entry for entry in line.split() if entry not in required]
        parts.extend(required)
        line = "\t" + " ".join(parts)
    updated_lines.append(line)
updated = "\n".join(updated_lines) + "\n"
cfg.write_text(updated)
os.sync()
missing = [
    entry
    for entry in required
    if entry not in updated
]
if missing:
    raise SystemExit(
        "failed to add required kernel arguments to /boot/grub/grub.cfg: "
        + " ".join(missing)
    )
PY
fi
touch "${provision_marker}"
EOF
if [ -n "${guest_qemu_source}" ]; then
  sed -i 's/__MORPHEUS_BUILD_GUEST_QEMU__/true/g' "${build_l1_dir}/provision-l1.sh"
else
  sed -i 's/__MORPHEUS_BUILD_GUEST_QEMU__/false/g' "${build_l1_dir}/provision-l1.sh"
fi
sed -i "s/__MORPHEUS_GUEST_JOBS__/${guest_jobs}/g" "${build_l1_dir}/provision-l1.sh"
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

if [ "${reuse_provisioned_l1}" != "true" ]; then
  printf '[nvirsh] waiting for cloud-init in l1\n'
  wait_for_guest_command "${build_l0_dir}/id_ed25519" "${l1_ssh_port}" "${qemu_pid}" "cloud-init status --wait"
  printf '[nvirsh] cloud-init finished in l1\n'
fi

copy_to_guest "${build_l0_dir}/id_ed25519" "${l1_ssh_port}" "${build_l1_dir}/install-dependencies.sh" "/root/install-dependencies.sh"
copy_to_guest "${build_l0_dir}/id_ed25519" "${l1_ssh_port}" "${build_l1_dir}/launch-l2.sh" "${guest_launch}"
ssh_guest "${build_l0_dir}/id_ed25519" "${l1_ssh_port}" "mkdir -p ${guest_image_dir}"
copy_to_guest "${build_l0_dir}/id_ed25519" "${l1_ssh_port}" "${buildroot_images_dir}/Image" "${guest_image_dir}/Image"
copy_to_guest "${build_l0_dir}/id_ed25519" "${l1_ssh_port}" "${buildroot_images_dir}/rootfs.cpio.gz" "${guest_image_dir}/rootfs.cpio.gz"
if [ -n "${guest_stub_src}" ] && [ -f "${guest_stub_src}" ]; then
  printf '[nvirsh] copying guest stub into l1\n'
  copy_to_guest "${build_l0_dir}/id_ed25519" "${l1_ssh_port}" "${guest_stub_src}" "${guest_stub}"
  ssh_guest "${build_l0_dir}/id_ed25519" "${l1_ssh_port}" "chmod 0755 ${guest_stub}"
fi
if [ -n "${guest_nqc2_plugin}" ] && [ -f "${guest_nqc2_plugin}" ]; then
  printf '[nvirsh] copying nqc2 guest plugin into l1\n'
  ssh_guest "${build_l0_dir}/id_ed25519" "${l1_ssh_port}" "mkdir -p ${guest_nqc2_dir}/lib/nqc2"
  copy_to_guest "${build_l0_dir}/id_ed25519" "${l1_ssh_port}" "${guest_nqc2_plugin}" "${guest_nqc2_plugin_path}"
fi
if [ -n "${guest_qemu_source}" ] && [ -d "${guest_qemu_source}" ]; then
  printf '[nvirsh] copying patched qemu source tree into l1\n'
  copy_qemu_source_to_guest "${build_l0_dir}/id_ed25519" "${l1_ssh_port}" "${guest_qemu_source}" "${guest_qemu_src_dir}"
fi

copy_to_guest "${build_l0_dir}/id_ed25519" "${l1_ssh_port}" "${build_l1_dir}/provision-l1.sh" "/root/provision-l1.sh"
ssh_guest "${build_l0_dir}/id_ed25519" "${l1_ssh_port}" "chmod 0755 /root/provision-l1.sh"
if [ "${reuse_provisioned_l1}" = "true" ]; then
  printf '[nvirsh] skipped l1 provision script; using provisioned snapshot\n'
else
  printf '[nvirsh] running l1 provision script\n'
  ssh_guest "${build_l0_dir}/id_ed25519" "${l1_ssh_port}" "bash /root/provision-l1.sh"
  printf '[nvirsh] l1 provision script completed\n'
fi

mkdir -p "${build_l1_host_boot_dir}"
guest_boot_kernel="$(
  ssh_guest "${build_l0_dir}/id_ed25519" "${l1_ssh_port}" \
    'kernel=""; for candidate in /vmlinuz /boot/vmlinuz-*; do if [ -e "$candidate" ]; then kernel="$(readlink -f "$candidate")"; break; fi; done; printf "%s\n" "$kernel"'
)"
guest_boot_initrd="$(
  ssh_guest "${build_l0_dir}/id_ed25519" "${l1_ssh_port}" \
    'initrd=""; for candidate in /initrd.img /boot/initrd.img-*; do if [ -e "$candidate" ]; then initrd="$(readlink -f "$candidate")"; break; fi; done; printf "%s\n" "$initrd"'
)"
if [ -z "${guest_boot_kernel}" ] || [ -z "${guest_boot_initrd}" ]; then
  echo "failed to resolve guest boot artifacts in l1" >&2
  exit 1
fi
copy_from_guest "${build_l0_dir}/id_ed25519" "${l1_ssh_port}" "${guest_boot_kernel}" "${build_l1_host_boot_dir}/vmlinuz"
copy_from_guest "${build_l0_dir}/id_ed25519" "${l1_ssh_port}" "${guest_boot_initrd}" "${build_l1_host_boot_dir}/initrd.img"
ssh_guest "${build_l0_dir}/id_ed25519" "${l1_ssh_port}" "cat /proc/cmdline" > "${build_l1_host_boot_dir}/cmdline.txt"

if [ "${reuse_provisioned_l1}" != "true" ]; then
  provisioned_tmp="${provisioned_overlay_image}.tmp"
  rm -f "${provisioned_tmp}"
  qemu-img convert -O qcow2 "${overlay_image_path}" "${provisioned_tmp}"
  mv -f "${provisioned_tmp}" "${provisioned_overlay_image}"
fi

shutdown_l1
trap - EXIT INT TERM

node - "${profile_file}" "${state_file}" "${source_dir}" "${build_dir}" "${install_dir}" "${profile_name}" "${build_dir_key}" "${buildroot_output_dir}" "${BASH_SOURCE[0]}" "${guest_qemu_sync_files[@]}" <<'NODE'
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const [
  profileFile,
  stateFile,
  sourceDir,
  buildDir,
  installDir,
  profileName,
  buildDirKey,
  buildrootOutputDir,
  scriptPath,
  ...guestQemuSyncFiles
] = process.argv.slice(2);
const profile = JSON.parse(fs.readFileSync(profileFile, "utf8"));
const l0 = profile.l0 || {};
const l1 = profile.l1 || {};
function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}
function sha256GuestQemuSyncFiles(sourceDir, files) {
  if (!sourceDir) {
    return null;
  }
  const hash = crypto.createHash("sha256");
  for (const file of files) {
    const filePath = path.join(sourceDir, file);
    hash.update(file);
    hash.update("\0");
    hash.update(fs.readFileSync(filePath));
    hash.update("\0");
  }
  return hash.digest("hex");
}
function writeJson(filePath, value) {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + "\n");
}
const guestStub = process.env.MORPHEUS_NVIRSH_GUEST_STUB || "";
const guestStubSha256 = guestStub
  ? sha256File(guestStub)
  : null;
const nvirshBuildScriptSha256 = sha256File(scriptPath);
const guestQemuSource = process.env.MORPHEUS_NVIRSH_GUEST_QEMU_SOURCE || "";
const guestQemuSourceSha256 = sha256GuestQemuSyncFiles(
  guestQemuSource,
  guestQemuSyncFiles,
);
const buildrootImages = {
  outputDir: buildrootOutputDir,
  image: path.join(buildrootOutputDir, "images", "Image"),
  initrd: path.join(buildrootOutputDir, "images", "rootfs.cpio.gz"),
  vmlinux: null,
  imageSha256: sha256File(path.join(buildrootOutputDir, "images", "Image")),
  initrdSha256: sha256File(path.join(buildrootOutputDir, "images", "rootfs.cpio.gz")),
};
const buildrootBuildDir = path.join(buildrootOutputDir, "build");
if (fs.existsSync(buildrootBuildDir)) {
  for (const candidate of fs.readdirSync(buildrootBuildDir, {
    withFileTypes: true,
  })) {
    if (!candidate.isDirectory() || !candidate.name.startsWith("linux-")) {
      continue;
    }
    const vmlinuxPath = path.join(buildrootBuildDir, candidate.name, "vmlinux");
    if (fs.existsSync(vmlinuxPath)) {
      buildrootImages.vmlinux = vmlinuxPath;
      break;
    }
  }
}
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
    pid: null,
    l1: {
      host: null,
      port: null,
      user: null,
    },
  },
  hostLaunch: {
    firmware: process.env.MORPHEUS_NVIRSH_FIRMWARE || null,
    overlayImage: path.join(buildDir, "l0", "overlay.qcow2"),
    provisionedOverlayImage: path.join(buildDir, "l0", "l1-provisioned.qcow2"),
    seedImage: path.join(buildDir, "l0", "seed.img"),
  },
  layeredState: {
    l0: {
      status: "prepared",
      hostName: l0.hostName || null,
      workspace: l0.workspace || null,
      image: l0.image || null,
      provisionedOverlayImage: path.join(buildDir, "l0", "l1-provisioned.qcow2"),
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
      guestStub: process.env.MORPHEUS_NVIRSH_GUEST_STUB
        ? "/root/libafl_nesting_stub"
        : null,
      guestStubSource: process.env.MORPHEUS_NVIRSH_GUEST_STUB || null,
      guestStubSha256,
      nvirshBuildScriptSha256,
      guestQemuDir: process.env.MORPHEUS_NVIRSH_GUEST_QEMU_SOURCE
        ? "/root/morpheus-qemu"
        : null,
      guestQemuSource: guestQemuSource || null,
      guestQemuSourceSha256,
      guestNqc2Plugin: process.env.MORPHEUS_NVIRSH_GUEST_NQC2_PLUGIN || null,
    },
    l2: {
      status: "prepared",
      launcher: profile.l2 && profile.l2.launcher ? profile.l2.launcher : null,
      launcherArgs: profile.l2 && Array.isArray(profile.l2.launcherArgs) ? profile.l2.launcherArgs : [],
      kernel: profile.l2 && profile.l2.kernel ? profile.l2.kernel : null,
      initrd: profile.l2 && profile.l2.initrd ? profile.l2.initrd : null,
      buildrootImages,
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
const l1Provision = Object.assign(
  {},
  (profile.l1 && typeof profile.l1 === "object") ? profile.l1 : {},
  { workspace: l0.workspace || null },
);
writeJson(stateFile, state);
writeJson(path.join(installDir, "profile.json"), profile);
writeJson(path.join(installDir, "l0-provision.json"), profile.l0 || {});
writeJson(path.join(installDir, "l1-provision.json"), l1Provision);
NODE

cat > "${result_file}" <<EOF
{"details":{"source":"${source_dir}","build_dir":"${build_dir}","install_dir":"${install_dir}","state_file":"${state_file}","profile":"${profile_name}","reused":false}}
EOF
printf '[nvirsh] prepared l1 runtime and l2 launch script for %s\n' "${profile_name}"
