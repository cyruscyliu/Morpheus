#!/usr/bin/env bash
set -euo pipefail

profile_file="${MORPHEUS_NVIRSH_PROFILE_FILE:?}"
run_dir="${MORPHEUS_NVIRSH_RUN_DIR:?}"
log_file="${MORPHEUS_NVIRSH_LOG_FILE:?}"

mkdir -p "${run_dir}/l1"

cat > "${run_dir}/l1/install-dependencies.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

if ! command -v apt-get >/dev/null 2>&1; then
  echo "install-dependencies.sh currently supports apt-based systems only" >&2
  exit 1
fi

PYTHON_PKG="$(python3 - <<'PY'
import sys
print(f"python{sys.version_info.major}.{sys.version_info.minor}")
PY
)"

sudo apt-get update
sudo apt-get install -y \
  python3-venv \
  "${PYTHON_PKG}-venv" \
  python3-pip \
  python3-setuptools \
  meson \
  ninja-build \
  pkg-config \
  build-essential \
  libglib2.0-dev \
  libpixman-1-dev \
  libslirp-dev

for bin in pkg-config meson ninja; do
  if ! command -v "${bin}" >/dev/null 2>&1; then
    echo "failed to provision required host binary: ${bin}" >&2
    exit 1
  fi
done
EOF
chmod +x "${run_dir}/l1/install-dependencies.sh"

node - "${profile_file}" "${run_dir}/l1/provision.json" <<'NODE'
const fs = require("fs");
const [profileFile, outFile] = process.argv.slice(2);
const profile = JSON.parse(fs.readFileSync(profileFile, "utf8"));
const l1 = profile.l1 || {};
const l0 = profile.l0 || {};
const payload = {
  layer: "l1",
  workspace: l0.workspace || null,
  replaceKernel: Boolean(l1.replaceKernel),
  provisionScript: "l1/install-dependencies.sh",
  status: "prepared",
  updatedAt: new Date().toISOString()
};
fs.writeFileSync(outFile, `${JSON.stringify(payload, null, 2)}\n`);
NODE

printf '[nvirsh] l1 userspace provision artifacts written for %s\n' "$(node -e 'const fs=require("fs"); const p=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(String((p.l0 && p.l0.workspace) || ""));' "${profile_file}")" >> "${log_file}"
