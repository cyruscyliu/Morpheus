#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/../../_shared/scripts/parallelism.sh"

state_file=""
run_dir=""
boot_command=""
omit_qemu="false"
with_network="true"
kernel_append=()
extra_qemu_args=()
l1_cpus_override=""

usage() {
  cat >&2 <<'EOF'
usage: l1-launch.sh --state <state.json> --run-dir <dir> \
  --boot-command <command> [--omit-qemu] [--without-network] \
  [--l1-cpus <count>] \
  [--kernel-append <arg>]... [--qemu-arg <arg>]...
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --state)
      state_file="${2:?missing value for --state}"
      shift 2
      ;;
    --run-dir)
      run_dir="${2:?missing value for --run-dir}"
      shift 2
      ;;
    --boot-command)
      boot_command="${2:?missing value for --boot-command}"
      shift 2
      ;;
    --kernel-append)
      kernel_append+=("${2:?missing value for --kernel-append}")
      shift 2
      ;;
    --qemu-arg)
      extra_qemu_args+=("${2:?missing value for --qemu-arg}")
      shift 2
      ;;
    --omit-qemu)
      omit_qemu="true"
      shift
      ;;
    --without-network)
      with_network="false"
      shift
      ;;
    --l1-cpus)
      l1_cpus_override="${2:?missing value for --l1-cpus}"
      shift 2
      ;;
    --help)
      usage
      exit 0
      ;;
    *)
      echo "unsupported nvirsh L1 launch argument: $1" >&2
      usage
      exit 1
      ;;
  esac
done

[ -n "${state_file}" ] || { echo "missing --state" >&2; exit 1; }
[ -n "${run_dir}" ] || { echo "missing --run-dir" >&2; exit 1; }
[ -n "${boot_command}" ] || { echo "missing --boot-command" >&2; exit 1; }
[ -f "${state_file}" ] || { echo "missing prepared state: ${state_file}" >&2; exit 1; }

mapfile -d '' -t state_fields < <(
  node - "${state_file}" <<'NODE'
const fs = require("fs");

const state = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
if (state.tool !== "nvirsh-buildroot-based-cvm") {
  throw new Error(`unsupported prepared state tool: ${String(state.tool || "")}`);
}

const host = state.hostLaunch && typeof state.hostLaunch === "object"
  ? state.hostLaunch
  : {};
const l1 = state.layeredState && state.layeredState.l1
  ? state.layeredState.l1
  : {};
const values = [
  String(host.qemu || ""),
  String(host.firmwareA || host.firmware || ""),
  String(host.firmwareB || ""),
  String(host.kernel || ""),
  String(host.machine || "sbsa-ref"),
  String(host.cpu || "max,x-rme=on,sme=off,pauth-impdef=on,sve=off"),
  String(host.memory || ""),
  String(host.cpus || ""),
  String(host.accel || ""),
  String(Boolean(host.enableKvm)),
  String(host.cmdline || "root=/dev/vda console=ttyAMA0"),
  String(l1.rootfs || ""),
  String(l1.shareDir || ""),
];
process.stdout.write(values.join("\0"));
process.stdout.write("\0");
NODE
)

host_qemu="${state_fields[0]:-}"
firmware_a="${state_fields[1]:-}"
firmware_b="${state_fields[2]:-}"
l1_kernel="${state_fields[3]:-}"
l1_machine="${state_fields[4]:-}"
l1_cpu="${state_fields[5]:-}"
l1_memory="${state_fields[6]:-}"
l1_cpus="${state_fields[7]:-}"
if [ -z "${l1_cpus}" ]; then
  l1_cpus="$(morpheus_default_cvm_l1_qemu_cpus)"
fi
if [ -z "${l1_memory}" ]; then
  l1_memory="$(morpheus_default_cvm_l1_qemu_memory_mb)"
fi
if [ -n "${l1_cpus_override}" ]; then
  if ! [[ "${l1_cpus_override}" =~ ^[1-9][0-9]*$ ]]; then
    echo "--l1-cpus must be a positive integer" >&2
    exit 1
  fi
  l1_cpus="$(morpheus_resolve_l1_qemu_cpus "${l1_cpus_override}")"
