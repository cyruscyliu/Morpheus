#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "${script_dir}/../../.." && pwd)"
cd "${repo_root}"

config="projects/hyperarm/morpheus.yaml"
cache_root="${repo_root}/.cache/hyperarm"
link_mode="copy"
prepare="false"
force="false"
output_dir=""

usage() {
  cat <<'EOF'
Usage:
  projects/hyperarm/artifacts/export-demo-artifact.sh
    [--output-dir PATH]
    [--link-mode copy|hardlink|symlink]
    [--prepare]
    [--force]

Extract a clean runnable demo bundle from the current Morpheus-managed
HyperArm artifacts and write it under `projects/hyperarm/artifacts/out/`.
The exported bundle requires an L1 image prepared with the LibAFL guest stub.

Options:
  --prepare    Run the managed replay workflow first to refresh the demo state.
  --force      Replace an existing output directory.
EOF
}

die() {
  echo "error: $*" >&2
  exit 1
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --output-dir)
      shift
      output_dir="${1:-}"
      ;;
    --link-mode)
      shift
      link_mode="${1:-}"
      ;;
    --prepare)
      prepare="true"
      ;;
    --force)
      force="true"
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      die "unknown argument: $1"
      ;;
  esac
  shift
done

case "${link_mode}" in
  copy|hardlink|symlink) ;;
  *) die "--link-mode must be one of: copy, hardlink, symlink" ;;
esac

if [ -z "${output_dir}" ]; then
  stamp="$(date -u +%Y%m%dT%H%M%SZ)"
  output_dir="projects/hyperarm/artifacts/out/hyperarm-demo-${stamp}"
fi

if [ "${prepare}" = "true" ]; then
  ./bin/morpheus --config "${config}" workflow run --name nvirsh-aarch64-libafl-nesting-injected-bug
fi

state_file="${cache_root}/tools/nvirsh/builds/qemu-debian-arm64/install/state.json"
install_dir="${cache_root}/tools/libafl/builds/libafl-main/install"
fuzzer_bin="${install_dir}/bin/qemu_nesting"
stub_elf="${install_dir}/bin/libafl_nesting_stub"
qemu_bundle_dir="${cache_root}/tools/libafl/builds/libafl-main/build/qemu-libafl-bridge/build/qemu-bundle/usr/local/share/qemu"
seed_dir="projects/hyperarm/workspace/tools/libafl/seeds/qemu_nesting"

[ -f "${state_file}" ] || die "missing prepared nvirsh state: ${state_file}"
[ -x "${fuzzer_bin}" ] || die "missing qemu_nesting binary: ${fuzzer_bin}"
[ -f "${stub_elf}" ] || die "missing guest stub: ${stub_elf}"
[ -d "${qemu_bundle_dir}" ] || die "missing QEMU bundle: ${qemu_bundle_dir}"
[ -d "${seed_dir}" ] || die "missing seed directory: ${seed_dir}"

readarray -t state_fields < <(
  node - "${state_file}" <<'NODE'
const fs = require("fs");
const state = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const firmware = state.hostLaunch?.firmware || "";
const overlay = state.hostLaunch?.overlayImage || "";
const provisionedOverlay = state.hostLaunch?.provisionedOverlayImage || "";
const buildDir = state.buildDir || "";
const l1Args = Array.isArray(state.profileData?.l1?.launcherArgs)
  ? state.profileData.l1.launcherArgs
  : [];
let cpu = "cortex-a57";
let memory = "8192";
let smp = "4";
for (let i = 0; i < l1Args.length - 1; i += 1) {
  if (l1Args[i] === "-cpu") cpu = String(l1Args[i + 1]);
  if (l1Args[i] === "-m") memory = String(l1Args[i + 1]);
  if (l1Args[i] === "-smp") smp = String(l1Args[i + 1]);
}
process.stdout.write(
  `${firmware}\n${overlay}\n${provisionedOverlay}\n${cpu}\n${memory}\n${smp}\n${buildDir}\n`
);
NODE
)

