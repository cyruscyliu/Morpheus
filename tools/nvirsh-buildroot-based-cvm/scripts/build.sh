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
l2_kernel="${MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_L2_KERNEL:-}"
l1_firmware_a="${MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_L1_FIRMWARE_A:?}"
l1_firmware_b="${MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_L1_FIRMWARE_B:?}"
qemu_edk2="${MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_QEMU_EDK2:-}"
l2_guest_disk="${MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_L2_GUEST_DISK:-}"
l2_kvmtool_efi="${MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_L2_KVMTOOL_EFI:-}"
l2_qemu="${MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_L2_QEMU:-}"
l2_virtio_transport="${MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_L2_VIRTIO_TRANSPORT:-pci}"
l1_machine="${MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_L1_MACHINE:-sbsa-ref}"
l1_cpu="${MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_L1_CPU:-max,x-rme=on,sme=off,pauth-impdef=on,sve=off}"
l1_cmdline="${MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_L1_CMDLINE:-root=/dev/vda console=ttyAMA0}"
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
if [[ -n "${l2_kernel}" && "${l2_kernel}" != /* ]]; then
  l2_kernel="${repo_root}/${l2_kernel#./}"
fi
if [[ "${l1_firmware_a}" != /* ]]; then
  l1_firmware_a="${repo_root}/${l1_firmware_a#./}"
fi
if [[ "${l1_firmware_b}" != /* ]]; then
  l1_firmware_b="${repo_root}/${l1_firmware_b#./}"
fi
if [[ -n "${qemu_edk2}" && "${qemu_edk2}" != /* ]]; then
  qemu_edk2="${repo_root}/${qemu_edk2#./}"
fi
if [[ -n "${l2_guest_disk}" && "${l2_guest_disk}" != /* ]]; then
  l2_guest_disk="${repo_root}/${l2_guest_disk#./}"
fi
if [[ -n "${l2_kvmtool_efi}" && "${l2_kvmtool_efi}" != /* ]]; then
  l2_kvmtool_efi="${repo_root}/${l2_kvmtool_efi#./}"
fi
if [[ -n "${l2_qemu}" && "${l2_qemu}" != /* ]]; then
  l2_qemu="${repo_root}/${l2_qemu#./}"
fi
if [[ "${result_file}" != /* ]]; then
  result_file="$(pwd)/${result_file#./}"
fi

buildroot_image="${buildroot_output_dir}/images/Image"
buildroot_initrd_plain="${buildroot_output_dir}/images/rootfs.cpio"
buildroot_initrd="${buildroot_output_dir}/images/rootfs.cpio.gz"
buildroot_rootfs="${buildroot_output_dir}/images/rootfs.ext2"
if [ ! -f "${buildroot_rootfs}" ] && [ -f "${buildroot_output_dir}/images/rootfs.ext4" ]; then
  buildroot_rootfs="${buildroot_output_dir}/images/rootfs.ext4"
fi
buildroot_target_dir="${buildroot_output_dir}/target"
buildroot_gen_run_vmm="${buildroot_target_dir}/usr/bin/gen-run-vmm.sh"
buildroot_realm_measurements="${buildroot_target_dir}/usr/bin/realm-measurements"
buildroot_lkvm="${buildroot_target_dir}/usr/bin/lkvm"
buildroot_guest_qemu="${buildroot_target_dir}/usr/bin/qemu-system-aarch64"
buildroot_guest_qemu_data_dir="${buildroot_target_dir}/usr/share/qemu"
buildroot_inputs_state_file="${buildroot_output_dir}/.morpheus-build-inputs.json"
buildroot_vmlinux="${buildroot_output_dir}/build/vmlinux"

guest_kernel_image_source="${buildroot_image}"
if [ -n "${l2_kernel}" ]; then
  guest_kernel_image_source="${l2_kernel}"
elif [ ! -f "${guest_kernel_image_source}" ]; then
  guest_kernel_image_source="${l1_kernel}"
fi
guest_qemu_source="${buildroot_guest_qemu}"
if [ -n "${l2_qemu}" ]; then
  guest_qemu_source="${l2_qemu}"
fi

l1_dir="${build_dir}/l1"
host_boot_dir="${l1_dir}/host-boot"
host_firmware_dir="${l1_dir}/host-firmware"
host_rootfs_dir="${l1_dir}/host-rootfs"
guest_images_dir="${l1_dir}/guest-images"
guest_qemu_dir="${l1_dir}/guest-qemu"
launch_script="${l1_dir}/launch-l2.sh"
hoststack_launch_script="${l1_dir}/launch-l2-hoststack.sh"
l2_shared_image="${l1_dir}/Image"
l2_shared_initrd="${l1_dir}/rootfs.cpio"
l2_shared_initrd_gz="${l1_dir}/rootfs.cpio.gz"
l2_shared_guest_disk="${l1_dir}/guest-disk.img"
l2_shared_kvmtool_efi="${l1_dir}/KVMTOOL_EFI.fd"
l2_shared_lkvm="${l1_dir}/lkvm"
l2_shared_qemu_binary="${l1_dir}/qemu-system-aarch64"
l2_shared_cfg="${l1_dir}/gen-run-vmm.cfg"
l2_shared_qemu_efi_dir="${l1_dir}/Build/ArmVirtQemu-AARCH64/DEBUG_GCC5/FV"
l2_shared_qemu_efi="${l2_shared_qemu_efi_dir}/QEMU_EFI.fd"
l2_shared_kvmtool_efi_dir="${l1_dir}/Build/ArmVirtKvmtool-AARCH64/DEBUG_GCC5/FV"
l2_shared_kvmtool_build_efi="${l2_shared_kvmtool_efi_dir}/KVMTOOL_EFI.fd"
state_file="${install_dir}/state.json"
fingerprint_file="${install_dir}/inputs.fingerprint"
l1_cpus="$(morpheus_default_cvm_l1_qemu_cpus)"
l1_memory="$(morpheus_default_cvm_l1_qemu_memory_mb)"
if [ -n "${MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_L1_CPUS:-}" ]; then
  l1_cpus="${MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_L1_CPUS}"
fi
if [ -n "${MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_L1_MEMORY_MB:-}" ]; then
  l1_memory="${MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_L1_MEMORY_MB}"
fi
host_rootfs_path="${host_rootfs_dir}/$(basename "${buildroot_rootfs}")"
host_firmware_a_path="${host_firmware_dir}/SBSA_FLASH0.fd"
host_firmware_b_path="${host_firmware_dir}/SBSA_FLASH1.fd"

use_linaro_helper="false"
if [ -n "${qemu_edk2}" ] || [ -n "${l2_guest_disk}" ] || [ -n "${l2_kvmtool_efi}" ]; then
  if [ -z "${qemu_edk2}" ] || [ -z "${l2_guest_disk}" ] || [ -z "${l2_kvmtool_efi}" ]; then
    echo "incomplete L2 helper inputs: qemu-edk2, l2-guest-disk, and l2-kvmtool-efi must be provided together" >&2
    exit 1
  fi
  use_linaro_helper="true"
fi

case "${l2_virtio_transport}" in
  pci|mmio)
    ;;
  *)
    echo "unsupported l2 virtio transport: ${l2_virtio_transport}" >&2
    exit 1
    ;;
esac
if [ "${use_linaro_helper}" = "true" ] && [ "${l2_virtio_transport}" != "pci" ]; then
  echo "linaro helper launch only supports l2 virtio transport pci" >&2
  exit 1
fi

require_file() {
  local path="$1"
  local description="$2"
  if [ ! -f "${path}" ]; then
    echo "missing ${description}: ${path}" >&2
    exit 1
  fi
}

validate_guest_qemu_profile_free() {
  local patch_list
  local qemu_patch_lists=()

  while IFS= read -r patch_list; do
    [ -n "${patch_list}" ] || continue
    qemu_patch_lists+=("${patch_list}")
  done < <(
    find "${buildroot_output_dir}/build" -mindepth 2 -maxdepth 2 \
      -type f -path '*/qemu-*/.applied_patches_list' -print | sort
  )

  for patch_list in "${qemu_patch_lists[@]}"; do
    if grep -Eiq \
        '(^|/)(profiles|qemu-patches)/|CVE-[0-9]+|virtio-net-profile|hyperarm-virtio-mmio-(fuzz|observation)' \
        "${patch_list}"; then
      echo "guest QEMU contains a profile-specific patch: ${patch_list}" >&2
      grep -Ei \
        '(^|/)(profiles|qemu-patches)/|CVE-[0-9]+|virtio-net-profile|hyperarm-virtio-mmio-(fuzz|observation)' \
        "${patch_list}" >&2
      exit 1
    fi
  done

  # The nested guest QEMU is an input to the test, not part of the test
  # oracle.  Reject both the old CVE profiles and the former seed-injection
  # hooks so a stale package tree cannot pass merely because its provenance
  # file was lost.  Device input is supplied by the external vhost-user
  # backend; MMIO is observed through QEMU's stock trace events.
  if LC_ALL=C grep -aEq \
      'virtio-net profile:|synthetic_rx_done|MORPHEUS_QEMU_INPUT_PATH_ENV|morpheus_virtio_mmio_fuzz|virtio_mmio_(observe|fuzz)' \
      "${guest_qemu_source}" 2>/dev/null; then
    echo "guest QEMU is not stock: ${guest_qemu_source}" >&2
    exit 1
  fi
}

