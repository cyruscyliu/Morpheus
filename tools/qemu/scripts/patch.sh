#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/../../_shared/scripts/state.sh"
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"

source_dir="${MORPHEUS_QEMU_SOURCE:?}"
patch_dir="${MORPHEUS_QEMU_PATCH_DIR:?}"
result_file="${MORPHEUS_QEMU_RESULT_FILE:-${MORPHEUS_SCRIPT_RESULT_FILE:?}}"
state_file="${source_dir}/.morpheus-patches.json"

qemu_patch_semantically_present() {
  local patch_name="$1"

  case "${patch_name}" in
    qemu-virtio-mmio-fuzz-input.patch)
      local mmio_file="${source_dir}/hw/virtio/virtio-mmio.c"
      local trace_events_file="${source_dir}/hw/virtio/trace-events"
      [ -f "${mmio_file}" ] || return 1
      [ -f "${trace_events_file}" ] || return 1
      grep -q 'MORPHEUS_QEMU_INPUT_PATH_ENV' "${mmio_file}" \
        && grep -q 'morpheus_virtio_mmio_fuzz_init' "${mmio_file}" \
        && grep -q 'morpheus_virtio_mmio_maybe_fuzz_read' "${mmio_file}" \
        && grep -q 'morpheus_virtio_mmio_maybe_fuzz_read(vdev, config_offset' "${mmio_file}" \
        && grep -q 'morpheus_virtio_mmio_fuzz_dma_write(offset, value, size)' "${mmio_file}" \
        && grep -q 'trace_virtio_mmio_fuzz_read' "${mmio_file}" \
        && grep -q 'trace_virtio_mmio_dma_fuzz' "${mmio_file}" \
        && grep -q '^virtio_mmio_fuzz_read(' "${trace_events_file}" \
        && grep -q '^virtio_mmio_dma_fuzz(' "${trace_events_file}"
      ;;
    *)
      return 1
      ;;
  esac
}

recreate_clean_source_from_local_git() {
  local clone_parent=""
  local clone_dir=""
  local metadata_copy=""

  [ -d "${source_dir}/.git" ] || return 1

  clone_parent="$(mktemp -d)"
  clone_dir="${clone_parent}/clean-source"
  if [ -f "${source_dir}/.morpheus-fetch.json" ]; then
    metadata_copy="${clone_parent}/.morpheus-fetch.json"
    cp "${source_dir}/.morpheus-fetch.json" "${metadata_copy}"
  fi

  git clone --quiet --local --no-hardlinks "${source_dir}" "${clone_dir}"
  rm -rf "${source_dir}"
  mv "${clone_dir}" "${source_dir}"
  if [ -n "${metadata_copy}" ] && [ -f "${metadata_copy}" ]; then
    cp "${metadata_copy}" "${source_dir}/.morpheus-fetch.json"
  fi
}

