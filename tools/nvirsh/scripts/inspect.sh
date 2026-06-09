#!/usr/bin/env bash
set -euo pipefail

source_dir="${MORPHEUS_NVIRSH_SOURCE:?}"
run_dir="${MORPHEUS_NVIRSH_RUN_DIR:-}"
install_dir="${MORPHEUS_NVIRSH_INSTALL_DIR:-}"
build_dir="${MORPHEUS_NVIRSH_BUILD_DIR:-}"
profile_name="${MORPHEUS_NVIRSH_BUILD_VERSION:-default}"
build_dir_key="${MORPHEUS_NVIRSH_BUILD_DIR_KEY:-${profile_name}}"
result_file="${MORPHEUS_NVIRSH_RESULT_FILE:-${MORPHEUS_SCRIPT_RESULT_FILE:?}}"

guest_trace_out="${install_dir}/guest-nqc2.trace"
guest_qemu_trace_out="${install_dir}/guest-qemu-trace.log"
guest_kernel_vmlinux=""

manifest_file=""
if [ -n "${run_dir}" ] && [ -f "${run_dir}/manifest.json" ]; then
  manifest_file="${run_dir}/manifest.json"
elif [ -n "${install_dir}" ] && [ -f "${install_dir}/state.json" ]; then
  manifest_file="${install_dir}/state.json"
else
  manifest_file="${install_dir}/state.json"
fi

if [ ! -f "${manifest_file}" ]; then
  echo "missing nvirsh manifest: ${manifest_file}" >&2
  exit 1
fi

extract_guest_file() {
  local overlay="$1"
  local guest_path="$2"
  local output_path="$3"
  local tmp_dir tmp_raw tmp_part
  tmp_dir="${build_dir%/}/tmp"
  mkdir -p "${tmp_dir}"
  tmp_raw="$(mktemp --tmpdir="${tmp_dir}" nvirsh-overlay-XXXXXX.raw)"
  tmp_part="$(mktemp --tmpdir="${tmp_dir}" nvirsh-rootfs-XXXXXX.img)"
  cleanup() {
    rm -f "${tmp_raw}" "${tmp_part}"
  }
  trap cleanup RETURN
  qemu-img convert -O raw "${overlay}" "${tmp_raw}" >/dev/null 2>&1
  dd if="${tmp_raw}" of="${tmp_part}" bs=512 skip=262144 count=6027264 status=none
  if debugfs -R "cat ${guest_path}" "${tmp_part}" > "${output_path}" 2>/dev/null; then
    return 0
  fi
  rm -f "${output_path}"
  return 1
}

if [ -n "${build_dir}" ] && [ -f "${build_dir}/l0/overlay.qcow2" ]; then
  extract_guest_file "${build_dir}/l0/overlay.qcow2" "/root/morpheus-nqc2.trace" "${guest_trace_out}" || true
  extract_guest_file "${build_dir}/l0/overlay.qcow2" "/root/morpheus-qemu-trace.log" "${guest_qemu_trace_out}" || true
fi

if [ -n "${build_dir}" ]; then
  cache_root="${build_dir%%/tools/nvirsh/builds/*}"
  for candidate in "${cache_root}"/tools/buildroot/builds/*/output/build/linux-*/vmlinux; do
    if [ -f "${candidate}" ]; then
      guest_kernel_vmlinux="${candidate}"
      break
    fi
  done
fi

node - "${manifest_file}" "${source_dir}" "${run_dir}" "${build_dir}" "${install_dir}" "${profile_name}" "${build_dir_key}" "${result_file}" "${guest_trace_out}" "${guest_qemu_trace_out}" "${guest_kernel_vmlinux}" <<'NODE'
const fs = require('fs');
const [manifestFile, sourceDir, runDir, buildDir, installDir, profileName, buildDirKey, resultFile, guestTraceOut, guestQemuTraceOut, guestKernelVmlinux] = process.argv.slice(2);
const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
const details = {
  profile: profileName,
  build_dir_key: buildDirKey,
  source: sourceDir || null,
  build_dir: buildDir || null,
  install_dir: installDir || null,
  run_dir: runDir || null,
  manifest: manifestFile,
  status: manifest.status || 'unknown',
  current_phase: manifest.currentPhase || null,
  runtime_pid: manifest.runtime && manifest.runtime.pid != null ? manifest.runtime.pid : null,
  phases: manifest.phases || null,
  layered_state: manifest.layeredState || null,
  guest_nqc2_trace: fs.existsSync(guestTraceOut) ? guestTraceOut : null,
  guest_qemu_trace_log: fs.existsSync(guestQemuTraceOut) ? guestQemuTraceOut : null,
  guest_kernel_vmlinux: guestKernelVmlinux && fs.existsSync(guestKernelVmlinux) ? guestKernelVmlinux : null,
};
const artifacts = [
  ...(fs.existsSync(guestTraceOut) ? [{ path: 'guest-nqc2-trace', location: guestTraceOut }] : []),
  ...(fs.existsSync(guestQemuTraceOut) ? [{ path: 'guest-qemu-trace-log', location: guestQemuTraceOut }] : []),
  ...(guestKernelVmlinux && fs.existsSync(guestKernelVmlinux) ? [{ path: 'guest-kernel-vmlinux', location: guestKernelVmlinux }] : []),
];
fs.writeFileSync(resultFile, `${JSON.stringify({ details, artifacts }, null, 2)}\n`);
NODE