inject_morpheus_rsi_evidence_into_initrd() {
  local initrd_path="$1"
  local temp_dir=""
  local overlay_dir=""
  local overlay_initrd=""
  local rebuilt_initrd=""

  temp_dir="$(mktemp -d)"
  overlay_dir="${temp_dir}/overlay"
  overlay_initrd="${temp_dir}/overlay.cpio"
  rebuilt_initrd="${temp_dir}/rootfs.cpio"
  mkdir -p "${overlay_dir}"

  mkdir -p "${overlay_dir}/etc/init.d"
  cat > "${overlay_dir}/etc/init.d/S60morpheus-rsi-evidence" <<'EOF'
#!/bin/sh
set -eu

rsi_line="$(dmesg | grep -m1 'RME: Using RSI version' 2>/dev/null || true)"
if [ -n "${rsi_line}" ]; then
  printf 'MORPHEUS_RSI_EVIDENCE: %s\n' "${rsi_line}"
else
  printf 'MORPHEUS_RSI_EVIDENCE_MISSING\n'
fi
EOF
  chmod +x "${overlay_dir}/etc/init.d/S60morpheus-rsi-evidence"

  (
    cd "${overlay_dir}"
    find . | LC_ALL=C sort | cpio --reproducible --quiet -o -H newc > "${overlay_initrd}"
  )

  cat "${initrd_path}" "${overlay_initrd}" > "${rebuilt_initrd}"
  mv -f "${rebuilt_initrd}" "${initrd_path}"
  rm -rf "${temp_dir}"
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
    printf 'launcher-device-backend-v2\n'
    printf 'build_dir_key=%s\n' "${build_dir_key}"
    printf 'buildroot_inputs_fingerprint=%s\n' "${buildroot_inputs_fingerprint}"
    printf 'qemu=%s\n' "${qemu}"
    printf 'l1_kernel=%s\n' "${l1_kernel}"
    printf 'l2_kernel=%s\n' "${l2_kernel}"
    printf 'l1_firmware_a=%s\n' "${l1_firmware_a}"
    printf 'l1_firmware_b=%s\n' "${l1_firmware_b}"
    printf 'l1_machine=%s\n' "${l1_machine}"
    printf 'l1_cpu=%s\n' "${l1_cpu}"
    printf 'l1_cmdline=%s\n' "${l1_cmdline}"
    printf 'l1_memory=%s\n' "${l1_memory}"
    printf 'l1_cpus=%s\n' "${l1_cpus}"
    printf 'use_linaro_helper=%s\n' "${use_linaro_helper}"
    printf 'l2_virtio_transport=%s\n' "${l2_virtio_transport}"
    printf '%s\n' "${BASH_SOURCE[0]}"
    printf '%s\n' "${qemu}"
    printf '%s\n' "${l1_kernel}"
    printf '%s\n' "${l1_firmware_a}"
    printf '%s\n' "${l1_firmware_b}"
    printf '%s\n' "${guest_kernel_image_source}"
    printf '%s\n' "${buildroot_initrd_plain}"
    printf '%s\n' "${buildroot_initrd}"
    printf '%s\n' "${buildroot_rootfs}"
    printf '%s\n' "${guest_qemu_source}"
    if [ "${use_linaro_helper}" = "true" ]; then
      printf '%s\n' "${buildroot_initrd_plain}"
      printf '%s\n' "${buildroot_gen_run_vmm}"
      printf '%s\n' "${buildroot_realm_measurements}"
      printf '%s\n' "${buildroot_lkvm}"
      printf '%s\n' "${qemu_edk2}"
      printf '%s\n' "${l2_guest_disk}"
      printf '%s\n' "${l2_kvmtool_efi}"
    fi
    [ -f "${buildroot_inputs_state_file}" ] && printf '%s\n' "${buildroot_inputs_state_file}"
  } | morpheus_hash_files_from_stdin
}