if [[ "${source_dir}" != /* ]]; then
  source_dir="${repo_root}/${source_dir#./}"
fi
if [[ "${patch_dir}" != /* ]]; then
  patch_dir="${repo_root}/${patch_dir#./}"
fi
if [[ "${result_file}" != /* ]]; then
  result_file="$(pwd)/${result_file#./}"
fi
state_file="${source_dir}/.morpheus-patches.json"

if [ ! -d "${source_dir}" ]; then
  echo "missing source directory: ${source_dir}" >&2
  exit 1
fi
if [ ! -d "${patch_dir}" ]; then
  echo "missing patch directory: ${patch_dir}" >&2
  exit 1
fi

patch_files="$(find "${patch_dir}" -type f \( -name '*.patch' -o -name '*.diff' \) -print | LC_ALL=C awk 'BEGIN{ORS="\n"}{print}' | LC_ALL=C sort)"
fingerprint="$(printf '%s\n' "${patch_files}" | morpheus_hash_files_from_stdin)"

if morpheus_patch_state_matches "${state_file}" "${fingerprint}"; then
  printf '[qemu] reuse patch state %s fingerprint=%s\n' "${patch_dir}" "${fingerprint}"
  cat > "${result_file}" <<EOF
{"details":{"reused":true,"applied":true,"fingerprint":"${fingerprint}"}}
EOF
  exit 0
fi

printf '[qemu] patch fingerprint changed, refetching clean source before apply\n'
if recreate_clean_source_from_local_git; then
  printf '[qemu] refreshed clean source from local git clone %s\n' "${source_dir}"
else
fetch_seed_dir="$(node -e '
const fs = require("fs");
const file = process.argv[1];
try {
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  process.stdout.write(String(data.seed_dir || ""));
} catch {}
' "${source_dir}/.morpheus-fetch.json")"
fetch_archive_url="$(node -e '
const fs = require("fs");
const file = process.argv[1];
try {
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  process.stdout.write(String(data.archive_url || ""));
} catch {}
' "${source_dir}/.morpheus-fetch.json")"
fetch_git_url="$(node -e '
const fs = require("fs");
const file = process.argv[1];
try {
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  process.stdout.write(String(data.git_url || ""));
} catch {}
' "${source_dir}/.morpheus-fetch.json")"
fetch_git_ref="$(node -e '
const fs = require("fs");
const file = process.argv[1];
try {
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  process.stdout.write(String(data.git_ref || ""));
} catch {}
' "${source_dir}/.morpheus-fetch.json")"
fetch_submodules="$(node -e '
const fs = require("fs");
const file = process.argv[1];
try {
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  process.stdout.write(String(data.fetch_submodules || ""));
} catch {}
' "${source_dir}/.morpheus-fetch.json")"
fetch_build_version="$(node -e '
const fs = require("fs");
const file = process.argv[1];
try {
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  process.stdout.write(String(data.build_version || ""));
} catch {}
' "${source_dir}/.morpheus-fetch.json")"
fetch_downloads_dir="$(node -e '
const fs = require("fs");
const file = process.argv[1];
try {
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  process.stdout.write(String(data.downloads_dir || ""));
} catch {}
' "${source_dir}/.morpheus-fetch.json")"
if [ -z "${fetch_build_version}" ]; then
  case "$(basename "${source_dir}")" in
    qemu-*)
      fetch_build_version="${source_dir##*/qemu-}"
      ;;
  esac
fi
if [ -z "${fetch_downloads_dir}" ]; then
  fetch_downloads_dir="$(cd "$(dirname "${source_dir}")/.." && pwd)/downloads"
fi
rm -rf "${source_dir}"
env \
  MORPHEUS_QEMU_SOURCE="${source_dir}" \
  MORPHEUS_QEMU_SEED_DIR="${fetch_seed_dir}" \
  MORPHEUS_QEMU_ARCHIVE_URL="${fetch_archive_url}" \
  MORPHEUS_QEMU_GIT_URL="${fetch_git_url}" \
  MORPHEUS_QEMU_GIT_REF="${fetch_git_ref}" \
  MORPHEUS_QEMU_FETCH_SUBMODULES="${fetch_submodules}" \
  MORPHEUS_QEMU_DOWNLOADS_DIR="${fetch_downloads_dir}" \
  MORPHEUS_QEMU_BUILD_VERSION="${fetch_build_version}" \
  "$(dirname "$0")/fetch.sh"
fi

while IFS= read -r patch_file; do
  [ -n "${patch_file}" ] || continue
  if patch -d "${source_dir}" -p1 -N --dry-run -i "${patch_file}" >/dev/null 2>&1; then
    printf '>>> %s\n' "${patch_file#${patch_dir}/}"
    patch -d "${source_dir}" -p1 -N -i "${patch_file}"
    continue
  fi
  if qemu_patch_semantically_present "$(basename "${patch_file}")"; then
    printf '>>> %s (already present, skipped)\n' "${patch_file#${patch_dir}/}"
    continue
  fi
  printf '>>> %s\n' "${patch_file#${patch_dir}/}"
  patch -d "${source_dir}" -p1 -N -i "${patch_file}"
done <<EOF
${patch_files}
EOF

morpheus_write_patch_state "${state_file}" "${patch_dir}" "${fingerprint}"

printf '[qemu] applied patches from %s fingerprint=%s\n' "${patch_dir}" "${fingerprint}"
cat > "${result_file}" <<EOF
{"details":{"applied":true,"fingerprint":"${fingerprint}"}}
EOF
