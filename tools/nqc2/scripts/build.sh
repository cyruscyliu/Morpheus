#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/../../_shared/scripts/parallelism.sh"

source_dir="${MORPHEUS_NQC2_SOURCE:?}"
qemu_path="${MORPHEUS_NQC2_QEMU:-}"
guest_qemu_path="${MORPHEUS_NQC2_GUEST_QEMU:-}"
guest_qemu_plugin_header="${MORPHEUS_NQC2_GUEST_QEMU_PLUGIN_HEADER:-}"
guest_cross_compile="${MORPHEUS_NQC2_GUEST_CROSS_COMPILE:-}"
guest_sysroot="${MORPHEUS_NQC2_GUEST_SYSROOT:-}"
build_dir="${MORPHEUS_NQC2_BUILD_DIR:?}"
install_dir="${MORPHEUS_NQC2_INSTALL_DIR:?}"
trace_dir="${MORPHEUS_NQC2_TRACE_DIR:?}"
build_version="${MORPHEUS_NQC2_BUILD_VERSION:-dev}"
result_file="${MORPHEUS_NQC2_RESULT_FILE:-${MORPHEUS_SCRIPT_RESULT_FILE:?}}"
reuse_build_dir="${MORPHEUS_NQC2_REUSE_BUILD_DIR:-false}"
script_dir="$(cd "$(dirname "$0")" && pwd)"
version_file="${source_dir}/VERSION"
version="${build_version}"

if [ -f "${version_file}" ]; then
  version="$(tr -d '\n' < "${version_file}")"
fi

qemu_include_dir=""
if [ -n "${qemu_path}" ] && [ -e "${qemu_path}" ]; then
  qemu_install_dir="$(cd "$(dirname "${qemu_path}")/.." && pwd)"
  if [ -f "${qemu_install_dir}/include/qemu-plugin.h" ]; then
    qemu_include_dir="${qemu_install_dir}/include"
  fi
fi
if [ -z "${qemu_include_dir}" ]; then
  qemu_include_dir="${script_dir}"
fi
plugin_header="${qemu_include_dir}/qemu-plugin.h"
if [ -n "${guest_qemu_path}" ] && [ -z "${guest_qemu_plugin_header}" ]; then
  guest_qemu_install_dir="$(cd "$(dirname "${guest_qemu_path}")/.." && pwd)"
  if [ -f "${guest_qemu_install_dir}/include/plugins/qemu-plugin.h" ]; then
    guest_qemu_plugin_header="${guest_qemu_install_dir}/include/plugins/qemu-plugin.h"
  elif [ -f "${guest_qemu_install_dir}/include/qemu-plugin.h" ]; then
    guest_qemu_plugin_header="${guest_qemu_install_dir}/include/qemu-plugin.h"
  fi
fi
guest_qemu_include_dir=""
if [ -n "${guest_qemu_plugin_header}" ]; then
  guest_qemu_include_dir="$(dirname "${guest_qemu_plugin_header}")"
fi
plugin_out="${install_dir}/lib/nqc2/nqc2-plugin.so"
guest_plugin_out="${install_dir}/lib/nqc2/nqc2-plugin-aarch64.so"
plugin_source="${script_dir}/nqc2_plugin.c"
cli_out="${install_dir}/bin/nqc2"
qemu_etrace_out="${install_dir}/bin/qemu-etrace"
manifest_file="${build_dir}/manifest.json"
qemu_etrace_repo="${build_dir}/qemu-etrace"
qemu_etrace_url="https://github.com/edgarigl/qemu-etrace.git"
qemu_etrace_makefile="${qemu_etrace_repo}/Makefile"
guest_build_enabled="false"
if [ -n "${guest_qemu_path}${guest_qemu_plugin_header}${guest_cross_compile}${guest_sysroot}" ]; then
  guest_build_enabled="true"
fi
guest_artifact_line=""
if [ "${guest_build_enabled}" = "true" ]; then
  guest_artifact_line="    { \"path\": \"nqc2-plugin-so-aarch64\", \"location\": \"${guest_plugin_out}\" },"
fi

guest_inputs_match() {
  [ -f "${manifest_file}" ] || return 1
  node - "${manifest_file}" "${guest_qemu_plugin_header}" "${guest_cross_compile}" "${guest_sysroot}" <<'NODE'
const fs = require("fs");
const [manifestPath, header, compiler, sysroot] = process.argv.slice(2);
try {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  process.exit(
    manifest.guestQemuPluginHeader === header
      && manifest.guestCrossCompile === compiler
      && manifest.guestSysroot === sysroot
      ? 0
      : 1,
  );
} catch {
  process.exit(1);
}
NODE
}

if [ ! -f "${plugin_header}" ]; then
  echo "missing QEMU plugin header: ${plugin_header}" >&2
  exit 1