state_matches() {
  local current_fingerprint="$1"

  [ -f "${state_file}" ] || return 1
  [ -f "${fingerprint_file}" ] || return 1
  [ "$(cat "${fingerprint_file}")" = "${current_fingerprint}" ] || return 1
  [ -f "${host_boot_dir}/Image" ] || return 1
  [ -f "${host_firmware_a_path}" ] || return 1
  [ -f "${host_firmware_b_path}" ] || return 1
  [ -f "${host_rootfs_path}" ] || return 1
  [ -f "${guest_images_dir}/Image" ] || return 1
  [ -f "${guest_images_dir}/rootfs.cpio" ] || return 1
  [ -f "${guest_images_dir}/rootfs.cpio.gz" ] || return 1
  [ -f "${guest_qemu_dir}/bin/qemu-system-aarch64" ] || return 1
  [ -f "${launch_script}" ] || return 1
  [ -f "${hoststack_launch_script}" ] || return 1
  if [ "${use_linaro_helper}" = "true" ]; then
    [ -f "${l2_shared_image}" ] || return 1
    [ -f "${l2_shared_initrd}" ] || return 1
    [ -f "${l2_shared_guest_disk}" ] || return 1
    [ -f "${l2_shared_kvmtool_efi}" ] || return 1
    [ -f "${l2_shared_qemu_efi}" ] || return 1
    [ -f "${l2_shared_cfg}" ] || return 1
  fi
}

require_file "${qemu}" "host qemu binary"
require_file "${l1_kernel}" "l1 kernel image"
require_file "${l1_firmware_a}" "l1 firmware a"
require_file "${l1_firmware_b}" "l1 firmware b"
require_file "${buildroot_initrd_plain}" "buildroot plain initramfs"
require_file "${buildroot_initrd}" "buildroot initramfs"
require_file "${buildroot_rootfs}" "buildroot l1 rootfs image"
require_file "${guest_kernel_image_source}" "l2 kernel image"
require_file "${guest_qemu_source}" "l2 guest qemu"
validate_guest_qemu_profile_free
if [ "${use_linaro_helper}" = "true" ]; then
  require_file "${buildroot_initrd_plain}" "buildroot plain initramfs"
  require_file "${buildroot_gen_run_vmm}" "buildroot gen-run-vmm.sh"
  require_file "${buildroot_realm_measurements}" "buildroot realm-measurements"
  require_file "${buildroot_lkvm}" "buildroot lkvm"
  require_file "${qemu_edk2}" "qemu edk2 firmware"
  require_file "${l2_guest_disk}" "l2 guest disk"
  require_file "${l2_kvmtool_efi}" "l2 kvmtool efi"
fi

current_fingerprint="$(compute_inputs_fingerprint)"

if [ "${reuse_build_dir}" = "true" ] && state_matches "${current_fingerprint}"; then
  cat > "${result_file}" <<EOF
{"details":{"build_dir":"${build_dir}","install_dir":"${install_dir}","state_file":"${state_file}","share_dir":"${l1_dir}","reused":true},"artifacts":[{"path":"prepared-state","location":"${state_file}"},{"path":"share-dir","location":"${l1_dir}"}]}
EOF
  exit 0
fi

rm -rf "${l1_dir}" "${install_dir}"
mkdir -p \
  "${host_boot_dir}" \
  "${host_firmware_dir}" \
  "${host_rootfs_dir}" \
  "${guest_images_dir}" \
  "${guest_qemu_dir}/bin" \
  "${guest_qemu_dir}/share" \
  "${install_dir}"
if [ "${use_linaro_helper}" = "true" ]; then
  mkdir -p \
    "${l2_shared_qemu_efi_dir}" \
    "${l2_shared_kvmtool_efi_dir}"
fi

cp -f "${l1_kernel}" "${host_boot_dir}/Image"
cp -f "${l1_firmware_a}" "${host_firmware_a_path}"
cp -f "${l1_firmware_b}" "${host_firmware_b_path}"
cp -f "${buildroot_rootfs}" "${host_rootfs_path}"
cp -f "${guest_kernel_image_source}" "${guest_images_dir}/Image"
cp -f "${buildroot_initrd_plain}" "${guest_images_dir}/rootfs.cpio"
cp -f "${buildroot_initrd}" "${guest_images_dir}/rootfs.cpio.gz"
cp -f "${guest_qemu_source}" "${guest_qemu_dir}/bin/qemu-system-aarch64"
chmod +x "${guest_qemu_dir}/bin/qemu-system-aarch64"

if [ -d "${buildroot_guest_qemu_data_dir}" ]; then
  cp -a "${buildroot_guest_qemu_data_dir}" "${guest_qemu_dir}/share/"
fi
if [ "${use_linaro_helper}" = "true" ]; then
  cp -f "${guest_kernel_image_source}" "${l2_shared_image}"
  cp -f "${buildroot_initrd_plain}" "${l2_shared_initrd}"
  cp -f "${l2_guest_disk}" "${l2_shared_guest_disk}"
  cp -f "${l2_kvmtool_efi}" "${l2_shared_kvmtool_efi}"
  cp -f "${l2_kvmtool_efi}" "${l2_shared_kvmtool_build_efi}"
  cp -f "${qemu_edk2}" "${l2_shared_qemu_efi}"
  cp -f "${buildroot_lkvm}" "${l2_shared_lkvm}"
  cp -f "${guest_qemu_source}" "${l2_shared_qemu_binary}"
  chmod +x "${l2_shared_lkvm}" "${l2_shared_qemu_binary}"
  inject_morpheus_rsi_evidence_into_initrd "${l2_shared_initrd}"
  gzip -9 -c -n "${l2_shared_initrd}" > "${l2_shared_initrd_gz}"
  cp -f "${l2_shared_initrd_gz}" "${guest_images_dir}/rootfs.cpio.gz"
  cat > "${l2_shared_cfg}" <<'EOF'