firmware="${state_fields[0]}"
overlay_image="${state_fields[1]}"
provisioned_overlay_image="${state_fields[2]}"
l1_cpu="${state_fields[3]}"
l1_memory="${state_fields[4]}"
l1_smp="${state_fields[5]}"
l1_build_dir="${state_fields[6]}"
l1_host_boot_dir="${l1_build_dir}/l1/host-boot"

[ -f "${firmware}" ] || die "missing firmware: ${firmware}"
[ -f "${overlay_image}" ] || die "missing overlay image: ${overlay_image}"
if [ -n "${provisioned_overlay_image}" ]; then
  [ -f "${provisioned_overlay_image}" ] || die "missing provisioned overlay image: ${provisioned_overlay_image}"
else
  provisioned_overlay_image="${overlay_image}"
fi
[ -n "${l1_build_dir}" ] || die "missing nvirsh l1 build dir in prepared state"

guest_stub_in_state="$(
  node -e 'const fs=require("fs"); const s=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(String(s.layeredState?.l1?.guestStubSource || ""));' \
    "${state_file}"
)"
[ -n "${guest_stub_in_state}" ] || die \
  "prepared nvirsh state does not include the LibAFL guest stub; run with --prepare or refresh the replay workflow first"

if [ -e "${output_dir}" ]; then
  if [ "${force}" = "true" ]; then
    rm -rf "${output_dir}"
  else
    die "output directory already exists: ${output_dir}"
  fi
fi

mkdir -p "${output_dir}"
mkdir -p "${output_dir}/metadata"

materialize() {
  local src="$1"
  local dst="$2"
  mkdir -p "$(dirname "${dst}")"
  case "${link_mode}" in
    copy)
      cp -a --reflink=auto "${src}" "${dst}"
      ;;
    hardlink)
      cp -al "${src}" "${dst}"
      ;;
    symlink)
      ln -s "$(realpath "${src}")" "${dst}"
      ;;
  esac
}

materialize "${fuzzer_bin}" "${output_dir}/bin/qemu_nesting"
materialize "${stub_elf}" "${output_dir}/bin/libafl_nesting_stub"
materialize "${firmware}" "${output_dir}/firmware/edk2-aarch64-code.fd"
materialize "${provisioned_overlay_image}" "${output_dir}/disk/overlay.qcow2"
materialize "${qemu_bundle_dir}" "${output_dir}/share/qemu"
materialize "${seed_dir}" "${output_dir}/seeds"
cp -a "${state_file}" "${output_dir}/metadata/nvirsh-state.json"
if [ -d "${l1_host_boot_dir}" ]; then
  if [ -f "${l1_host_boot_dir}/vmlinuz" ]; then
    materialize "${l1_host_boot_dir}/vmlinuz" "${output_dir}/boot/vmlinuz"
  fi
  if [ -f "${l1_host_boot_dir}/initrd.img" ]; then
    materialize "${l1_host_boot_dir}/initrd.img" "${output_dir}/boot/initrd.img"
  fi
  if [ -f "${l1_host_boot_dir}/cmdline.txt" ]; then
    materialize "${l1_host_boot_dir}/cmdline.txt" "${output_dir}/boot/cmdline.txt"
  fi
fi

cat > "${output_dir}/README.md" <<EOF
# HyperArm Demo Bundle

This bundle was extracted from Morpheus-managed HyperArm artifacts.

Usage:

\`\`\`bash
./run-demo.sh --minutes 5
\`\`\`

Files:

- \`bin/qemu_nesting\`
- \`bin/libafl_nesting_stub\`
- \`disk/overlay.qcow2\`
- \`firmware/edk2-aarch64-code.fd\`
- \`share/qemu/\`
- \`seeds/\`
EOF

cat > "${output_dir}/run-demo.sh" <<EOF
#!/usr/bin/env bash
set -euo pipefail

bundle_dir="\$(cd "\$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
seconds=""
l2_run_window_ms=""
run_dir=""

usage() {
  cat <<'EOH'
Usage:
  ./run-demo.sh --seconds N
  ./run-demo.sh --minutes N
  ./run-demo.sh --hours N
    [--l2-run-window-ms N]
    [--run-dir PATH]
EOH
}

die() {
  echo "error: \$*" >&2
  exit 1
}

while [ "\$#" -gt 0 ]; do
  case "\$1" in
    --seconds)
      shift
      seconds="\${1:-}"
      ;;
    --minutes)
      shift
      minutes="\${1:-}"
      [[ "\${minutes}" =~ ^[0-9]+$ ]] || die "--minutes requires an integer"
      seconds=\$((minutes * 60))
      ;;
    --hours)
      shift
      hours="\${1:-}"
      [[ "\${hours}" =~ ^[0-9]+$ ]] || die "--hours requires an integer"
      seconds=\$((hours * 3600))
      ;;
    --l2-run-window-ms)
      shift
      l2_run_window_ms="\${1:-}"
      ;;
    --run-dir)
      shift
      run_dir="\${1:-}"
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      die "unknown argument: \$1"
      ;;
  esac
  shift
done

[ -n "\${seconds}" ] || die "choose one of --seconds, --minutes, or --hours"
[[ "\${seconds}" =~ ^[0-9]+$ ]] || die "timeout must be an integer"
[ "\${seconds}" -gt 0 ] || die "timeout must be greater than zero"
if [ -n "\${l2_run_window_ms}" ]; then
  [[ "\${l2_run_window_ms}" =~ ^[0-9]+$ ]] || die "l2-run-window-ms must be an integer"
  [ "\${l2_run_window_ms}" -ge 1000 ] || die "l2-run-window-ms must be at least 1000"
  [ "\${l2_run_window_ms}" -le 900000 ] || die "l2-run-window-ms must be at most 900000"
fi

if [ -z "\${run_dir}" ]; then
  run_dir="\${bundle_dir}/runs/\$(date -u +%Y%m%dT%H%M%SZ)"
fi
mkdir -p "\${run_dir}"

fuzzer_bin="\${bundle_dir}/bin/qemu_nesting"
stub_elf="\${bundle_dir}/bin/libafl_nesting_stub"
qemu_bundle_dir="\${bundle_dir}/share/qemu"
firmware="\${bundle_dir}/firmware/edk2-aarch64-code.fd"
overlay_image="\${bundle_dir}/disk/overlay.qcow2"
direct_l1_kernel="\${bundle_dir}/boot/vmlinuz"
direct_l1_initrd="\${bundle_dir}/boot/initrd.img"
direct_l1_cmdline="\${bundle_dir}/boot/cmdline.txt"
libafl_l1_smp="\${MORPHEUS_LIBAFL_L1_SMP:-1}"

[ -x "\${fuzzer_bin}" ] || die "missing fuzzer binary: \${fuzzer_bin}"
[ -f "\${stub_elf}" ] || die "missing guest stub: \${stub_elf}"
[ -f "\${firmware}" ] || die "missing firmware: \${firmware}"
[ -f "\${overlay_image}" ] || die "missing overlay image: \${overlay_image}"
[ -d "\${qemu_bundle_dir}" ] || die "missing QEMU bundle: \${qemu_bundle_dir}"

if [ -f "\${direct_l1_cmdline}" ]; then
  direct_l1_append="\$(
    sed \
      -e 's/\\<BOOT_IMAGE=[^ ]*//g' \
      -e 's/\\<init=[^ ]*//g' \
      -e 's/  */ /g' \
      -e 's/^ //' \
      -e 's/ \$//' \
      "\${direct_l1_cmdline}"
  )"
else
  direct_l1_append="root=PARTUUID=48bd50df-bfd1-4457-8648-8026f634af47 ro"
fi
direct_l1_append="\${direct_l1_append} init=/root/libafl_nesting_stub norandmaps rw"

args=(
  -machine virt,virtualization=on,gic-version=3
  -cpu "${l1_cpu}"
  -m "${l1_memory}"
  -smp "\${libafl_l1_smp}"
  -nographic
  -drive "file=\${overlay_image},if=virtio,format=qcow2"
  -L "\${qemu_bundle_dir}"
)
if [ -n "\${l2_run_window_ms}" ]; then
  direct_l1_append="\${direct_l1_append} morpheus.l2_run_window_ms=\${l2_run_window_ms}"
  args+=(
    -fw_cfg "name=opt/morpheus/l2-run-window-ms,string=\${l2_run_window_ms}"
    -smbios "type=11,value=morpheus.l2_run_window_ms=\${l2_run_window_ms}"
  )
fi
if [ -f "\${direct_l1_kernel}" ] && [ -f "\${direct_l1_initrd}" ]; then
  args+=(-kernel "\${direct_l1_kernel}" -initrd "\${direct_l1_initrd}" -append "\${direct_l1_append}")
else
  args+=(-bios "\${firmware}")
fi

kill_group() {
  local pid="\$1"
  [ -n "\${pid}" ] || return 0
  kill -TERM -- "-\${pid}" 2>/dev/null || true
  sleep 1
  kill -KILL -- "-\${pid}" 2>/dev/null || true
}

child_pid=""
trap 'kill_group "\${child_pid}"; exit 143' TERM INT

echo "run_dir=\${run_dir}"
echo "timeout_seconds=\${seconds}"
echo "prepared_l1_smp=${l1_smp}"
echo "effective_l1_smp=\${libafl_l1_smp}"
if [ -n "\${l2_run_window_ms}" ]; then
  echo "l2_run_window_ms=\${l2_run_window_ms}"
fi

end_time=\$((SECONDS + seconds))
attempt=1
while [ "\${SECONDS}" -lt "\${end_time}" ]; do
  echo "starting attempt \${attempt}" | tee -a "\${run_dir}/raw-run.log"
  setsid env "STUB=\${stub_elf}" "\${fuzzer_bin}" "\${args[@]}" \
    > >(tee -a "\${run_dir}/stdout.log") \
    2> >(tee -a "\${run_dir}/stderr.log" >&2) &
  child_pid="\$!"

  while [ "\${SECONDS}" -lt "\${end_time}" ] && kill -0 "\${child_pid}" 2>/dev/null; do
    if ps -o stat= --ppid "\${child_pid}" | grep -q 'Z'; then
      echo "defunct child detected; restarting" | tee -a "\${run_dir}/raw-run.log" >&2
      kill_group "\${child_pid}"
      break
    fi
    sleep 5
  done

  if [ "\${SECONDS}" -ge "\${end_time}" ]; then
    echo "timeout reached; stopping fuzzer" | tee -a "\${run_dir}/raw-run.log"
    kill_group "\${child_pid}"
    child_pid=""
    exit 0
  fi

  if wait "\${child_pid}"; then
    status=0
  else
    status="\$?"
  fi
  child_pid=""
  echo "fuzzer exited with status \${status}; restarting" | tee -a "\${run_dir}/raw-run.log" >&2
  attempt=\$((attempt + 1))
  sleep 1
done
EOF
chmod +x "${output_dir}/run-demo.sh"

cat > "${output_dir}/metadata/export.json" <<EOF
{
  "schemaVersion": 1,
  "source": "morpheus-managed-hyperarm",
  "linkMode": "${link_mode}",
  "bundleDir": "${output_dir}",
  "firmware": "firmware/edk2-aarch64-code.fd",
  "overlayImage": "disk/overlay.qcow2",
  "overlayImageSource": "${provisioned_overlay_image}",
  "qemuBundleDir": "share/qemu",
  "fuzzerBinary": "bin/qemu_nesting",
  "guestStub": "bin/libafl_nesting_stub",
  "l1Cpu": "${l1_cpu}",
  "l1Memory": "${l1_memory}",
  "l1Smp": "${l1_smp}"
}
EOF

printf 'bundle=%s\n' "${output_dir}"