fi
guest_glib_include_dir=""
guest_glib_config_include_dir=""
if [ "${guest_build_enabled}" = "true" ]; then
  if [ ! -f "${guest_qemu_include_dir}/qemu-plugin.h" ]; then
    echo "missing guest QEMU plugin header: ${guest_qemu_plugin_header}" >&2
    exit 1
  fi
  if [ -z "${guest_cross_compile}" ]; then
    echo "missing guest cross compiler: set MORPHEUS_NQC2_GUEST_CROSS_COMPILE" >&2
    exit 1
  fi
  if ! command -v "${guest_cross_compile}" >/dev/null 2>&1 && [ ! -x "${guest_cross_compile}" ]; then
    echo "missing guest cross compiler: ${guest_cross_compile}" >&2
    exit 1
  fi
  if [ -z "${guest_sysroot}" ] || [ ! -d "${guest_sysroot}" ]; then
    echo "missing guest sysroot: ${guest_sysroot}" >&2
    exit 1
  fi
  guest_glib_include_dir="${guest_sysroot}/usr/include/glib-2.0"
  guest_glib_config_include_dir="${guest_sysroot}/usr/lib/glib-2.0/include"
  if [ ! -f "${guest_glib_include_dir}/glib.h" ] \
    || [ ! -f "${guest_glib_config_include_dir}/glibconfig.h" ]; then
    echo "missing guest GLib headers under sysroot: ${guest_sysroot}" >&2
    exit 1
  fi
fi

host_glib_cflags=()
if command -v pkg-config >/dev/null 2>&1 \
  && pkg-config --exists glib-2.0 2>/dev/null; then
  read -r -a host_glib_cflags <<< "$(pkg-config --cflags glib-2.0)"
elif [ -f /usr/include/glib-2.0/glib.h ] \
  && [ -f /usr/lib/x86_64-linux-gnu/glib-2.0/include/glibconfig.h ]; then
  host_glib_cflags=(
    -I/usr/include/glib-2.0
    -I/usr/lib/x86_64-linux-gnu/glib-2.0/include
  )
else
  echo "missing host GLib development headers" >&2
  exit 1
fi

if [ "${reuse_build_dir}" = "true" ] \
  && [ -f "${manifest_file}" ] \
  && [ -x "${cli_out}" ] \
  && [ -x "${qemu_etrace_out}" ] \
  && [ -f "${plugin_out}" ] \
  && guest_inputs_match; then
  if [ "${guest_build_enabled}" = "true" ] && [ ! -f "${guest_plugin_out}" ]; then
    :
  elif [ -d "${qemu_etrace_repo}" ] && make -C "${qemu_etrace_repo}" -q >/dev/null 2>&1; then
    if [ "${plugin_out}" -nt "${manifest_file}" ] \
      || { [ "${guest_build_enabled}" = "true" ] && [ "${guest_plugin_out}" -nt "${manifest_file}" ]; } \
      || [ "${plugin_source}" -nt "${manifest_file}" ] \
      || [ "${script_dir}/build.sh" -nt "${manifest_file}" ] \
      || [ "${cli_out}" -nt "${manifest_file}" ] \
      || [ "${qemu_etrace_out}" -nt "${manifest_file}" ]; then
      : 
    else
      cat > "${result_file}" <<EOF
{
  "details": {
    "built": true,
    "version": "${version}",
    "plugin": "${plugin_out}",
    "cli": "${cli_out}",
    "qemu_etrace": "${qemu_etrace_out}",
    "trace_dir": "${trace_dir}",
    "reused": true
  },
  "artifacts": [
    { "path": "install-dir", "location": "${install_dir}" },
    { "path": "nqc2", "location": "${cli_out}" },
    { "path": "qemu-etrace", "location": "${qemu_etrace_out}" },
    { "path": "nqc2-plugin-so", "location": "${plugin_out}" },
    ${guest_artifact_line:-}
    { "path": "trace-dir", "location": "${trace_dir}" }
  ]
}
EOF
      exit 0
    fi
  fi
fi

mkdir -p "${build_dir}" "${install_dir}/bin" "${install_dir}/lib/nqc2" "${trace_dir}"

cc="${CC:-gcc}"
"${cc}" \
  -std=c11 \
  -O2 \
  -fPIC \
  -fvisibility=hidden \
  -shared \
  -I"${qemu_include_dir}" \
  "${host_glib_cflags[@]}" \
  "${plugin_source}" \
  -o "${plugin_out}" \
  -lpthread \
  -lz