KERNEL=/mnt/Image
INITRD=/mnt/rootfs.cpio
EDK2_DIR=/mnt/
RUN_DISK=/mnt/guest-disk.img
EOF
fi

if [ "${use_linaro_helper}" = "true" ]; then
  cat > "${launch_script}" <<'EOF'
#!/bin/sh
set -eu

if [ "${MORPHEUS_L2_SHELL_TRACE:-0}" = "1" ]; then
  # Keep the command and source line visible in launch-l2.stderr.log.  The
  # parent stub already captures this stream, so tracing remains observational.
  PS4='+ ${0}:${LINENO}: '
  if [ -n "${BASH_VERSION:-}" ]; then
    set -E
    trap 'morpheus_status=$?; printf "shell-error file=%s line=%s status=%s command=%s\n" "${BASH_SOURCE[0]:-$0}" "${LINENO:-?}" "$morpheus_status" "${BASH_COMMAND:-?}" >&2' ERR
    trap 'morpheus_status=$?; printf "shell-exit file=%s status=%s\n" "${BASH_SOURCE[0]:-$0}" "$morpheus_status" >&2' EXIT
  else
    trap 'morpheus_status=$?; printf "shell-exit file=%s status=%s\n" "$0" "$morpheus_status" >&2' 0
  fi
  set -x
fi

runtime_dir="${MORPHEUS_L2_RUNTIME_DIR:-/mnt/morpheus-l2-runtime}"
helper_cfg="${MORPHEUS_L2_GEN_RUN_VMM_CFG:-/mnt/gen-run-vmm.cfg}"
launch_marker="${runtime_dir}/launch-l2.marker"
guest_qemu_stdout="${runtime_dir}/qemu.stdout.log"
guest_qemu_stderr="${runtime_dir}/qemu.stderr.log"

if [ ! -d "${runtime_dir}" ]; then
  mkdir -p "${runtime_dir}"
fi
: > "${guest_qemu_stdout}"
: > "${guest_qemu_stderr}"
printf 'script-start\n' > "${launch_marker}"
printf 'launch-mode=linaro-gen-run-vmm\n' >> "${launch_marker}"
printf 'helper-cfg=%s\n' "${helper_cfg}" >> "${launch_marker}"
printf 'helper-cmd=gen-run-vmm.sh --tap --serial\n' >> "${launch_marker}"

if [ ! -x /usr/bin/gen-run-vmm.sh ]; then
  echo "missing /usr/bin/gen-run-vmm.sh in l1 host rootfs" >&2
  exit 1
fi
if [ ! -x /usr/bin/realm-measurements ]; then
  echo "missing /usr/bin/realm-measurements in l1 host rootfs" >&2
  exit 1
fi
for path in \
  "${helper_cfg}" \
  /mnt/Image \
  /mnt/rootfs.cpio \
  /mnt/guest-disk.img \
  /mnt/Build/ArmVirtQemu-AARCH64/DEBUG_GCC5/FV/QEMU_EFI.fd; do
  if [ ! -f "${path}" ]; then
    echo "missing l2 launch input: ${path}" >&2
    exit 1
  fi
done
if [ ! -d /sys/class/net/macvtap0 ]; then
  echo "missing /sys/class/net/macvtap0 for gen-run-vmm.sh --tap" >&2
  exit 1
fi

printf 'qemu-patch-symbols=absent\n' >> "${launch_marker}"
printf 'qemu-mmio-trace=stock\n' >> "${launch_marker}"
printf 'qemu-exec-start\n' >> "${launch_marker}"
set +e
(
  cd "${runtime_dir}"
  env CFG="${helper_cfg}" /usr/bin/gen-run-vmm.sh --tap --serial
) >> "${guest_qemu_stdout}" 2>> "${guest_qemu_stderr}"
qemu_status="$?"
set -e
printf 'qemu-exit-status=%s\n' "${qemu_status}" >> "${launch_marker}"
exit "${qemu_status}"
EOF
else
  cat > "${launch_script}" <<'EOF'
#!/bin/sh
set -eu

if [ "${MORPHEUS_L2_SHELL_TRACE:-0}" = "1" ]; then
  # Keep the command and source line visible in launch-l2.stderr.log.  The
  # parent stub already captures this stream, so tracing remains observational.
  PS4='+ ${0}:${LINENO}: '
  if [ -n "${BASH_VERSION:-}" ]; then
    set -E
    trap 'morpheus_status=$?; printf "shell-error file=%s line=%s status=%s command=%s\n" "${BASH_SOURCE[0]:-$0}" "${LINENO:-?}" "$morpheus_status" "${BASH_COMMAND:-?}" >&2' ERR
    trap 'morpheus_status=$?; printf "shell-exit file=%s status=%s\n" "${BASH_SOURCE[0]:-$0}" "$morpheus_status" >&2' EXIT
  else
    trap 'morpheus_status=$?; printf "shell-exit file=%s status=%s\n" "$0" "$morpheus_status" >&2' 0
  fi
  set -x
fi

