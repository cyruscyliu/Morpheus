#!/usr/bin/env bash
set -euo pipefail

# Build the AST source catalog tool. Uses the newest clang whose Tooling
# development stack is installed; resolved through llvm-config, not host
# layout assumptions.
tool_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
build_dir="${SDG_AST_BUILD_DIR:-${tool_root}/builds/default}"

clangxx=""
llvmcfg=""
for v in 19 18 17 16 15; do
  cfg="llvm-config-${v}"
  cxx="clang++-${v}"
  if command -v "$cfg" >/dev/null 2>&1 && command -v "$cxx" >/dev/null 2>&1 &&
     [ -e "$($cfg --libdir)/libclangTooling.a" ]; then
    clangxx="$cxx"
    llvmcfg="$cfg"
    break
  fi
done
if [ -z "$clangxx" ]; then
  echo "error: no clang with the Tooling development stack found" >&2
  exit 1
fi

incdir="$($llvmcfg --includedir)"
libdir="$($llvmcfg --libdir)"
version="$(basename "$llvmcfg" | sed 's/llvm-config-//')"
clangcpp="$(basename "$(ls "${libdir}"/libclang-cpp.so.* | head -1)")"
llvmlib="libLLVM-${version}.so"

mkdir -p "${build_dir}"
$clangxx -std=gnu++17 -fno-rtti -I"${incdir}" \
  "${tool_root}/src/ast_source_scan.cpp" \
  -o "${build_dir}/ast_source_scan" \
  -L"${libdir}" \
  -l:"${clangcpp}" -l:"${llvmlib}"

echo "built ${build_dir}/ast_source_scan with ${clangxx}"
