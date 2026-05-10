#!/usr/bin/env bash
set -euo pipefail

profile_file="${MORPHEUS_NVIRSH_PROFILE_FILE:?}"
run_dir="${MORPHEUS_NVIRSH_RUN_DIR:?}"
log_file="${MORPHEUS_NVIRSH_LOG_FILE:?}"
ssh_public_key="${MORPHEUS_NVIRSH_SSH_PUBLIC_KEY:-}"
host_name="$(hostname -s 2>/dev/null || hostname 2>/dev/null || echo host)"
profile_name="$(node -e 'const fs=require("fs"); const p=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(String(p.name||"nvirsh-l0"));' "${profile_file}")"
profile_image="$(node -e 'const fs=require("fs"); const p=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(String(p.l0 && p.l0.image || ""));' "${profile_file}")"
profile_workspace="$(node -e 'const fs=require("fs"); const p=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(String(p.l0 && p.l0.workspace || ""));' "${profile_file}")"

mkdir -p "${run_dir}/l0"

USER_DATA="${run_dir}/l0/user-data"
META_DATA="${run_dir}/l0/meta-data"
SEED_IMAGE="${run_dir}/l0/seed.img"
BASE_IMAGE_PATH="${run_dir}/l0/base-image.qcow2"
OVERLAY_IMAGE="${run_dir}/l0/overlay.qcow2"
VM_NAME="${profile_name}"
VM_USER="root"
VM_PASSWORD="debian"

download_base_image() {
  local url="$1"
  if [ -f "${BASE_IMAGE_PATH}" ]; then
    return 0
  fi
  case "${url}" in
    file://*)
      cp "${url#file://}" "${BASE_IMAGE_PATH}"
      ;;
    http://*|https://*)
      curl -fL "${url}" -o "${BASE_IMAGE_PATH}"
      ;;
    *)
      if [ -f "${url}" ]; then
        cp "${url}" "${BASE_IMAGE_PATH}"
      else
        echo "unsupported Debian image source: ${url}" >&2
        exit 1
      fi
      ;;
  esac
}

cat > "${USER_DATA}" <<CLOUDCFG
#cloud-config
hostname: ${host_name}
manage_etc_hosts: true
users:
  - name: ${VM_USER}
    shell: /bin/bash
    groups: sudo
    sudo: ALL=(ALL) NOPASSWD:ALL
    lock_passwd: false
    plain_text_passwd: ${VM_PASSWORD}
disable_root: false
ssh_pwauth: true
$(if [ -n "${ssh_public_key}" ]; then printf 'ssh_authorized_keys:\n  - %s\n' "${ssh_public_key}"; fi)
chpasswd:
  list: |
    ${VM_USER}:${VM_PASSWORD}
  expire: false
package_update: true
packages:
  - openssh-server
runcmd:
  - [ systemctl, enable, --now, ssh ]
CLOUDCFG

cat > "${META_DATA}" <<METADATA
instance-id: ${profile_name}
local-hostname: ${host_name}
METADATA

cloud-localds "${SEED_IMAGE}" "${USER_DATA}" "${META_DATA}"

download_base_image "${profile_image}"

if command -v qemu-img >/dev/null 2>&1; then
  qemu-img create -f qcow2 -F qcow2 -b "${BASE_IMAGE_PATH}" "${OVERLAY_IMAGE}" >/dev/null
fi

NVIRSH_L0_HOSTNAME="${host_name}" \
NVIRSH_L0_USER_DATA="${USER_DATA}" \
NVIRSH_L0_META_DATA="${META_DATA}" \
NVIRSH_L0_SEED_IMAGE="${SEED_IMAGE}" \
NVIRSH_L0_BASE_IMAGE="${BASE_IMAGE_PATH}" \
NVIRSH_L0_OVERLAY_IMAGE="${OVERLAY_IMAGE}" \
node - "${profile_file}" "${run_dir}/l0/provision.json" <<'NODE'
const fs = require("fs");
const [profileFile, outFile] = process.argv.slice(2);
const profile = JSON.parse(fs.readFileSync(profileFile, "utf8"));
const l0 = profile.l0 || {};
const payload = {
  layer: "l0",
  image: l0.image || null,
  hostName: process.env.NVIRSH_L0_HOSTNAME || null,
  workspace: l0.workspace || null,
  userData: process.env.NVIRSH_L0_USER_DATA || null,
  metaData: process.env.NVIRSH_L0_META_DATA || null,
  seedImage: process.env.NVIRSH_L0_SEED_IMAGE || null,
  baseImage: process.env.NVIRSH_L0_BASE_IMAGE || null,
  overlayImage: process.env.NVIRSH_L0_OVERLAY_IMAGE || null,
  status: "prepared",
  updatedAt: new Date().toISOString()
};
fs.writeFileSync(outFile, `${JSON.stringify(payload, null, 2)}\n`);
NODE

printf '[nvirsh] l0 provisioned image=%s host=%s workspace=%s\n' "${profile_image}" "${host_name}" "${profile_workspace}" >> "${log_file}"