runtime_dir="${MORPHEUS_L2_RUNTIME_DIR:-/mnt/morpheus-l2-runtime}"
guest_image_dir="${MORPHEUS_L2_GUEST_IMAGE_DIR:-/mnt/guest-images}"
printf 'inner-start\n' >> "${runtime_dir}/launch-l2.marker"
guest_qemu="/mnt/guest-qemu/bin/qemu-system-aarch64"
guest_qemu_data_dir="/mnt/guest-qemu/share/qemu"
guest_realm_measurements="/usr/bin/realm-measurements"
guest_realm_configs_dir="/usr/share/cca-realm-measurements/configs"
guest_virtio_transport="__MORPHEUS_L2_VIRTIO_TRANSPORT__"
guest_l2_accel="${MORPHEUS_L2_ACCEL:-auto}"
guest_l2_cpu="${MORPHEUS_L2_CPU:-}"
guest_l2_smp="${MORPHEUS_L2_SMP:-1}"
guest_l2_memory_mb="${MORPHEUS_L2_MEMORY_MB:-1024}"
guest_virtio_serial_device="virtio-serial-pci"
guest_virtio_net_device="virtio-net-pci,netdev=net0,romfile=''"
guest_bootargs="console=hvc0 oops=panic panic_on_warn=1 panic=-1 kasan.fault=panic"
launch_marker="${runtime_dir}/launch-l2.marker"
guest_qemu_trace_events="${runtime_dir}/morpheus-qemu-trace-events.txt"
guest_qemu_trace_log="${runtime_dir}/morpheus-qemu-trace.log"
guest_qemu_dtb="${runtime_dir}/qemu-gen.dtb"
guest_qemu_stdout="${runtime_dir}/qemu.stdout.log"
guest_qemu_stderr="${runtime_dir}/qemu.stderr.log"
guest_qemu_trace_enabled="true"
guest_device_backend="${MORPHEUS_VIRTIO_DEVICE_BACKEND:-stock}"
guest_device_backend_path="${MORPHEUS_VIRTIO_DEVICE_BACKEND_PATH:-/mnt/libafl_device_backend}"
guest_device_backend_pid=""
guest_device_backend_socket="${runtime_dir}/virtio-seed-backend.sock"

if [ "${guest_virtio_transport}" = "mmio" ]; then
  guest_virtio_net_device="virtio-net-device,netdev=net0"
  guest_bootargs="console=ttyAMA0 oops=panic panic_on_warn=1 panic=-1 kasan.fault=panic"
fi

if [ ! -d "${runtime_dir}" ]; then
  mkdir -p "${runtime_dir}"
fi
printf 'inner-after-mkdir\n' >> "${launch_marker}"
: > "${guest_qemu_stdout}"
: > "${guest_qemu_stderr}"
printf 'inner-after-log-open\n' >> "${launch_marker}"
printf 'script-start\n' >> "${launch_marker}"
printf 'launch-mode=direct-qemu\n' >> "${launch_marker}"

if [ "${guest_l2_accel}" = "auto" ]; then
  if [ -e /dev/kvm ]; then
    guest_l2_accel="kvm"
  else
    guest_l2_accel="tcg"
  fi
fi
case "${guest_l2_accel}" in
  kvm)
    guest_l2_cpu="${guest_l2_cpu:-host}"
    ;;
  tcg)
    guest_l2_cpu="${guest_l2_cpu:-cortex-a57}"
    if [ "${guest_l2_cpu}" = "host" ]; then
      guest_l2_cpu="cortex-a57"
    fi
    ;;
  *)
    echo "unsupported L2 accelerator: ${guest_l2_accel}" >&2
    exit 1
    ;;
esac
case "${guest_l2_cpu}" in
  host|max|cortex-a57) ;;
  *)
    echo "unsupported L2 CPU: ${guest_l2_cpu}" >&2
    exit 1
    ;;
esac
case "${guest_l2_smp}" in
  ''|*[!0-9]*|0)
    echo "MORPHEUS_L2_SMP must be a positive integer" >&2
    exit 1
    ;;
esac
case "${guest_l2_memory_mb}" in
  ''|*[!0-9]*|0)
    echo "MORPHEUS_L2_MEMORY_MB must be an integer" >&2
    exit 1
    ;;
esac
if [ "${guest_l2_memory_mb}" -lt 256 ] || [ "${guest_l2_memory_mb}" -gt 65536 ]; then
  echo "MORPHEUS_L2_MEMORY_MB must be between 256 and 65536 MB" >&2
  exit 1
fi
printf 'l2-accel=%s\n' "${guest_l2_accel}" >> "${launch_marker}"
printf 'l2-cpu=%s\n' "${guest_l2_cpu}" >> "${launch_marker}"
printf 'l2-smp=%s\n' "${guest_l2_smp}" >> "${launch_marker}"
printf 'l2-memory-mb=%s\n' "${guest_l2_memory_mb}" >> "${launch_marker}"

if [ ! -x "${guest_qemu}" ]; then
  echo "missing qemu-system-aarch64 in host share: ${guest_qemu}" >&2
  exit 1
fi
if [ ! -f "${guest_image_dir}/rootfs.cpio" ]; then
  echo "missing plain initrd in host share: ${guest_image_dir}/rootfs.cpio" >&2
  exit 1
fi
if [ "${guest_l2_accel}" = "kvm" ] && [ ! -e /dev/kvm ]; then
  echo "missing /dev/kvm for l2 cvm launch" >&2
  exit 1
fi
if [ ! -x "${guest_realm_measurements}" ]; then
  echo "missing realm-measurements in l1 host rootfs: ${guest_realm_measurements}" >&2
  exit 1
fi
for path in \
  "${guest_realm_configs_dir}/qemu-max-8.2.conf" \
  "${guest_realm_configs_dir}/kvm.conf"; do
  if [ ! -f "${path}" ]; then
    echo "missing realm-measurements config: ${path}" >&2
    exit 1
  fi
done

# Stock CCA QEMU already exposes the generic virtio-mmio trace events.  Keep
# tracing enabled for every run so the report contains the complete transport
# stream even when no QEMU patch is present.
: > "${guest_qemu_trace_events}"
printf 'virtio_mmio_read\n' >> "${guest_qemu_trace_events}"
printf 'virtio_mmio_write_offset\n' >> "${guest_qemu_trace_events}"

case "${guest_device_backend}" in
  stock|vhost-user) ;;
  *)
    echo "unsupported MORPHEUS_VIRTIO_DEVICE_BACKEND: ${guest_device_backend}" >&2
    exit 1
    ;;
esac

guest_seed_device=""
probe_vhost_user_capabilities() {
  local device_help
  local object_help

  if ! device_help="$("${guest_qemu}" -device help 2>&1)"; then
    echo "failed to query QEMU device capabilities" >&2
    exit 1
  fi
  case "${device_help}" in
    *"name \"${guest_seed_device}\""*) ;;
    *)
      echo "QEMU lacks required device: ${guest_seed_device}" >&2
      exit 1
      ;;
  esac

  if ! object_help="$("${guest_qemu}" -object help 2>&1)"; then
    echo "failed to query QEMU object capabilities" >&2
    exit 1
  fi
  case "${object_help}" in
    *"memory-backend-memfd"*) ;;
    *)
      echo "QEMU lacks shared memory-backend-memfd support" >&2
      exit 1
      ;;
  esac
  printf 'device-capability-probe=passed device=%s memory=memfd-support\n' \
    "${guest_seed_device}" >> "${launch_marker}"
}

