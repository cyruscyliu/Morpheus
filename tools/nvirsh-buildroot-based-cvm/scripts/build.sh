#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/../../_shared/scripts/parallelism.sh"
source "$(dirname "${BASH_SOURCE[0]}")/../../_shared/scripts/state.sh"
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"

build_dir="${MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_BUILD_DIR:?}"
install_dir="${MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_INSTALL_DIR:?}"
qemu="${MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_QEMU:?}"
buildroot_output_dir="${MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_BUILDROOT_OUTPUT_DIR:?}"
l1_kernel="${MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_L1_KERNEL:?}"
host_stack_archive_url="${MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_HOST_STACK_ARCHIVE_URL:?}"
host_stack_archive_sha256="${MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_HOST_STACK_ARCHIVE_SHA256:?}"
reuse_build_dir="${MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_REUSE_BUILD_DIR:-false}"
build_dir_key="${MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_BUILD_DIR_KEY:-default}"
result_file="${MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_RESULT_FILE:-${MORPHEUS_SCRIPT_RESULT_FILE:?}}"

if [[ "${build_dir}" != /* ]]; then
  build_dir="$(pwd)/${build_dir#./}"
fi
if [[ "${install_dir}" != /* ]]; then
  install_dir="$(pwd)/${install_dir#./}"
fi
if [[ "${qemu}" != /* ]]; then
  qemu="${repo_root}/${qemu#./}"
fi
if [[ "${buildroot_output_dir}" != /* ]]; then
  buildroot_output_dir="${repo_root}/${buildroot_output_dir#./}"
fi
if [[ "${l1_kernel}" != /* ]]; then
  l1_kernel="${repo_root}/${l1_kernel#./}"
fi
if [[ "${result_file}" != /* ]]; then
  result_file="$(pwd)/${result_file#./}"
fi

buildroot_image="${buildroot_output_dir}/images/Image"
buildroot_initrd="${buildroot_output_dir}/images/rootfs.cpio.gz"
buildroot_target_dir="${buildroot_output_dir}/target"
buildroot_guest_qemu="${buildroot_target_dir}/usr/bin/qemu-system-aarch64"
buildroot_guest_qemu_data_dir="${buildroot_target_dir}/usr/share/qemu"
buildroot_target_lib_dir="${buildroot_target_dir}/lib"
buildroot_target_usr_lib_dir="${buildroot_target_dir}/usr/lib"
buildroot_inputs_state_file="${buildroot_output_dir}/.morpheus-build-inputs.json"
buildroot_vmlinux="${buildroot_output_dir}/build/vmlinux"
downloads_dir="${build_dir}/downloads"
archive_name="$(basename "${host_stack_archive_url}")"
archive_path="${downloads_dir}/${archive_name:-host-stack.tar.xz}"
l1_dir="${build_dir}/l1"
host_stack_dir="${l1_dir}/cca-host-stack"
host_boot_dir="${l1_dir}/host-boot"
guest_images_dir="${l1_dir}/guest-images"
guest_qemu_dir="${l1_dir}/guest-qemu"
guest_qemu_runtime_lib_dir="${guest_qemu_dir}/runtime-libs"
launch_script="${l1_dir}/launch-l2.sh"
hoststack_launch_script="${l1_dir}/launch-l2-hoststack.sh"
state_file="${install_dir}/state.json"
fingerprint_file="${install_dir}/inputs.fingerprint"
l1_cpus="$(morpheus_default_cvm_l1_qemu_cpus)"
l1_memory="$(morpheus_default_cvm_l1_qemu_memory_mb)"

require_file() {
  local path="$1"
  local description="$2"
  if [ ! -f "${path}" ]; then
    echo "missing ${description}: ${path}" >&2
    exit 1
  fi
}

download_host_stack_archive() {
  mkdir -p "${downloads_dir}"
  if [ ! -f "${archive_path}" ]; then
    if [[ "${host_stack_archive_url}" == file://* ]]; then
      cp "${host_stack_archive_url#file://}" "${archive_path}"
    else
      curl -L --fail --silent --show-error "${host_stack_archive_url}" -o "${archive_path}"
    fi
  fi
  printf '%s  %s\n' "${host_stack_archive_sha256}" "${archive_path}" | sha256sum -c - >/dev/null
}

compute_inputs_fingerprint() {
  local buildroot_inputs_fingerprint=""
  if [ -f "${buildroot_inputs_state_file}" ]; then
    buildroot_inputs_fingerprint="$(
      node -e '
const fs = require("fs");
try {
  const data = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  process.stdout.write(data.fingerprint || "");
} catch {
  process.stdout.write("");
}
' "${buildroot_inputs_state_file}"
    )"
  fi

  {
    printf 'tool=%s\n' "nvirsh-buildroot-based-cvm"
    printf 'build_dir_key=%s\n' "${build_dir_key}"
    printf 'host_stack_archive_url=%s\n' "${host_stack_archive_url}"
    printf 'host_stack_archive_sha256=%s\n' "${host_stack_archive_sha256}"
    printf 'buildroot_inputs_fingerprint=%s\n' "${buildroot_inputs_fingerprint}"
    printf 'qemu=%s\n' "${qemu}"
    printf 'l1_kernel=%s\n' "${l1_kernel}"
    printf '%s\n' "${BASH_SOURCE[0]}"
    printf '%s\n' "${qemu}"
    printf '%s\n' "${l1_kernel}"
    printf '%s\n' "${buildroot_image}"
    printf '%s\n' "${buildroot_initrd}"
    printf '%s\n' "${buildroot_guest_qemu}"
    [ -f "${buildroot_inputs_state_file}" ] && printf '%s\n' "${buildroot_inputs_state_file}"
  } | morpheus_hash_files_from_stdin
}

state_matches() {
  local current_fingerprint="$1"

  [ -f "${state_file}" ] || return 1
  [ -f "${fingerprint_file}" ] || return 1
  [ "$(cat "${fingerprint_file}")" = "${current_fingerprint}" ] || return 1
  [ -f "${host_boot_dir}/vmlinuz" ] || return 1
  [ -f "${host_boot_dir}/flash.bin" ] || return 1
  [ -f "${host_stack_dir}/out/host.ext4" ] || return 1
  [ -f "${guest_images_dir}/Image" ] || return 1
  [ -f "${guest_images_dir}/rootfs.cpio.gz" ] || return 1
  [ -f "${guest_qemu_dir}/bin/qemu-system-aarch64" ] || return 1
  [ -f "${launch_script}" ] || return 1
  [ -f "${hoststack_launch_script}" ] || return 1
}

require_file "${qemu}" "host qemu binary"
require_file "${l1_kernel}" "l1 kernel image"
require_file "${buildroot_image}" "buildroot kernel image"
require_file "${buildroot_initrd}" "buildroot initramfs"
require_file "${buildroot_guest_qemu}" "buildroot guest qemu"

download_host_stack_archive
current_fingerprint="$(compute_inputs_fingerprint)"

if [ "${reuse_build_dir}" = "true" ] && state_matches "${current_fingerprint}"; then
  cat > "${result_file}" <<EOF
{"details":{"build_dir":"${build_dir}","install_dir":"${install_dir}","state_file":"${state_file}","share_dir":"${l1_dir}","reused":true},"artifacts":[{"path":"prepared-state","location":"${state_file}"},{"path":"share-dir","location":"${l1_dir}"}]}
EOF
  exit 0
fi

rm -rf "${l1_dir}" "${install_dir}"
mkdir -p \
  "${host_stack_dir}" \
  "${host_boot_dir}" \
  "${guest_images_dir}" \
  "${guest_qemu_dir}/bin" \
  "${guest_qemu_dir}/share" \
  "${guest_qemu_runtime_lib_dir}/lib" \
  "${install_dir}"

tar -xJf "${archive_path}" -C "${host_stack_dir}"
require_file "${host_stack_dir}/out/host.ext4" "host stack rootfs"
require_file "${host_stack_dir}/out/flash.bin" "host stack firmware"

cp -f "${l1_kernel}" "${host_boot_dir}/vmlinuz"
cp -f "${host_stack_dir}/out/flash.bin" "${host_boot_dir}/flash.bin"
cp -f "${buildroot_image}" "${guest_images_dir}/Image"
cp -f "${buildroot_initrd}" "${guest_images_dir}/rootfs.cpio.gz"
cp -f "${buildroot_guest_qemu}" "${guest_qemu_dir}/bin/qemu-system-aarch64"
chmod +x "${guest_qemu_dir}/bin/qemu-system-aarch64"

if [ -d "${buildroot_guest_qemu_data_dir}" ]; then
  cp -a "${buildroot_guest_qemu_data_dir}" "${guest_qemu_dir}/share/"
fi
if [ -d "${buildroot_target_lib_dir}" ]; then
  cp -a "${buildroot_target_lib_dir}/." "${guest_qemu_runtime_lib_dir}/lib/"
fi
if [ -d "${buildroot_target_usr_lib_dir}" ]; then
  cp -a "${buildroot_target_usr_lib_dir}/." "${guest_qemu_runtime_lib_dir}/lib/"
fi
ln -sfn lib "${guest_qemu_runtime_lib_dir}/lib64"

cat > "${launch_script}" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

runtime_dir="${MORPHEUS_L2_RUNTIME_DIR:-/host/morpheus-l2-runtime}"
guest_image_dir="${MORPHEUS_L2_GUEST_IMAGE_DIR:-/host/guest-images}"
guest_qemu="/host/guest-qemu/bin/qemu-system-aarch64"
guest_qemu_data_dir="/host/guest-qemu/share/qemu"
guest_qemu_runtime_lib_dir="/host/guest-qemu/runtime-libs"
launch_marker="${runtime_dir}/launch-l2.marker"
guest_qemu_trace_events="${runtime_dir}/morpheus-qemu-trace-events.txt"
guest_qemu_stdout="${runtime_dir}/qemu.stdout.log"
guest_qemu_stderr="${runtime_dir}/qemu.stderr.log"
guest_qemu_exec_cmd=()

mkdir -p "${runtime_dir}"
: > "${guest_qemu_stdout}"
: > "${guest_qemu_stderr}"
printf 'script-start\n' > "${launch_marker}"

if [ ! -x "${guest_qemu}" ]; then
  echo "missing qemu-system-aarch64 in host share: ${guest_qemu}" >&2
  exit 1
fi
if [ ! -e /dev/kvm ]; then
  echo "missing /dev/kvm for l2 cvm launch" >&2
  exit 1
fi

printf 'virtio_mmio_fuzz_read\n' > "${guest_qemu_trace_events}"
printf 'virtio_mmio_dma_fuzz\n' >> "${guest_qemu_trace_events}"

guest_qemu_cmd=(
  "${guest_qemu}"
  -L "${guest_qemu_data_dir}"
  -trace "events=${guest_qemu_trace_events},file=${runtime_dir}/morpheus-qemu-trace.log"
  -machine "virt,gic-version=3,its=on,confidential-guest-support=rme0"
  -object rme-guest,id=rme0,measurement-algorithm=sha512
  -cpu host
  -enable-kvm
  -m 1024M
  -nographic
  -nodefaults
  -chardev stdio,mux=on,id=chr0,signal=off
  -serial chardev:chr0
  -device virtio-serial-pci
  -device virtconsole,chardev=chr0
  -mon chardev=chr0,mode=readline
  -kernel "${guest_image_dir}/Image"
  -initrd "${guest_image_dir}/rootfs.cpio.gz"
  -netdev user,id=net0
  -device virtio-net-pci,netdev=net0,romfile=''
  -append "console=hvc0 oops=panic panic_on_warn=1 panic=-1 kasan.fault=panic"
)

guest_qemu_exec_cmd=("${guest_qemu_cmd[@]}")
if [ -d "${guest_qemu_runtime_lib_dir}" ]; then
  guest_qemu_runtime_loader=""
  for candidate in \
    "${guest_qemu_runtime_lib_dir}/lib/ld-linux-aarch64.so.1" \
    "${guest_qemu_runtime_lib_dir}/lib64/ld-linux-aarch64.so.1"; do
    if [ -x "${candidate}" ]; then
      guest_qemu_runtime_loader="${candidate}"
      break
    fi
  done
  guest_qemu_runtime_library_path="${guest_qemu_runtime_lib_dir}/lib"
  if [ -n "${guest_qemu_runtime_loader}" ]; then
    guest_qemu_exec_cmd=(
      "${guest_qemu_runtime_loader}"
      --library-path
      "${guest_qemu_runtime_library_path}"
      "${guest_qemu_cmd[@]}"
    )
  else
    guest_qemu_exec_cmd=(
      env
      LD_LIBRARY_PATH="${guest_qemu_runtime_library_path}"
      "${guest_qemu_cmd[@]}"
    )
  fi
fi

printf 'qemu-cmd=' >> "${launch_marker}"
printf '%q ' "${guest_qemu_cmd[@]}" >> "${launch_marker}"
printf '\n' >> "${launch_marker}"
if LC_ALL=C grep -a -q 'virtio_mmio_fuzz_read' "${guest_qemu}" 2>/dev/null; then
  printf 'qemu-patch-symbols=present\n' >> "${launch_marker}"
else
  printf 'qemu-patch-symbols=missing\n' >> "${launch_marker}"
fi
printf 'qemu-exec-start\n' >> "${launch_marker}"
set +e
"${guest_qemu_exec_cmd[@]}" >> "${guest_qemu_stdout}" 2>> "${guest_qemu_stderr}"
qemu_status="$?"
set -e
printf 'qemu-exit-status=%s\n' "${qemu_status}" >> "${launch_marker}"
exit "${qemu_status}"
EOF
chmod +x "${launch_script}"

cat > "${hoststack_launch_script}" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
runtime_dir="${MORPHEUS_L2_RUNTIME_DIR:-/host/morpheus-l2-runtime}"
mkdir -p "${runtime_dir}"
export MORPHEUS_L2_RUNTIME_DIR="${runtime_dir}"
export MORPHEUS_L2_GUEST_IMAGE_DIR="${MORPHEUS_L2_GUEST_IMAGE_DIR:-/host/guest-images}"
exec /host/launch-l2.sh
EOF
chmod +x "${hoststack_launch_script}"

profile_sha256="$(sha256sum "${host_boot_dir}/vmlinuz" | awk '{print $1}')"
buildroot_inputs_fingerprint=""
if [ -f "${buildroot_inputs_state_file}" ]; then
  buildroot_inputs_fingerprint="$(
    node -e '
const fs = require("fs");
try {
  const data = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  process.stdout.write(data.fingerprint || "");
} catch {
  process.stdout.write("");
}
' "${buildroot_inputs_state_file}"
  )"
fi

node - "${state_file}" "${build_dir_key}" "${build_dir}" "${install_dir}" "${current_fingerprint}" "${qemu}" "${host_boot_dir}/flash.bin" "${host_boot_dir}/vmlinuz" "${host_stack_dir}/out/host.ext4" "${l1_dir}" "${launch_script}" "${hoststack_launch_script}" "${guest_images_dir}/Image" "${guest_images_dir}/rootfs.cpio.gz" "${buildroot_vmlinux}" "${guest_qemu_dir}/bin/qemu-system-aarch64" "${guest_qemu_runtime_lib_dir}" "${buildroot_inputs_fingerprint}" "${profile_sha256}" "${host_stack_archive_url}" "${host_stack_archive_sha256}" "${l1_memory}" "${l1_cpus}" <<'NODE'
const fs = require("fs");
const path = require("path");
const [
  stateFile,
  buildDirKey,
  buildDir,
  installDir,
  inputsFingerprint,
  hostQemu,
  firmware,
  l1Kernel,
  l1Rootfs,
  shareDir,
  launchScript,
  hoststackLaunchScript,
  l2Image,
  l2Initrd,
  l2Vmlinux,
  l2Qemu,
  l2QemuRuntimeLibDir,
  buildrootInputsFingerprint,
  profileSha256,
  hostStackArchiveUrl,
  hostStackArchiveSha256,
  l1Memory,
  l1Cpus,
] = process.argv.slice(2);
const buildrootOutputDir = path.dirname(path.dirname(l2Image));
const now = new Date().toISOString();
const state = {
  schemaVersion: 1,
  tool: "nvirsh-buildroot-based-cvm",
  buildDirKey,
  buildDir,
  installDir,
  status: "prepared",
  currentPhase: "build",
  profileSha256,
  inputsFingerprint,
  hostLaunch: {
    qemu: hostQemu,
    firmware,
    kernel: l1Kernel,
    machine: "virt,virtualization=on,gic-version=3,its=on",
    cpu: "max,x-rme=on,sme=off,pauth-impdef=on,sve=off",
    memory: String(l1Memory),
    cpus: String(l1Cpus),
    accel: "tcg",
    enableKvm: false,
  },
  layeredState: {
    l1: {
      rootfs: l1Rootfs,
      shareDir,
      launchScript,
      launchScriptHoststack: hoststackLaunchScript,
      hostStackArchive: {
        url: hostStackArchiveUrl,
        sha256: hostStackArchiveSha256,
      },
    },
    l2: {
      mode: "cvm",
      cvm: true,
      buildrootImages: {
        outputDir: buildrootOutputDir,
        image: l2Image,
        initrd: l2Initrd,
        vmlinux: fs.existsSync(l2Vmlinux) ? l2Vmlinux : null,
        qemu: l2Qemu,
        runtimeLibDir: l2QemuRuntimeLibDir,
        buildInputsFingerprint: buildrootInputsFingerprint,
      },
    },
  },
  phases: {
    build: "success",
  },
  createdAt: now,
  updatedAt: now,
};
fs.writeFileSync(stateFile, `${JSON.stringify(state, null, 2)}\n`);
NODE

printf '%s\n' "${current_fingerprint}" > "${fingerprint_file}"

cat > "${result_file}" <<EOF
{"details":{"build_dir":"${build_dir}","install_dir":"${install_dir}","state_file":"${state_file}","share_dir":"${l1_dir}","reused":false},"artifacts":[{"path":"prepared-state","location":"${state_file}"},{"path":"share-dir","location":"${l1_dir}"}]}
EOF
