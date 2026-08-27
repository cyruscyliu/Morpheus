#!/usr/bin/env bash
set -euo pipefail

# A bridge provider is a QEMU tree with LibAFL changes based on an older QEMU
# release.  Do not build that tree directly: first replay only the provider's
# changes on the QEMU source selected by the nvirsh workflow.  This keeps the
# ARM CCA/RME implementation and the bridge implementation on one explicit
# QEMU baseline.
repo_root="${MORPHEUS_REPO_ROOT:?missing MORPHEUS_REPO_ROOT}"
source_dir="${MORPHEUS_QEMU_LIBAFL_BRIDGE_SOURCE:?missing bridge provider source}"
base_qemu_source="${MORPHEUS_QEMU_LIBAFL_BRIDGE_BASE_QEMU_SOURCE:?missing base QEMU source}"
build_dir="${MORPHEUS_QEMU_LIBAFL_BRIDGE_BUILD_DIR:?missing bridge build directory}"
provider_base_ref="${MORPHEUS_QEMU_LIBAFL_BRIDGE_PROVIDER_BASE_REF:-${MORPHEUS_QEMU_LIBAFL_BRIDGE_BASE_VERSION:-6e9a825c1d4e7b62d072e99a89ecd1a74c7f0d55}}"
provider_base_version="${MORPHEUS_QEMU_LIBAFL_BRIDGE_PROVIDER_BASE_VERSION:-11.0.1}"
build_version="${MORPHEUS_QEMU_LIBAFL_BRIDGE_BUILD_VERSION:-11.0.3}"
result_file="${MORPHEUS_QEMU_LIBAFL_BRIDGE_RESULT_FILE:-${MORPHEUS_SCRIPT_RESULT_FILE:?missing result file}}"
patch_dir="${MORPHEUS_QEMU_LIBAFL_BRIDGE_PATCH_DIR:-${repo_root}/tools/qemu-libafl-bridge/patches}"
metadata_file="${source_dir}/.morpheus-bridge.json"
rebased_source="$(dirname "${build_dir}")/rebased-source"