fi
l1_accel="${state_fields[8]:-}"
l1_enable_kvm="${state_fields[9]:-false}"
l1_cmdline="${state_fields[10]:-}"
hoststack_rootfs="${state_fields[11]:-}"
hoststack_share_dir="${state_fields[12]:-}"

require_file() {
  local path="$1"
  local description="$2"
  if [ ! -f "${path}" ]; then
    echo "missing ${description}: ${path}" >&2
    exit 1
  fi
}

sanitize_bootargs() {
  printf '%s\n' "$1" \
    | sed \
        -e 's/\<BOOT_IMAGE=[^ ]*//g' \
        -e 's/\<init=[^ ]*//g' \
        -e 's/  */ /g' \
        -e 's/^ //' \
        -e 's/ $//'
}

if [ "${omit_qemu}" != "true" ]; then
  require_file "${host_qemu}" "host qemu"
fi
require_file "${firmware_a}" "l1 firmware a"
if [ -n "${firmware_b}" ]; then
  require_file "${firmware_b}" "l1 firmware b"
fi
require_file "${l1_kernel}" "l1 kernel"
require_file "${hoststack_rootfs}" "l1 host stack rootfs"
if [ ! -d "${hoststack_share_dir}" ]; then
  echo "missing host share directory: ${hoststack_share_dir}" >&2
  exit 1
fi

mkdir -p "${run_dir}"
l1_boot_cmdline="$(sanitize_bootargs "${l1_cmdline}")"
for append in "${kernel_append[@]}"; do
  l1_boot_cmdline="${l1_boot_cmdline} ${append}"
done
l1_boot_cmdline="${l1_boot_cmdline} init=/bin/sh -- -c \"${boot_command}\""

l1_qemu_cmd=()
if [ "${omit_qemu}" != "true" ]; then
  l1_qemu_cmd+=("${host_qemu}")
fi
l1_qemu_cmd+=(
  -display none
  -nographic
  -nodefaults
  -serial mon:stdio
  -action panic=exit-failure
  -machine "${l1_machine}"
  -cpu "${l1_cpu}"
  -m "${l1_memory}"
  -smp "${l1_cpus}"
  -drive "format=raw,id=hd0,if=none,file=${hoststack_rootfs}"
  -device virtio-blk-pci,drive=hd0
  -device virtio-9p-pci,fsdev=hostshare,mount_tag=host
  -fsdev "local,security_model=none,path=${hoststack_share_dir},id=hostshare"
)
if [ "${with_network}" = "true" ]; then
  l1_qemu_cmd+=(
    # The L1 kernel used by this workflow has e1000 enabled but no
    # virtio-net driver.  An e1000 NIC gives the host stack an eth0 so the
    # nested L2 slirp can reach the outer user-mode gateway.
    -device e1000,netdev=net0
    -netdev user,id=net0
  )
fi

if [ -n "${firmware_b}" ]; then
  l1_boot_dir="${run_dir}/l1-boot-fat"
  rm -rf "${l1_boot_dir}"
  mkdir -p "${l1_boot_dir}"
  cp -f "${l1_kernel}" "${l1_boot_dir}/Image"
  cat > "${l1_boot_dir}/startup.nsh" <<EOF
mode 100 31
pci
fs0:\\Image ${l1_boot_cmdline}
reset -c
EOF
  l1_qemu_cmd+=(
    -drive "file=${firmware_a},format=raw,if=pflash"
    -drive "file=${firmware_b},format=raw,if=pflash"
    -drive "file=fat:rw:${l1_boot_dir},format=raw"
  )
else
  l1_qemu_cmd+=(
    -bios "${firmware_a}"
    -kernel "${l1_kernel}"
    -append "${l1_boot_cmdline}"
  )
fi

if [ -n "${l1_accel}" ]; then
  l1_qemu_cmd+=(-accel "${l1_accel}")
fi
if [ "${l1_enable_kvm}" = "true" ]; then
  l1_qemu_cmd+=(-enable-kvm)
fi
l1_qemu_cmd+=("${extra_qemu_args[@]}")

printf '%s\0' "${l1_qemu_cmd[@]}"