stop_guest_device_backend() {
  if [ -n "${guest_device_backend_pid}" ]; then
    kill "${guest_device_backend_pid}" 2>/dev/null || true
    wait "${guest_device_backend_pid}" 2>/dev/null || true
    guest_device_backend_pid=""
  fi
}

start_guest_device_backend() {
  if [ ! -x "${guest_device_backend_path}" ]; then
    echo "missing seed device backend: ${guest_device_backend_path}" >&2
    exit 1
  fi
  if [ -z "${MORPHEUS_QEMU_INPUT_PATH:-}" ]; then
    echo "vhost-user device backend requires MORPHEUS_QEMU_INPUT_PATH" >&2
    exit 1
  fi
  if [ -e "${guest_device_backend_socket}" ]; then
    rm -f "${guest_device_backend_socket}"
  fi
  "${guest_device_backend_path}" \
    --socket "${guest_device_backend_socket}" \
    --input "${MORPHEUS_QEMU_INPUT_PATH}" \
    --trace "${guest_qemu_trace_log}" \
    --log "${runtime_dir}/virtio-seed-backend.log" \
    >>"${guest_qemu_stdout}" 2>>"${guest_qemu_stderr}" &
  guest_device_backend_pid="$!"
  trap stop_guest_device_backend EXIT
  for _ in $(seq 1 100); do
    if [ -S "${guest_device_backend_socket}" ]; then
      break
    fi
    if ! kill -0 "${guest_device_backend_pid}" 2>/dev/null; then
      echo "seed device backend exited before opening its socket" >&2
      exit 1
    fi
    sleep 0.01
  done
  if [ ! -S "${guest_device_backend_socket}" ]; then
    echo "timed out waiting for seed device backend socket" >&2
    exit 1
  fi
  printf 'device-backend=vhost-user path=%s socket=%s\n' \
    "${guest_device_backend_path}" "${guest_device_backend_socket}" >> "${launch_marker}"
}

if [ "${guest_device_backend}" = "vhost-user" ]; then
  if [ "${guest_virtio_transport}" = "mmio" ]; then
    guest_seed_device="vhost-user-test-device"
  else
    guest_seed_device="vhost-user-test-device-pci"
  fi
  probe_vhost_user_capabilities
  start_guest_device_backend
else
  guest_seed_device=""
fi

set -- \
  -L "${guest_qemu_data_dir}"

if [ "${guest_virtio_transport}" = "mmio" ]; then
  # Nested KVM cannot reliably route virtio-mmio ioeventfds through the
  # Realm boundary. Keep queue notifications in QEMU and use the modern
  # transport interface expected by the MMIO-only L2 kernel.
  set -- "$@" \
    -global "virtio-mmio.force-legacy=off" \
    -global "virtio-mmio.ioeventfd=off"
fi

if [ "${guest_qemu_trace_enabled}" = "true" ]; then
  set -- "$@" \
    -trace "events=${guest_qemu_trace_events},file=${runtime_dir}/morpheus-qemu-trace.log"
fi

set -- "$@" \
  -M "confidential-guest-support=rme0" \
  -object "rme-guest,id=rme0" \
  -cpu "${guest_l2_cpu}" \
  -M virt \
  -M "gic-version=3,its=on" \
  -smp "${guest_l2_smp}" \
  -nographic \
  -nodefaults \
  -chardev "stdio,mux=on,id=chr0,signal=off" \
  -serial "chardev:chr0" \
  -mon "chardev=chr0,mode=readline" \
  -dtb "${guest_qemu_dtb}" \
  -kernel "${guest_image_dir}/Image" \
  -initrd "${guest_image_dir}/rootfs.cpio" \
  -append "${guest_bootargs}"

if [ "${guest_device_backend}" = "vhost-user" ]; then
  set -- "$@" \
    -m "${guest_l2_memory_mb}M" \
    -object "memory-backend-memfd,id=seed-mem,size=${guest_l2_memory_mb}M,share=on" \
    -numa "node,memdev=seed-mem" \
    -chardev "socket,id=seed-backend,path=${guest_device_backend_socket},server=off" \
    -device "${guest_seed_device},chardev=seed-backend,virtio-id=1,num_vqs=3,vq_size=256,config_size=24"
else
  set -- "$@" \
    -m "${guest_l2_memory_mb}M" \
    -netdev "user,id=net0" \
    -device "${guest_virtio_net_device}"
fi

if [ "${guest_l2_accel}" = "kvm" ]; then
  set -- "$@" -enable-kvm
else
  set -- "$@" -accel tcg
fi

if [ "${guest_virtio_transport}" != "mmio" ]; then
  set -- "$@" \
    -device "${guest_virtio_serial_device}" \
    -device "virtconsole,chardev=chr0"
fi

rm -f "${guest_qemu_dtb}"
printf 'dtb-generator=realm-measurements\n' >> "${launch_marker}"
set +e
"${guest_realm_measurements}" \
  -c "${guest_realm_configs_dir}/qemu-max-8.2.conf" \
  -c "${guest_realm_configs_dir}/kvm.conf" \
  -k "${guest_image_dir}/Image" \
  -i "${guest_image_dir}/rootfs.cpio" \
  --no-measurements \
  --output-dtb "${guest_qemu_dtb}" \
  qemu \
  "$@" >> "${guest_qemu_stderr}" 2>> "${guest_qemu_stderr}"
dtb_status="$?"
set -e
if [ "${dtb_status}" -ne 0 ]; then
  printf 'dtb-exit-status=%s\n' "${dtb_status}" >> "${launch_marker}"
  exit "${dtb_status}"
fi
if [ ! -s "${guest_qemu_dtb}" ]; then
  echo "failed to generate realm dtb: ${guest_qemu_dtb}" >&2
  exit 1
