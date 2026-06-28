#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/../../_shared/scripts/parallelism.sh"

source_dir="${MORPHEUS_NQC2_SOURCE:?}"
qemu_path="${MORPHEUS_NQC2_QEMU:-}"
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
plugin_out="${install_dir}/lib/nqc2/nqc2-plugin.so"
guest_plugin_out="${install_dir}/lib/nqc2/nqc2-plugin-aarch64.so"
cli_out="${install_dir}/bin/nqc2"
qemu_etrace_out="${install_dir}/bin/qemu-etrace"
manifest_file="${build_dir}/manifest.json"
qemu_etrace_repo="${build_dir}/qemu-etrace"
qemu_etrace_url="https://github.com/edgarigl/qemu-etrace.git"
qemu_etrace_makefile="${qemu_etrace_repo}/Makefile"

if [ ! -f "${plugin_header}" ]; then
  echo "missing QEMU plugin header: ${plugin_header}" >&2
  exit 1
fi

if [ "${reuse_build_dir}" = "true" ] && [ -f "${manifest_file}" ] && [ -x "${cli_out}" ] && [ -x "${qemu_etrace_out}" ] && [ -f "${plugin_out}" ] && [ -f "${guest_plugin_out}" ]; then
  if [ -d "${qemu_etrace_repo}" ] && make -C "${qemu_etrace_repo}" -q >/dev/null 2>&1; then
    if [ "${plugin_out}" -nt "${manifest_file}" ] || [ "${cli_out}" -nt "${manifest_file}" ] || [ "${qemu_etrace_out}" -nt "${manifest_file}" ]; then
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
    "reused": true,
    "artifacts": [
      { "path": "install-dir", "location": "${install_dir}" },
      { "path": "nqc2", "location": "${cli_out}" },
      { "path": "qemu-etrace", "location": "${qemu_etrace_out}" },
      { "path": "nqc2-plugin-so", "location": "${plugin_out}" },
      { "path": "nqc2-plugin-so-aarch64", "location": "${guest_plugin_out}" },
      { "path": "trace-dir", "location": "${trace_dir}" }
    ]
  }
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
  "${script_dir}/nqc2_plugin.c" \
  -o "${plugin_out}" \
  -lpthread

aarch64-linux-gnu-gcc \
  -std=c11 \
  -O2 \
  -fPIC \
  -fvisibility=hidden \
  -shared \
  -I"${qemu_include_dir}" \
  "${script_dir}/nqc2_plugin.c" \
  -o "${guest_plugin_out}" \
  -lpthread

if [ ! -d "${qemu_etrace_repo}/.git" ]; then
  rm -rf "${qemu_etrace_repo}"
  git clone "${qemu_etrace_url}" "${qemu_etrace_repo}"
fi

if [ -f "${qemu_etrace_makefile}" ] && ! grep -q -- "-lzstd" "${qemu_etrace_makefile}"; then
  if pkg-config --exists libzstd 2>/dev/null || ldconfig -p 2>/dev/null | grep -q 'libzstd\.so'; then
    printf '\nLDLIBS += -lzstd\n' >> "${qemu_etrace_makefile}"
  fi
fi

if [ ! -f "${qemu_etrace_repo}/binutils-2.42-install/include/bfd.h" ] \
  || [ ! -f "${qemu_etrace_repo}/binutils-2.42-install/lib/libiberty.a" ]; then
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
    "trace_dir": "${trace_dir}",
    "reused": false,
    "artifacts": [
      { "path": "install-dir", "location": "${install_dir}" },
      { "path": "nqc2", "location": "${cli_out}" },
      { "path": "qemu-etrace", "location": "${qemu_etrace_out}" },
      { "path": "nqc2-plugin-so", "location": "${plugin_out}" },
      { "path": "nqc2-plugin-so-aarch64", "location": "${guest_plugin_out}" },
      { "path": "trace-dir", "location": "${trace_dir}" }
    ]
  }
}
EOF
