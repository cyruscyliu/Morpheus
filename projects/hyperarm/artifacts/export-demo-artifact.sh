#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "${script_dir}/../../.." && pwd)"
cd "${repo_root}"

config="$("${repo_root}/projects/hyperarm/scripts/config-path.sh")"
workflow_name="nvirsh-aarch64-libafl-nesting-injected-bug-fuzz"
workflow_run_id=""
link_mode="copy"
prepare="false"
force="false"
output_dir=""

usage() {
  cat <<'EOF'
Usage:
  projects/hyperarm/artifacts/export-demo-artifact.sh
    [--output-dir PATH]
    [--workflow-run-id RUN_ID]
    [--link-mode copy|hardlink|symlink]
    [--prepare]
    [--force]

Extract the final `libafl_exec` step inputs from a successful HyperArm fuzz
workflow run and write a runnable bundle under
`projects/hyperarm/artifacts/out/`.
The exported bundle is provisioned already and can fuzz directly without
Morpheus itself.

Options:
  --workflow-run-id  Use a specific successful workflow run. Default:
                     latest successful
                     `nvirsh-aarch64-libafl-nesting-injected-bug-fuzz` run.
  --prepare    Run the managed fuzz workflow first to refresh the source run.
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
    --workflow-run-id)
      shift
      workflow_run_id="${1:-}"
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

[ -f "${config}" ] || die "missing config: ${config}"
workspace_root="$("${repo_root}/projects/hyperarm/scripts/workspace-root.sh" --config "${config}")"

if [ -z "${output_dir}" ]; then
  stamp="$(date -u +%Y%m%dT%H%M%SZ)"
  output_dir="projects/hyperarm/artifacts/out/hyperarm-demo-${stamp}"
fi

if [ "${prepare}" = "true" ]; then
  ./bin/morpheus --config "${config}" workflow run --name "${workflow_name}"
fi

if [ -z "${workflow_run_id}" ]; then
  workflow_run_id="$(
    find "${workspace_root}/runs" -maxdepth 2 -name workflow.json -print0 \
      | xargs -0 jq -r \
        'select(.workflow=="'"${workflow_name}"'" and .status=="success") | [.createdAt,.id] | @tsv' 2>/dev/null \
      | sort \
      | tail -n 1 \
      | cut -f2
  )"
fi
[ -n "${workflow_run_id}" ] || die "no successful ${workflow_name} run found"

run_root="${workspace_root}/runs/${workflow_run_id}"
workflow_file="${run_root}/workflow.json"
libafl_exec_step="${run_root}/steps/libafl_exec/step.json"
libafl_build_step="${run_root}/steps/libafl_build/step.json"
nvirsh_build_step="${run_root}/steps/nvirsh_build/step.json"

[ -f "${workflow_file}" ] || die "missing workflow manifest: ${workflow_file}"
[ -f "${libafl_exec_step}" ] || die "missing libafl_exec step: ${libafl_exec_step}"
[ -f "${libafl_build_step}" ] || die "missing libafl_build step: ${libafl_build_step}"
[ -f "${nvirsh_build_step}" ] || die "missing nvirsh_build step: ${nvirsh_build_step}"

readarray -t exec_fields < <(
  node - "${libafl_exec_step}" "${libafl_build_step}" "${nvirsh_build_step}" <<'NODE'
const fs = require("fs");
const path = require("path");
const [execStepPath, buildStepPath, nvirshStepPath] = process.argv.slice(2);
const execStep = JSON.parse(fs.readFileSync(execStepPath, "utf8"));
const buildStep = JSON.parse(fs.readFileSync(buildStepPath, "utf8"));
const nvirshStep = JSON.parse(fs.readFileSync(nvirshStepPath, "utf8"));
const buildArtifacts = new Map((buildStep.artifacts || []).map((a) => [a.path, a.location]));
const nvirshArtifacts = new Map((nvirshStep.artifacts || []).map((a) => [a.path, a.location]));
const args = execStep.resolvedInputs?.["harness-arg"] || [];
function argValue(name, fallback = "") {
  const index = args.indexOf(name);
  return index >= 0 && index + 1 < args.length ? String(args[index + 1]) : fallback;
}
function hasArg(name) {
  return args.includes(name);
}
const seedInput = argValue("--seed-input", "");
const harnessScript = execStep.resolvedInputs?.["harness-script"] || "";
const stateFile = argValue("--nvirsh-state", nvirshArtifacts.get("prepared-state") || "");
const qemuBridgeDir = buildArtifacts.get("qemu-bridge-dir") || "";
const qemuBundleDir = qemuBridgeDir
  ? path.join(qemuBridgeDir, "build/qemu-bundle/usr/local/share/qemu")
  : "";
process.stdout.write(
  [
    stateFile,
    buildArtifacts.get("qemu-nesting-fuzzer") || "",
    buildArtifacts.get("guest-stub-binary") || "",
    qemuBundleDir,
    seedInput,
    harnessScript,
    argValue("--l2-accel", "tcg"),
    argValue("--l2-cpu", "cortex-a57"),
    argValue("--l2-run-window-ms", "120000"),
    hasArg("--disable-nqc2-plugin") ? "true" : "false",
  ].join("\n") + "\n"
);
NODE
)