fi
printf 'dtb-generated=%s\n' "${guest_qemu_dtb}" >> "${launch_marker}"

# realm-measurements may instantiate the vhost-user device while generating
# the DTB. Recreate the backend connection for the real L2 QEMU launch.
if [ "${guest_device_backend}" = "vhost-user" ]; then
  stop_guest_device_backend
  start_guest_device_backend
fi

set -- "${guest_qemu}" "$@"

printf 'qemu-cmd=' >> "${launch_marker}"
printf '%s ' "$@" >> "${launch_marker}"
printf '\n' >> "${launch_marker}"
printf 'qemu-patch-symbols=absent\n' >> "${launch_marker}"
printf 'qemu-mmio-trace=stock\n' >> "${launch_marker}"
printf 'qemu-exec-start\n' >> "${launch_marker}"
set +e
"$@" >> "${guest_qemu_stdout}" 2>> "${guest_qemu_stderr}"
qemu_status="$?"
set -e
printf 'qemu-exit-status=%s\n' "${qemu_status}" >> "${launch_marker}"
if [ "${guest_device_backend}" = "vhost-user" ]; then
  backend_log="${runtime_dir}/virtio-seed-backend.log"
  backend_rx_actions="$(
    sed -n 's/^backend-ready rx-actions=\([0-9][0-9]*\) .*/\1/p' \
      "${backend_log}" 2>/dev/null | head -n 1
  )"
  if grep -q '^memory-probe=passed ' "${backend_log}" 2>/dev/null; then
    printf 'device-memory-probe=passed memory=guest-addressable\n' \
      >> "${launch_marker}"
  elif grep -q '^memory-probe=failed ' "${backend_log}" 2>/dev/null; then
    printf 'device-memory-probe=failed memory=unavailable\n' \
      >> "${launch_marker}"
    qemu_status=1
  elif grep -q '^memory-table=received ' "${backend_log}" 2>/dev/null; then
    printf 'device-memory-probe=incomplete memory=unknown\n' \
      >> "${launch_marker}"
    qemu_status=1
  else
    case "${backend_rx_actions}" in
      0)
        # A config-only replay can terminate before vhost-user starts its
        # virtqueues. Do not turn that valid path into a false memory failure.
        printf 'device-memory-probe=not-required memory=not-probed\n' \
          >> "${launch_marker}"
        ;;
      '')
        printf 'device-memory-probe=unknown memory=unavailable\n' \
          >> "${launch_marker}"
        qemu_status=1
        ;;
      *)
        # RX actions require the backend to access the descriptor and payload
        # buffers. If QEMU never sends a memory table, fail closed.
        printf 'device-memory-probe=required-but-not-probed memory=unavailable\n' \
          >> "${launch_marker}"
        qemu_status=1
        ;;
    esac
  fi
  if grep -q '^queue-processing-failed ' "${backend_log}" 2>/dev/null; then
    printf 'device-queue=failed reason=backend-processing\n' \
      >> "${launch_marker}"
    qemu_status=1
  elif grep -q '^rx-complete ' "${backend_log}" 2>/dev/null; then
    printf 'device-queue=completed\n' >> "${launch_marker}"
  elif [ -n "${backend_rx_actions}" ] && [ "${backend_rx_actions}" -gt 0 ]; then
    printf 'device-queue=required-but-not-completed\n' \
      >> "${launch_marker}"
    qemu_status=1
  else
    printf 'device-queue=not-observed\n' >> "${launch_marker}"
  fi
fi
stop_guest_device_backend
trap - EXIT
exit "${qemu_status}"
EOF
  perl -0pi -e 's/__MORPHEUS_L2_VIRTIO_TRANSPORT__/'"${l2_virtio_transport}"'/g' "${launch_script}"
fi
chmod +x "${launch_script}"

if [ "${use_linaro_helper}" = "true" ]; then
  cat > "${hoststack_launch_script}" <<'EOF'
#!/bin/sh
set -eu

if [ "${MORPHEUS_L2_SHELL_TRACE:-0}" = "1" ]; then
  # Trace the host-stack prelude and the exact exec that enters the inner
  # launcher.  This is deliberately log-only and does not affect control flow.
  PS4='+ ${0}:${LINENO}: '
  if [ -n "${BASH_VERSION:-}" ]; then
    set -E
    trap 'morpheus_status=$?; printf "shell-error file=%s line=%s status=%s command=%s\n" "${BASH_SOURCE[0]:-$0}" "${LINENO:-?}" "$morpheus_status" "${BASH_COMMAND:-?}" >&2' ERR
    trap 'morpheus_status=$?; printf "shell-exit file=%s status=%s\n" "${BASH_SOURCE[0]:-$0}" "$morpheus_status" >&2' EXIT
  else
    trap 'morpheus_status=$?; printf "shell-exit file=%s status=%s\n" "$0" "$morpheus_status" >&2' 0
  fi
  set -x
fi
PATH="/usr/sbin:/usr/bin:/sbin:/bin${PATH:+:${PATH}}"
runtime_dir="${MORPHEUS_L2_RUNTIME_DIR:-/mnt/morpheus-l2-runtime}"
mount -o remount,rw / 2>/dev/null || true
mount -t proc proc /proc 2>/dev/null || true
mount -t sysfs sysfs /sys 2>/dev/null || true
mount -t devpts devpts /dev/pts 2>/dev/null || true
mount -t tmpfs -o mode=1777 tmpfs /dev/shm 2>/dev/null || true
mount -t tmpfs -o mode=0755,nosuid,nodev tmpfs /run 2>/dev/null || true
mount -t tmpfs -o mode=1777 tmpfs /tmp 2>/dev/null || true
if [ ! -d /run/lock/subsys ]; then
  mkdir -p /run/lock/subsys
fi
[ -L /dev/fd ] || ln -sf /proc/self/fd /dev/fd
[ -L /dev/stdin ] || ln -sf /proc/self/fd/0 /dev/stdin
[ -L /dev/stdout ] || ln -sf /proc/self/fd/1 /dev/stdout
[ -L /dev/stderr ] || ln -sf /proc/self/fd/2 /dev/stderr
[ -f /etc/hostname ] && /bin/hostname -F /etc/hostname || true
[ -x /etc/init.d/S40network ] && /etc/init.d/S40network start || true
[ -x /sbin/ip ] && [ -d /sys/class/net/eth0 ] && /sbin/ip link set eth0 up || true
[ -x /etc/init.d/S50macvtap ] && [ ! -d /sys/class/net/macvtap0 ] && /etc/init.d/S50macvtap start || true
if [ ! -d "${runtime_dir}" ]; then
  mkdir -p "${runtime_dir}"
