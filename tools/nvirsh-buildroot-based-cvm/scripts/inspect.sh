#!/usr/bin/env bash
set -euo pipefail

install_dir="${MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_INSTALL_DIR:-}"
run_dir="${MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_RUN_DIR:-}"
build_dir_key="${MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_BUILD_DIR_KEY:-default}"
result_file="${MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_RESULT_FILE:-${MORPHEUS_SCRIPT_RESULT_FILE:?}}"
state_file="${install_dir}/state.json"
manifest_file=""

if [ -n "${run_dir}" ] && [ -f "${run_dir}/manifest.json" ]; then
  manifest_file="${run_dir}/manifest.json"
elif [ -f "${state_file}" ]; then
  manifest_file="${state_file}"
else
  echo "missing buildroot-based CVM manifest/state" >&2
  exit 1
fi

node - "${manifest_file}" "${state_file}" "${install_dir}" "${run_dir}" "${build_dir_key}" "${result_file}" <<'NODE'
const fs = require("fs");
const [
  manifestFile,
  stateFile,
  installDir,
  runDir,
  buildDirKey,
  resultFile,
] = process.argv.slice(2);
const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
const fallbackState = fs.existsSync(stateFile)
  ? JSON.parse(fs.readFileSync(stateFile, "utf8"))
  : null;
const layeredState = manifest.layeredState || (fallbackState ? fallbackState.layeredState : null);
const buildrootImages = layeredState && layeredState.l2 ? layeredState.l2.buildrootImages : null;
const details = {
  build_dir_key: buildDirKey,
  install_dir: installDir || null,
  run_dir: runDir || null,
  manifest: manifestFile,
  status: manifest.status || "unknown",
  current_phase: manifest.currentPhase || null,
  phases: manifest.phases || null,
  host_launch: manifest.hostLaunch || (fallbackState ? fallbackState.hostLaunch : null),
  layered_state: layeredState || null,
  runtime: manifest.runtime || null,
  logs: manifest.logs || null,
  guest_kernel_vmlinux: buildrootImages && buildrootImages.vmlinux ? buildrootImages.vmlinux : null,
  guest_kernel_image: buildrootImages && buildrootImages.image ? buildrootImages.image : null,
  guest_initrd: buildrootImages && buildrootImages.initrd ? buildrootImages.initrd : null,
  guest_qemu: buildrootImages && buildrootImages.qemu ? buildrootImages.qemu : null,
};
const artifacts = [];
if (details.guest_kernel_vmlinux && fs.existsSync(details.guest_kernel_vmlinux)) {
  artifacts.push({ path: "guest-kernel-vmlinux", location: details.guest_kernel_vmlinux });
}
if (details.guest_kernel_image && fs.existsSync(details.guest_kernel_image)) {
  artifacts.push({ path: "guest-kernel-image", location: details.guest_kernel_image });
}
if (details.guest_initrd && fs.existsSync(details.guest_initrd)) {
  artifacts.push({ path: "guest-initrd", location: details.guest_initrd });
}
if (details.guest_qemu && fs.existsSync(details.guest_qemu)) {
  artifacts.push({ path: "guest-qemu", location: details.guest_qemu });
}
fs.writeFileSync(resultFile, `${JSON.stringify({ details, artifacts }, null, 2)}\n`);
NODE
