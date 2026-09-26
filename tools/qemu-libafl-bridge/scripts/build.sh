#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/../../_shared/scripts/parallelism.sh"

repo_root="${MORPHEUS_REPO_ROOT:?missing MORPHEUS_REPO_ROOT}"
source_dir="${MORPHEUS_QEMU_LIBAFL_BRIDGE_SOURCE:?missing bridge source}"
build_dir="${MORPHEUS_QEMU_LIBAFL_BRIDGE_BUILD_DIR:?missing bridge build directory}"
install_dir="${MORPHEUS_QEMU_LIBAFL_BRIDGE_INSTALL_DIR:?missing bridge install directory}"
target_list_file="${MORPHEUS_QEMU_LIBAFL_BRIDGE_TARGET_LIST_FILE:-}"
configure_arg_file="${MORPHEUS_QEMU_LIBAFL_BRIDGE_CONFIGURE_ARG_FILE:-}"
target_list_raw="${MORPHEUS_QEMU_LIBAFL_BRIDGE_TARGET_LIST:-}"
configure_arg_raw="${MORPHEUS_QEMU_LIBAFL_BRIDGE_CONFIGURE_ARG:-}"
jobs="${MORPHEUS_QEMU_LIBAFL_BRIDGE_JOBS:-$(morpheus_default_jobs)}"
reuse_build_dir="${MORPHEUS_QEMU_LIBAFL_BRIDGE_REUSE_BUILD_DIR:-false}"
result_file="${MORPHEUS_QEMU_LIBAFL_BRIDGE_RESULT_FILE:-${MORPHEUS_SCRIPT_RESULT_FILE:?missing result file}}"
build_version="${MORPHEUS_QEMU_LIBAFL_BRIDGE_BUILD_VERSION:-}"
manifest_file="${build_dir}/manifest.json"
signature_file="${build_dir}/.morpheus-configure-signature"
bridge_lib="${build_dir}/libqemu-system-aarch64.so"
linkinfo_file="${build_dir}/linkinfo.json"
bundle_dir="${build_dir}/qemu-bundle/usr/local/share/qemu"
installed_lib="${install_dir}/lib/libqemu-system-aarch64.so"
installed_bundle="${install_dir}/share/qemu"