if [ "${guest_build_enabled}" = "true" ]; then
  "${guest_cross_compile}" \
    -std=c11 \
    -O2 \
    -fPIC \
    -fvisibility=hidden \
    -shared \
    -I"${guest_qemu_include_dir}" \
    -I"${guest_glib_include_dir}" \
    -I"${guest_glib_config_include_dir}" \
    --sysroot="${guest_sysroot}" \
    "${plugin_source}" \
    -o "${guest_plugin_out}" \
    -lpthread \
    -lz
fi

if [ ! -d "${qemu_etrace_repo}/.git" ]; then
  rm -rf "${qemu_etrace_repo}"
  git clone "${qemu_etrace_url}" "${qemu_etrace_repo}"
fi

if [ -f "${qemu_etrace_makefile}" ] && ! grep -q -- "-lzstd" "${qemu_etrace_makefile}"; then
  if pkg-config --exists libzstd 2>/dev/null || ldconfig -p 2>/dev/null | grep -q 'libzstd\.so'; then
    printf '\nLDLIBS += -lzstd\n' >> "${qemu_etrace_makefile}"
  fi
fi

binutils_build_dir="${qemu_etrace_repo}/binutils-2.42-build"
binutils_install_dir="${qemu_etrace_repo}/binutils-2.42-install"
binutils_config_log="${binutils_build_dir}/config.log"
if [ -f "${binutils_config_log}" ] \
  && ! grep -Fq -- "--prefix=${binutils_install_dir}" "${binutils_config_log}"; then
  # Managed caches can move between a repository-local and a global root. The
  # generated libtool files contain absolute paths, so a relocated configure
  # tree must be regenerated before make is invoked.
  printf '[nqc2] resetting relocated binutils build tree\n' >&2
  rm -rf "${binutils_build_dir}" "${binutils_install_dir}"
fi

if [ ! -f "${binutils_install_dir}/include/bfd.h" ] \
  || [ ! -f "${binutils_install_dir}/lib/libiberty.a" ]; then
  make -C "${qemu_etrace_repo}" binutils
fi

make -C "${qemu_etrace_repo}" -j"$(morpheus_default_jobs)"

install -m 0755 "${qemu_etrace_repo}/qemu-etrace" "${qemu_etrace_out}"
cat > "${cli_out}" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "$0")" && pwd)"
find_tool() {
  local explicit="${1:-}"
  shift || true
  if [ -n "${explicit}" ]; then
    printf '%s\n' "${explicit}"
    return 0
  fi
  local candidate
  for candidate in "$@"; do
    if command -v "${candidate}" >/dev/null 2>&1; then
      command -v "${candidate}"
      return 0
    fi
  done
  return 1
}
exec "${script_dir}/qemu-etrace" \
  --dwarfdump "$(find_tool "${DWARFDUMP:-}" dwarfdump llvm-dwarfdump llvm-dwarfdump-19)" \
  --nm "$(find_tool "${NM:-}" nm)" \
  --objdump "$(find_tool "${OBJDUMP:-}" objdump llvm-objdump)" \
  --addr2line "$(find_tool "${ADDR2LINE:-}" addr2line llvm-addr2line)" \
  "$@"
EOF
chmod +x "${cli_out}"

cat > "${manifest_file}" <<EOF
{
  "schemaVersion": 1,
  "tool": "nqc2",
  "version": "${version}",
  "plugin": "${plugin_out}",
  "cli": "${cli_out}",
  "qemuEtrace": "${qemu_etrace_out}",
  "guestPlugin": "${guest_plugin_out}",
  "guestQemu": "${guest_qemu_path}",
  "guestQemuPluginHeader": "${guest_qemu_plugin_header}",
  "guestCrossCompile": "${guest_cross_compile}",
  "guestSysroot": "${guest_sysroot}",
  "traceDir": "${trace_dir}",
  "qemuInstallDir": "${qemu_install_dir:-}"
}
EOF

cat > "${result_file}" <<EOF
{
  "details": {
    "built": true,
    "version": "${version}",
    "plugin": "${plugin_out}",
    "cli": "${cli_out}",
    "qemu_etrace": "${qemu_etrace_out}",
    "guest_plugin": "${guest_plugin_out}",
    "guest_qemu": "${guest_qemu_path}",
    "guest_qemu_plugin_header": "${guest_qemu_plugin_header}",
    "guest_cross_compile": "${guest_cross_compile}",
    "guest_sysroot": "${guest_sysroot}",
    "trace_dir": "${trace_dir}",
    "reused": false
  },
  "artifacts": [
    { "path": "install-dir", "location": "${install_dir}" },
    { "path": "nqc2", "location": "${cli_out}" },
    { "path": "qemu-etrace", "location": "${qemu_etrace_out}" },
    { "path": "nqc2-plugin-so", "location": "${plugin_out}" },
    ${guest_artifact_line:-}
    { "path": "trace-dir", "location": "${trace_dir}" }
  ]
}
EOF
