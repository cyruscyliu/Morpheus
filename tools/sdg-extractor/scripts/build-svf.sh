#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
svf_src="${script_dir}/../third_party/SVF"
build_dir="${svf_src}/build"
install_dir="${svf_src}/install"
patch_dir="${script_dir}/../patches"
applied_patches=()

revert_patches() {
  local index
  for ((index=${#applied_patches[@]} - 1; index >= 0; index--)); do
    patch -R -p1 -d "${svf_src}" -s < "${applied_patches[index]}"
  done
}
trap revert_patches EXIT INT TERM

for patch_file in "${patch_dir}"/svf-*.patch; do
  if patch -R -p1 -d "${svf_src}" -s -f --dry-run < "${patch_file}" >/dev/null 2>&1; then
    continue
  fi
  patch -p1 -d "${svf_src}" -s < "${patch_file}"
  applied_patches+=("${patch_file}")
done

rm -rf "${build_dir}" "${install_dir}"
mkdir -p "${build_dir}" "${install_dir}"

cmake -S "${svf_src}" -B "${build_dir}" \
  -DLLVM_DIR=/usr/lib/llvm-15/cmake \
  -DLLVM_CLANG=/usr/bin/clang-15 \
  -DBUILD_SHARED_LIBS=OFF \
  -DCMAKE_INSTALL_PREFIX="${install_dir}"
make -C "${build_dir}" -j"$(nproc)"
cmake --install "${build_dir}" --prefix "${install_dir}"