state_file="${exec_fields[0]}"
fuzzer_bin="${exec_fields[1]}"
stub_elf="${exec_fields[2]}"
qemu_bundle_dir="${exec_fields[3]}"
seed_input="${exec_fields[4]}"
harness_script="${exec_fields[5]}"
default_l2_accel="${exec_fields[6]}"
default_l2_cpu="${exec_fields[7]}"
default_l2_run_window_ms="${exec_fields[8]}"
default_disable_nqc2_plugin="${exec_fields[9]}"
if [ ! -f "${seed_input}" ]; then
  for candidate in \
    "${run_root}/${seed_input}" \
    "${repo_root}/${seed_input}" \
    "${workspace_root}/${seed_input}"; do
    if [ -f "${candidate}" ]; then
      seed_input="${candidate}"
      break
    fi
  done
fi
seed_dir="$(dirname "${seed_input}")"

[ -f "${state_file}" ] || die "missing prepared nvirsh state: ${state_file}"
[ -x "${fuzzer_bin}" ] || die "missing qemu_nesting binary: ${fuzzer_bin}"
[ -f "${stub_elf}" ] || die "missing guest stub: ${stub_elf}"
[ -d "${qemu_bundle_dir}" ] || die "missing QEMU bundle: ${qemu_bundle_dir}"
[ -f "${seed_input}" ] || die "missing seed input: ${seed_input}"

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
[ -n "${provisioned_overlay_image}" ] || die \
  "prepared nvirsh state does not include a provisioned overlay image"
[ -f "${provisioned_overlay_image}" ] || die "missing provisioned overlay image: ${provisioned_overlay_image}"
[ -n "${l1_build_dir}" ] || die "missing nvirsh l1 build dir in prepared state"

guest_stub_in_state="$(
  node -e 'const fs=require("fs"); const s=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(String(s.layeredState?.l1?.guestStubSource || ""));' \
    "${state_file}"
)"
[ -n "${guest_stub_in_state}" ] || die \
  "prepared nvirsh state does not include the LibAFL guest stub; run with --prepare or refresh the replay workflow first"
[ -f "${guest_stub_in_state}" ] || die \
  "prepared nvirsh state references a missing guest stub source: ${guest_stub_in_state}"

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
materialize "${guest_stub_in_state}" "${output_dir}/bin/libafl_nesting_stub"
materialize "${firmware}" "${output_dir}/firmware/edk2-aarch64-code.fd"
materialize "${provisioned_overlay_image}" "${output_dir}/disk/overlay.qcow2"
materialize "${qemu_bundle_dir}" "${output_dir}/share/qemu"
materialize "${seed_dir}" "${output_dir}/seeds"
cp -a "${state_file}" "${output_dir}/metadata/nvirsh-state.json"
cp -a "${workflow_file}" "${output_dir}/metadata/workflow.json"
cp -a "${libafl_exec_step}" "${output_dir}/metadata/libafl-exec-step.json"
if [ -f "${harness_script}" ]; then
  cp -a "${harness_script}" "${output_dir}/metadata/libafl-harness-exec.sh"
fi
cat > "${output_dir}/metadata/exec-input.json" <<EOF
{
  "workflow": "${workflow_name}",
  "workflowRunId": "${workflow_run_id}",
  "stateFile": "${state_file}",
  "fuzzerBinary": "${fuzzer_bin}",
  "guestStub": "${guest_stub_in_state}",
  "qemuBundleDir": "${qemu_bundle_dir}",
  "seedInput": "${seed_input}",
  "harnessScript": "${harness_script}",
  "l2Accel": "${default_l2_accel}",
  "l2Cpu": "${default_l2_cpu}",
  "l2RunWindowMs": "${default_l2_run_window_ms}",
  "disableNqc2Plugin": ${default_disable_nqc2_plugin}
}
EOF
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
# HyperArm Fuzz Bundle