fi
export MORPHEUS_L2_RUNTIME_DIR="${runtime_dir}"
export MORPHEUS_L2_GEN_RUN_VMM_CFG="${MORPHEUS_L2_GEN_RUN_VMM_CFG:-/mnt/gen-run-vmm.cfg}"
/mnt/launch-l2.sh
EOF
else
  cat > "${hoststack_launch_script}" <<'EOF'
#!/bin/sh
set -eu

if [ "${MORPHEUS_L2_SHELL_TRACE:-0}" = "1" ]; then
  # Trace the host-stack prelude and the exact exec that enters the inner
  # launcher.  This is deliberately log-only and does not affect control flow.
  PS4='+ ${0}:${LINENO}: '
  if [ -n "${BASH_VERSION:-}" ]; then
    set -E
    trap 'morpheus_status=$?; printf "shell-error file=%s line=%s status=%s command=%s\n" "${BASH_SOURCE[0]:-$0}" "${LINENO:-?}" "$morpheus_status" "${BASH_COMMAND:-?}" >&2' ERR
    trap 'morpheus_status=$?; printf "shell-exit file=%s status=%s\n" "${BASH_SOURCE[0]:-$0}" "$morpheus_status" >&2' EXIT
  else
    trap 'morpheus_status=$?; printf "shell-exit file=%s status=%s\n" "$0" "$morpheus_status" >&2' 0
  fi
  set -x
fi
runtime_dir="${MORPHEUS_L2_RUNTIME_DIR:-/mnt/morpheus-l2-runtime}"
if [ ! -d "${runtime_dir}" ]; then
  mkdir -p "${runtime_dir}"
fi
printf 'hoststack-start\n' > "${runtime_dir}/launch-l2.marker"
printf 'hoststack-before-inner-exec\n' >> "${runtime_dir}/launch-l2.marker"
export MORPHEUS_L2_RUNTIME_DIR="${runtime_dir}"
export MORPHEUS_L2_GUEST_IMAGE_DIR="${MORPHEUS_L2_GUEST_IMAGE_DIR:-/mnt/guest-images}"
/mnt/launch-l2.sh
EOF
fi
chmod +x "${hoststack_launch_script}"

profile_sha256="$(sha256sum "${host_boot_dir}/Image" | awk '{print $1}')"
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

node - "${state_file}" "${build_dir_key}" "${build_dir}" "${install_dir}" "${current_fingerprint}" "${qemu}" "${host_firmware_a_path}" "${host_firmware_b_path}" "${host_boot_dir}/Image" "${host_rootfs_path}" "${l1_dir}" "${launch_script}" "${hoststack_launch_script}" "${guest_images_dir}/Image" "${guest_images_dir}/rootfs.cpio" "${buildroot_vmlinux}" "${guest_qemu_dir}/bin/qemu-system-aarch64" "${buildroot_inputs_fingerprint}" "${profile_sha256}" "${l1_machine}" "${l1_cpu}" "${l1_cmdline}" "${l1_memory}" "${l1_cpus}" "${use_linaro_helper}" "${l2_shared_cfg}" "${l2_shared_image}" "${l2_shared_initrd}" "${l2_shared_guest_disk}" "${l2_shared_qemu_efi}" "${l2_shared_kvmtool_efi}" "${l2_virtio_transport}" <<'NODE'
const fs = require("fs");
const path = require("path");
const [
  stateFile,
  buildDirKey,
  buildDir,
  installDir,
  inputsFingerprint,
  hostQemu,
  firmwareA,
  firmwareB,
  l1Kernel,
  l1Rootfs,
  shareDir,
  launchScript,
  hoststackLaunchScript,
  l2Image,
  l2Initrd,
  l2Vmlinux,
  l2Qemu,
  buildrootInputsFingerprint,
  profileSha256,
  l1Machine,
  l1Cpu,
  l1Cmdline,
  l1Memory,
  l1Cpus,
  useLinaroHelperRaw,
  l2HelperCfg,
  l2ShareImage,
  l2ShareInitrd,
  l2GuestDisk,
  l2QemuEfi,
  l2KvmtoolEfi,
  l2VirtioTransport,
] = process.argv.slice(2);
const buildrootOutputDir = path.dirname(path.dirname(l2Image));
const now = new Date().toISOString();
const useLinaroHelper = useLinaroHelperRaw === "true";
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
    firmware: firmwareA,
    firmwareA,
    firmwareB,
    kernel: l1Kernel,
    machine: l1Machine,
    cpu: l1Cpu,
    cmdline: l1Cmdline,
    memory: String(l1Memory),
    cpus: String(l1Cpus),
    accel: "",
    enableKvm: false,
  },
  layeredState: {
    l1: {
      rootfs: l1Rootfs,
      shareDir,
      launchScript,
      launchScriptHoststack: hoststackLaunchScript,
    },
    l2: {
      mode: "cvm",
      cvm: true,
      buildrootImages: {
        launchMode: useLinaroHelper ? "linaro-gen-run-vmm" : "direct-qemu",
        outputDir: buildrootOutputDir,
        image: l2Image,
        initrd: l2Initrd,
        vmlinux: fs.existsSync(l2Vmlinux) ? l2Vmlinux : null,
        qemu: l2Qemu,
        helperCfg: fs.existsSync(l2HelperCfg) ? l2HelperCfg : null,
        shareImage: fs.existsSync(l2ShareImage) ? l2ShareImage : null,
        shareInitrd: fs.existsSync(l2ShareInitrd) ? l2ShareInitrd : null,
        guestDisk: fs.existsSync(l2GuestDisk) ? l2GuestDisk : null,
        qemuEfi: fs.existsSync(l2QemuEfi) ? l2QemuEfi : null,
        kvmtoolEfi: fs.existsSync(l2KvmtoolEfi) ? l2KvmtoolEfi : null,
        virtioTransport: l2VirtioTransport,
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