for path in source_dir base_qemu_source; do
  value="${!path}"
  if [[ "${value}" != /* ]]; then
    value="${repo_root}/${value#./}"
    printf -v "${path}" '%s' "${value}"
  fi
done
if [[ "${build_dir}" != /* ]]; then
  build_dir="${repo_root}/${build_dir#./}"
fi
if [[ "${rebased_source}" != /* ]]; then
  rebased_source="${repo_root}/${rebased_source#./}"
fi
if [[ "${result_file}" != /* ]]; then
  result_file="$(pwd)/${result_file#./}"
fi
if [[ "${patch_dir}" != /* ]]; then
  patch_dir="${repo_root}/${patch_dir#./}"
fi

[ -d "${source_dir}" ] || {
  echo "missing bridge provider source: ${source_dir}" >&2
  exit 1
}
[ -d "${base_qemu_source}" ] || {
  echo "missing base QEMU source: ${base_qemu_source}" >&2
  exit 1
}
if ! git -C "${source_dir}" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "bridge provider source must be a git checkout: ${source_dir}" >&2
  exit 1
fi
if ! git -C "${base_qemu_source}" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "base QEMU source must be a git checkout: ${base_qemu_source}" >&2
  exit 1
fi
[ -d "${patch_dir}" ] || {
  echo "missing bridge patch directory: ${patch_dir}" >&2
  exit 1
}

mapfile -t local_patch_files < <(
  find "${patch_dir}" -type f \( -name '*.patch' -o -name '*.diff' \) -print |
    LC_ALL=C sort
)
local_patch_fingerprint="$({
  for patch_file in "${local_patch_files[@]}"; do
    printf '%s\n' "${patch_file}"
    sha256sum "${patch_file}"
  done
} | sha256sum | awk '{print $1}')"

provider_head="$(git -C "${source_dir}" rev-parse HEAD 2>/dev/null || true)"
base_qemu_head="$(git -C "${base_qemu_source}" rev-parse HEAD 2>/dev/null || true)"
[ -n "${provider_head}" ] || {
  echo "cannot resolve bridge provider HEAD: ${source_dir}" >&2
  exit 1
}
[ -n "${base_qemu_head}" ] || {
  echo "cannot resolve base QEMU HEAD: ${base_qemu_source}" >&2
  exit 1
}

git -C "${source_dir}" cat-file -e "${provider_base_ref}^{commit}" 2>/dev/null || {
  echo "bridge provider is missing configured base commit ${provider_base_ref}; fetch the provider branch containing its QEMU base" >&2
  exit 1
}
git -C "${base_qemu_source}" cat-file -e "${base_qemu_head}^{commit}" 2>/dev/null || {
  echo "base QEMU checkout has no commit ${base_qemu_head}" >&2
  exit 1
}

provider_version="$(git -C "${source_dir}" show "${provider_base_ref}:VERSION" 2>/dev/null | tr -d '[:space:]' || true)"
base_version="$(git -C "${base_qemu_source}" show "${base_qemu_head}:VERSION" 2>/dev/null | tr -d '[:space:]' || true)"
if [ -n "${provider_version}" ] && [ "${provider_version}" != "${provider_base_version}" ]; then
  echo "configured provider base ${provider_base_ref} is QEMU ${provider_version}, expected QEMU ${provider_base_version}" >&2
  exit 1
fi
if [ -n "${base_version}" ] && [ "${base_version}" != "${build_version}" ]; then
  echo "base QEMU is version ${base_version}, expected ${build_version}" >&2
  exit 1
fi

metadata_file="${rebased_source}/.morpheus-bridge.json"
metadata_matches() {
  [ -f "${metadata_file}" ] || return 1
  node - "${metadata_file}" "${provider_head}" "${base_qemu_head}" "${provider_base_ref}" "${build_version}" "${local_patch_fingerprint}" <<'NODE'
const fs = require("fs");
const [file, provider, base, providerBase, version, patchFingerprint] = process.argv.slice(2);
try {
  const value = JSON.parse(fs.readFileSync(file, "utf8"));
  process.exit(
    value.providerHead === provider &&
    value.baseQemuHead === base &&
    value.providerBaseRef === providerBase &&
    value.buildVersion === version &&
    value.localPatchFingerprint === patchFingerprint ? 0 : 1,
  );
} catch {
  process.exit(1);
}
NODE
}

if metadata_matches; then
  printf '[qemu-libafl-bridge] reuse rebased source %s (QEMU %s)\n' \
    "${rebased_source}" "${build_version}"
  cat > "${result_file}" <<EOF
{"details":{"reused":true,"applied":true,"provider_head":"${provider_head}","provider_base_ref":"${provider_base_ref}","provider_base_version":"${provider_base_version}","base_qemu_head":"${base_qemu_head}","build_version":"${build_version}","local_patch_dir":"${patch_dir}","local_patch_fingerprint":"${local_patch_fingerprint}"},"artifacts":[{"path":"rebased-source","location":"${rebased_source}"}]}
EOF
  exit 0
fi

tmp_root="$(mktemp -d)"
provider_patch="${tmp_root}/provider.patch"
cleanup() {
  rm -rf "${tmp_root}"
}
trap cleanup EXIT

# Keep the complete bridge delta, including newly-added libafl/ files.  The
# provider's base commit is deliberately explicit rather than inferred from a
# merge commit, because merge-base would otherwise omit bridge commits.
git -C "${source_dir}" diff --binary --no-ext-diff --no-renames \
  "${provider_base_ref}" "${provider_head}" -- \
  ':(exclude).github' \
  ':(exclude)README*' \
  ':(exclude)**/README*' \
  ':(exclude).gitignore' > "${provider_patch}"
[ -s "${provider_patch}" ] || {
  echo "bridge provider diff is empty between ${provider_base_ref} and ${provider_head}" >&2
  exit 1
}

# Build the rebased source beside (rather than inside) the provider checkout.
# This lets subsequent runs recalculate the provider diff and keeps the
# fetched provider source as an auditable input artifact.
rm -rf "${rebased_source}"
mkdir -p "$(dirname "${rebased_source}")"
git clone --quiet --local --no-hardlinks "${base_qemu_source}" "${rebased_source}" || {
  echo "cannot clone base QEMU source ${base_qemu_source} into ${rebased_source}" >&2
  exit 1
}
git -C "${rebased_source}" reset --hard --quiet "${base_qemu_head}"
git -C "${rebased_source}" clean -fdx -q

if ! git -C "${rebased_source}" apply --index --3way --whitespace=nowarn "${provider_patch}"; then
  echo "cannot apply LibAFL bridge changes from ${provider_head} to QEMU ${base_version:-${build_version}} (${base_qemu_head})" >&2
  git -C "${rebased_source}" status --short >&2 || true
  exit 1
fi

for patch_file in "${local_patch_files[@]}"; do
  [ -n "${patch_file}" ] || continue
  if git -C "${rebased_source}" apply --check --whitespace=nowarn "${patch_file}"; then
    printf '[qemu-libafl-bridge] apply local patch %s\n' "${patch_file#${patch_dir}/}"
    git -C "${rebased_source}" apply --index --3way --whitespace=nowarn "${patch_file}"
  elif git -C "${rebased_source}" apply --reverse --check --whitespace=nowarn "${patch_file}"; then
    printf '[qemu-libafl-bridge] local patch already present %s\n' "${patch_file#${patch_dir}/}"
  else
    echo "cannot apply local bridge patch ${patch_file#${patch_dir}/} to rebased QEMU source" >&2
    git -C "${rebased_source}" status --short >&2 || true
    exit 1
  fi
done

cat > "${metadata_file}" <<EOF
{"schemaVersion":1,"providerHead":"${provider_head}","providerBaseRef":"${provider_base_ref}","providerBaseVersion":"${provider_base_version}","baseQemuHead":"${base_qemu_head}","baseQemuVersion":"${base_version}","buildVersion":"${build_version}","localPatchDir":"${patch_dir}","localPatchFingerprint":"${local_patch_fingerprint}"}
EOF

[ -x "${rebased_source}/configure" ] || { echo "rebased bridge source has no configure script" >&2; exit 1; }
[ -x "${rebased_source}/linker_interceptor.py" ] || { echo "rebased bridge source has no linker_interceptor.py" >&2; exit 1; }
[ -x "${rebased_source}/linker_interceptor++.py" ] || { echo "rebased bridge source has no linker_interceptor++.py" >&2; exit 1; }

cat > "${result_file}" <<EOF
{"details":{"reused":false,"applied":true,"provider_head":"${provider_head}","provider_base_ref":"${provider_base_ref}","provider_base_version":"${provider_base_version}","base_qemu_head":"${base_qemu_head}","build_version":"${build_version}","local_patch_dir":"${patch_dir}","local_patch_fingerprint":"${local_patch_fingerprint}"},"artifacts":[{"path":"rebased-source","location":"${rebased_source}"}]}
EOF