This bundle was extracted from Morpheus-managed HyperArm artifacts.
It already contains the provisioned L1 overlay and can fuzz directly without
running Morpheus or a separate provisioning step.

Source run:

- workflow: \`${workflow_name}\`
- run id: \`${workflow_run_id}\`

Usage:

\`\`\`bash
./run-fuzz.sh --minutes 5
\`\`\`

Files:

- \`bin/qemu_nesting\`
- \`bin/libafl_nesting_stub\`
- \`disk/overlay.qcow2\`
- \`firmware/edk2-aarch64-code.fd\`
- \`share/qemu/\`
- \`seeds/\`
EOF

cat > "${output_dir}/run-fuzz.sh" <<EOF
#!/usr/bin/env bash
set -euo pipefail

bundle_dir="\$(cd "\$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
seconds=""
l2_run_window_ms=""
l2_accel="${default_l2_accel}"
l2_cpu="${default_l2_cpu}"
disable_nqc2_plugin="${default_disable_nqc2_plugin}"
run_dir=""

usage() {
  cat <<'EOH'
Usage:
  ./run-fuzz.sh --seconds N
  ./run-fuzz.sh --minutes N
  ./run-fuzz.sh --hours N
    [--l2-run-window-ms N]
    [--l2-accel auto|kvm|tcg]
    [--l2-cpu host|max|cortex-a57]
    [--enable-nqc2-plugin]
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
    --l2-accel)
      shift
      l2_accel="\${1:-}"
      ;;
    --l2-cpu)
      shift
      l2_cpu="\${1:-}"
      ;;
    --enable-nqc2-plugin)
      disable_nqc2_plugin="false"
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
if [ -z "\${l2_run_window_ms}" ]; then
  l2_run_window_ms="${default_l2_run_window_ms}"
fi
[[ "\${l2_run_window_ms}" =~ ^[0-9]+$ ]] || die "l2-run-window-ms must be an integer"
[ "\${l2_run_window_ms}" -ge 1000 ] || die "l2-run-window-ms must be at least 1000"
[ "\${l2_run_window_ms}" -le 900000 ] || die "l2-run-window-ms must be at most 900000"
case "\${l2_accel}" in auto|kvm|tcg) ;; *) die "--l2-accel must be one of: auto, kvm, tcg" ;; esac
case "\${l2_cpu}" in host|max|cortex-a57) ;; *) die "--l2-cpu must be one of: host, max, cortex-a57" ;; esac

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
seed_manifest="\${run_dir}/seed-inputs.txt"
corpus_dir="\${run_dir}/corpus"
objective_dir="\${run_dir}/crashes"
libafl_l1_smp="\${MORPHEUS_LIBAFL_L1_SMP:-1}"

[ -x "\${fuzzer_bin}" ] || die "missing fuzzer binary: \${fuzzer_bin}"
[ -f "\${stub_elf}" ] || die "missing guest stub: \${stub_elf}"
[ -f "\${firmware}" ] || die "missing firmware: \${firmware}"
[ -f "\${overlay_image}" ] || die "missing overlay image: \${overlay_image}"
[ -d "\${qemu_bundle_dir}" ] || die "missing QEMU bundle: \${qemu_bundle_dir}"
[ -f "\${bundle_dir}/seeds/$(basename "${seed_input}")" ] || die "missing bundled seed: \${bundle_dir}/seeds/$(basename "${seed_input}")"

mkdir -p "\${corpus_dir}" "\${objective_dir}"
printf '%s\n' "\${bundle_dir}/seeds/$(basename "${seed_input}")" > "\${seed_manifest}"

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
copy_overlay() {
  local src="\$1"
  local dst="\$2"
  mkdir -p "\$(dirname "\${dst}")"
  cp --reflink=auto "\${src}" "\${dst}"
}

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
echo "l2_run_window_ms=\${l2_run_window_ms}"
echo "l2_accel=\${l2_accel}"
echo "l2_cpu=\${l2_cpu}"
echo "disable_nqc2_plugin=\${disable_nqc2_plugin}"

end_time=\$((SECONDS + seconds))
attempt=1
while [ "\${SECONDS}" -lt "\${end_time}" ]; do
  attempt_dir="\${run_dir}/attempt-\$(printf '%04d' "\${attempt}")"
  attempt_overlay="\${attempt_dir}/overlay.qcow2"
  broker_port=\$((1341 + (attempt % 2000)))
  mkdir -p "\${attempt_dir}"
  rm -f "\${attempt_overlay}"
  copy_overlay "\${overlay_image}" "\${attempt_overlay}"

  direct_l1_append_attempt="\${direct_l1_append} init=/root/libafl_nesting_stub norandmaps rw"
  args=(
    -machine virt,virtualization=on,gic-version=3
    -cpu "${l1_cpu}"
    -m "${l1_memory}"
    -smp "\${libafl_l1_smp}"
    -nographic
    -drive "file=\${attempt_overlay},if=virtio,format=qcow2"
    -L "\${qemu_bundle_dir}"
  )
  if [ "\${disable_nqc2_plugin}" = "true" ]; then
    direct_l1_append_attempt="\${direct_l1_append_attempt} morpheus.l2_disable_nqc2_plugin=1"
    args+=(
      -fw_cfg "name=opt/morpheus/l2-disable-nqc2-plugin,string=1"
      -smbios "type=11,value=morpheus.l2_disable_nqc2_plugin=1"
    )
  fi
  direct_l1_append_attempt="\${direct_l1_append_attempt} morpheus.l2_run_window_ms=\${l2_run_window_ms} morpheus.l2_accel=\${l2_accel} morpheus.l2_cpu=\${l2_cpu}"
  args+=(
    -fw_cfg "name=opt/morpheus/l2-run-window-ms,string=\${l2_run_window_ms}"
    -smbios "type=11,value=morpheus.l2_run_window_ms=\${l2_run_window_ms}"
    -fw_cfg "name=opt/morpheus/l2-accel,string=\${l2_accel}"
    -smbios "type=11,value=morpheus.l2_accel=\${l2_accel}"
    -fw_cfg "name=opt/morpheus/l2-cpu,string=\${l2_cpu}"
    -smbios "type=11,value=morpheus.l2_cpu=\${l2_cpu}"
  )
  if [ -f "\${direct_l1_kernel}" ] && [ -f "\${direct_l1_initrd}" ]; then
    args+=(-kernel "\${direct_l1_kernel}" -initrd "\${direct_l1_initrd}" -append "\${direct_l1_append_attempt}")
  else
    args+=(-bios "\${firmware}")
  fi

  echo "starting attempt \${attempt}" | tee -a "\${run_dir}/raw-run.log"
  echo "broker_port=\${broker_port}" | tee -a "\${run_dir}/raw-run.log"
  echo "attempt_overlay=\${attempt_overlay}" | tee -a "\${run_dir}/raw-run.log"
  setsid env \
    "BROKER_PORT=\${broker_port}" \
    "STUB=\${stub_elf}" \
    "MORPHEUS_LIBAFL_CORPUS_DIR=\${corpus_dir}" \
    "MORPHEUS_LIBAFL_OBJECTIVE_DIR=\${objective_dir}" \
    "MORPHEUS_LIBAFL_INITIAL_INPUTS=\${seed_manifest}" \
    "MORPHEUS_LIBAFL_L2_RUN_WINDOW_MS=\${l2_run_window_ms}" \
    "\${fuzzer_bin}" "\${args[@]}" \
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
chmod +x "${output_dir}/run-fuzz.sh"

cat > "${output_dir}/metadata/export.json" <<EOF
{
  "schemaVersion": 1,
  "source": "morpheus-managed-hyperarm",
  "linkMode": "${link_mode}",
  "bundleDir": "${output_dir}",
  "workflow": "${workflow_name}",
  "workflowRunId": "${workflow_run_id}",
  "firmware": "firmware/edk2-aarch64-code.fd",
  "overlayImage": "disk/overlay.qcow2",
  "overlayImageSource": "${provisioned_overlay_image}",
  "qemuBundleDir": "share/qemu",
  "fuzzerBinary": "bin/qemu_nesting",
  "guestStub": "bin/libafl_nesting_stub",
  "defaultSeed": "seeds/$(basename "${seed_input}")",
  "harnessScript": "${harness_script}",
  "l1Cpu": "${l1_cpu}",
  "l1Memory": "${l1_memory}",
  "l1Smp": "${l1_smp}"
}
EOF

printf 'bundle=%s\n' "${output_dir}"