case "${source_dir}" in
  /*) ;;
  *) source_dir="${repo_root}/${source_dir#./}" ;;
esac
case "${build_dir}" in
  /*) ;;
  *) build_dir="$(pwd)/${build_dir#./}" ;;
esac
case "${install_dir}" in
  /*) ;;
  *) install_dir="$(pwd)/${install_dir#./}" ;;
esac
case "${result_file}" in
  /*) ;;
  *) result_file="$(pwd)/${result_file#./}" ;;
esac
manifest_file="${build_dir}/manifest.json"
signature_file="${build_dir}/.morpheus-configure-signature"
bridge_lib="${build_dir}/libqemu-system-aarch64.so"
linkinfo_file="${build_dir}/linkinfo.json"
bundle_dir="${build_dir}/qemu-bundle/usr/local/share/qemu"
installed_lib="${install_dir}/lib/libqemu-system-aarch64.so"
installed_bundle="${install_dir}/share/qemu"

[ -x "${source_dir}/configure" ] || {
  echo "missing executable configure script: ${source_dir}/configure" >&2
  exit 1
}
[ -x "${source_dir}/linker_interceptor.py" ] || {
  echo "missing LibAFL linker interceptor: ${source_dir}/linker_interceptor.py" >&2
  exit 1
}
[ -x "${source_dir}/linker_interceptor++.py" ] || {
  echo "missing LibAFL C++ linker interceptor: ${source_dir}/linker_interceptor++.py" >&2
  exit 1
}
source_version="$(tr -d '[:space:]' < "${source_dir}/VERSION" 2>/dev/null || true)"
if [ -n "${build_version}" ] && [ -n "${source_version}" ] && [ "${source_version}" != "${build_version}" ]; then
  echo "bridge source is QEMU ${source_version}, expected ${build_version}" >&2
  exit 1
fi
command -v make >/dev/null 2>&1 || {
  echo "make is required to build the LibAFL QEMU bridge" >&2
  exit 1
}

# The patch stage records the provider/base/local-patch provenance in this
# file.  A bridge build must not silently reuse a library produced from a
# different rebased source tree merely because its configure arguments are
# unchanged.
bridge_provenance_file="${source_dir}/.morpheus-bridge.json"
[ -f "${bridge_provenance_file}" ] || {
  echo "missing bridge source provenance: ${bridge_provenance_file}" >&2
  echo "run qemu-libafl-bridge patch before building" >&2
  exit 1
}
command -v git >/dev/null 2>&1 || {
  echo "git is required to inspect LibAFL bridge source provenance" >&2
  exit 1
}
if ! git -C "${source_dir}" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "bridge source must be a git checkout: ${source_dir}" >&2
  exit 1
fi

source_git_head="$(git -C "${source_dir}" rev-parse HEAD 2>/dev/null || true)"
[ -n "${source_git_head}" ] || {
  echo "cannot resolve bridge source git HEAD: ${source_dir}" >&2
  exit 1
}
source_diff_fingerprint="$({
  git -C "${source_dir}" diff --binary "${source_git_head}" -- . ':(exclude)build'
  (
    cd "${source_dir}"
    git ls-files --others --exclude-standard -z -- . ':(exclude)build' \
      | sort -z \
      | while IFS= read -r -d '' path; do
          # The provenance metadata is not part of the bridge source and its
          # content embeds the (relocation-dependent) absolute localPatchDir
          # path, so it must not feed the source fingerprint.  The source is
          # identified below by the stable provenance fields alone.
          [ "${path}" = ".morpheus-bridge.json" ] && continue
          printf 'untracked:%s\n' "${path}"
          sha256sum "${path}"
        done
  )
} | sha256sum | awk '{print $1}')"

# Derive the source provenance from the stable fields the patch stage
# recorded (provider/base commits, build version, local-patch fingerprint),
# not from the raw metadata file.  The raw file also carries the absolute
# localPatchDir path, which differs across machine relocations and would
# otherwise change the reuse signature on every move and force a rebuild.
source_provenance_fingerprint="$({
  node - "${bridge_provenance_file}" "${source_git_head}" <<'NODE'
const fs = require("fs");
const [file, gitHead] = process.argv.slice(2);
let m;
try {
  m = JSON.parse(fs.readFileSync(file, "utf8"));
} catch {
  process.exit(1);
}
const fields = [
  "git-head=" + gitHead,
  "provider-head=" + (m.providerHead || ""),
  "provider-base-ref=" + (m.providerBaseRef || ""),
  "provider-base-version=" + (m.providerBaseVersion || ""),
  "base-qemu-head=" + (m.baseQemuHead || ""),
  "base-qemu-version=" + (m.baseQemuVersion || ""),
  "build-version=" + (m.buildVersion || ""),
  "local-patch-fingerprint=" + (m.localPatchFingerprint || ""),
];
process.stdout.write(fields.join("\n") + "\n");
NODE
} | sha256sum | awk '{print $1}')"

if [ -n "${target_list_file}" ] && [ -s "${target_list_file}" ]; then
  mapfile -t target_list < "${target_list_file}"
elif [ -n "${target_list_raw}" ]; then
  mapfile -t target_list <<< "${target_list_raw}"
else
  target_list=(aarch64-softmmu)
fi
[ "${#target_list[@]}" -gt 0 ] || target_list=(aarch64-softmmu)
target_csv="$(IFS=,; echo "${target_list[*]}")"

configure_args=(
  "--cc=${source_dir}/linker_interceptor.py"
  "--cxx=${source_dir}/linker_interceptor++.py"
  "--as-shared-lib"
  "--target-list=${target_csv}"
  "--disable-bsd-user"
  "--disable-docs"
  "--disable-tests"
  "--disable-tools"
  "--disable-slirp"
  "--enable-fdt=internal"
  "--audio-drv-list="
  "--disable-af-xdp"
  "--disable-alsa"
  "--enable-attr"
  "--disable-auth-pam"
  "--disable-dbus-display"
  "--disable-bochs"
  "--disable-bpf"
  "--disable-brlapi"
  "--disable-bzip2"
  "--disable-cap-ng"
  "--disable-canokey"
  "--disable-cloop"
  "--disable-cocoa"
  "--disable-coreaudio"
  "--disable-curl"
  "--disable-curses"
  "--disable-dmg"
  "--disable-dsound"
  "--disable-fuse"
  "--disable-fuse-lseek"
  "--disable-gcrypt"
  "--disable-gettext"
  "--disable-gio"
  "--disable-glusterfs"
  "--disable-gnutls"
  "--disable-gtk"
  "--disable-guest-agent"
  "--disable-guest-agent-msi"
  "--disable-hvf"
  "--disable-iconv"
  "--disable-jack"
  "--disable-keyring"
  "--disable-libdaxctl"
  "--disable-libiscsi"
  "--disable-libnfs"
  "--disable-libpmem"
  "--disable-libssh"
  "--disable-libudev"
  "--disable-libusb"
  "--disable-linux-aio"
  "--disable-linux-io-uring"
  "--disable-linux-user"
  "--disable-lzfse"
  "--disable-lzo"
  "--disable-l2tpv3"
  "--disable-malloc-trim"
  "--disable-mpath"
  "--disable-multiprocess"
  "--disable-netmap"
  "--disable-nettle"
  "--disable-numa"
  "--disable-nvmm"
  "--disable-opengl"
  "--disable-oss"
  "--disable-pa"
  "--disable-parallels"
  "--disable-png"
  "--disable-qcow1"
  "--disable-qed"
  "--disable-qga-vss"
  "--disable-rbd"
  "--disable-rdma"
  "--disable-replication"
  "--disable-sdl"
  "--disable-sdl-image"
  "--disable-seccomp"
  "--disable-selinux"
  "--disable-slirp-smbd"
  "--disable-smartcard"
  "--disable-snappy"
  "--disable-sndio"
  "--disable-sparse"
  "--disable-spice"
  "--disable-spice-protocol"
  "--disable-tpm"
  "--disable-usb-redir"
  "--disable-user"
  "--disable-u2f"
  "--disable-vde"
  "--disable-vdi"
  "--disable-vduse-blk-export"
  "--disable-vhost-crypto"
  "--disable-vhost-kernel"
  "--disable-vhost-net"
  "--disable-vhost-user-blk-server"
  "--disable-vhost-vdpa"
  "--disable-virglrenderer"
  "--enable-virtfs"
  "--disable-vmnet"
  "--disable-vnc"
  "--disable-vnc-jpeg"
  "--disable-vnc-sasl"
  "--disable-vte"
  "--disable-vvfat"
  "--disable-whpx"
  "--disable-xen"
  "--disable-xen-pci-passthrough"
  "--disable-xkbcommon"
  "--disable-zstd"
)
if [ -n "${configure_arg_file}" ] && [ -s "${configure_arg_file}" ]; then
  mapfile -t custom_configure_args < "${configure_arg_file}"
elif [ -n "${configure_arg_raw}" ]; then
  mapfile -t custom_configure_args <<< "${configure_arg_raw}"
else
  custom_configure_args=()
fi
configure_args+=("${custom_configure_args[@]}")

configure_signature="$({
  printf 'source=%s\n' "${source_dir}"
  printf 'source-provenance=%s\n' "${source_provenance_fingerprint}"
  printf 'version=%s\n' "${build_version}"
  printf 'target_list=%s\n' "${target_csv}"
  printf '%s\n' "${configure_args[@]}"
  sha256sum "${source_dir}/linker_interceptor.py" "${source_dir}/linker_interceptor++.py"
} | sha256sum | awk '{print $1}')"

stored_configure_signature=""
if [ -f "${signature_file}" ]; then
  stored_configure_signature="$(cat "${signature_file}")"
fi

build_is_current=false
if [ "${reuse_build_dir}" = "true" ] \
  && [ -f "${bridge_lib}" ] \
  && [ -f "${linkinfo_file}" ] \
  && [ -d "${bundle_dir}" ] \
  && [ -f "${signature_file}" ] \
  && [ "${stored_configure_signature}" = "${configure_signature}" ]; then
  build_is_current=true
fi

if [ "${build_is_current}" != "true" ]; then
  rm -rf "${build_dir}"
  mkdir -p "${build_dir}"
  (
    cd "${build_dir}"
    env \
      __LIBAFL_QEMU_CONFIGURE= \
      __LIBAFL_QEMU_BUILD_OUT="${linkinfo_file}" \
      __LIBAFL_QEMU_BUILD_CC=cc \
      __LIBAFL_QEMU_BUILD_CXX=c++ \
      "${source_dir}/configure" "${configure_args[@]}"
    printf '%s\n' "${configure_signature}" > "${signature_file}"
    make -j"${jobs}" V=1
  )
fi

[ -f "${bridge_lib}" ] || {
  echo "QEMU bridge build did not produce ${bridge_lib}" >&2
  exit 1
}
[ -f "${linkinfo_file}" ] || {
  echo "QEMU bridge build did not produce ${linkinfo_file}" >&2
  exit 1
}
[ -d "${bundle_dir}" ] || {
  echo "QEMU bridge build did not produce ${bundle_dir}" >&2
  exit 1
}

# libafl_qemu_build expects the QEMU build below LIBAFL_QEMU_DIR/build.  Keep
# the managed build directory as the single actual output tree and expose it
# through that conventional source-relative path without copying ~1 GB of
# QEMU objects.
source_build_dir="${source_dir}/build"
if [ -L "${source_build_dir}" ]; then
  linked_build_dir="$(readlink -f "${source_build_dir}")"
  actual_build_dir="$(readlink -f "${build_dir}")"
  [ "${linked_build_dir}" = "${actual_build_dir}" ] || {
    echo "${source_build_dir} points at an unexpected build directory" >&2
    exit 1
  }
elif [ -e "${source_build_dir}" ]; then
  actual_build_dir="$(readlink -f "${source_build_dir}")"
  expected_build_dir="$(readlink -f "${build_dir}")"
  [ "${actual_build_dir}" = "${expected_build_dir}" ] || {
    echo "source build directory already exists: ${source_build_dir}" >&2
    exit 1
  }
else
  ln -s "${build_dir}" "${source_build_dir}"
fi

mkdir -p "${install_dir}/lib" "${install_dir}/share"
cp -f "${bridge_lib}" "${installed_lib}"
if [ -L "${installed_bundle}" ] || [ -e "${installed_bundle}" ]; then
  rm -rf "${installed_bundle}"
fi
ln -s "${bundle_dir}" "${installed_bundle}"

cat > "${manifest_file}" <<EOF
{"schemaVersion":1,"tool":"qemu-libafl-bridge","status":"success","source":"${source_dir}","buildDir":"${build_dir}","installDir":"${install_dir}","buildVersion":"${build_version}","targetList":"${target_csv}","bridgeLibrary":"${installed_lib}","bridgeBuildLibrary":"${bridge_lib}","dataDir":"${bundle_dir}","linkinfo":"${linkinfo_file}","reused":${build_is_current}}
EOF
cat > "${result_file}" <<EOF
{"details":{"configured":true,"built":true,"installed":true,"reused":${build_is_current},"source":"${source_dir}","build_dir":"${build_dir}","install_dir":"${install_dir}","bridge_library":"${installed_lib}","bridge_data_dir":"${bundle_dir}","linkinfo":"${linkinfo_file}"},"artifacts":[{"path":"rebased-source","location":"${source_dir}"},{"path":"source-dir","location":"${source_dir}"},{"path":"qemu-bridge-build-dir","location":"${build_dir}"},{"path":"qemu-bridge-lib","location":"${installed_lib}"},{"path":"qemu-bridge-data-dir","location":"${bundle_dir}"},{"path":"qemu-bridge-linkinfo","location":"${linkinfo_file}"}]}
EOF
