#!/usr/bin/env bash
set -euo pipefail

tool_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
repo_root="$(cd "${tool_root}/../.." && pwd)"
result_file="${MORPHEUS_DEVILANG_RESULT_FILE:-${MORPHEUS_SCRIPT_RESULT_FILE:?}}"
build_dir="${MORPHEUS_DEVILANG_BUILD_DIR:-${tool_root}/build}"
llcg_build_dir="${MORPHEUS_DEVILANG_LLCG_BUILD_DIR:-}"
devilang_bin="${build_dir}/bin/devilang"
fixture="${repo_root}/tools/devilang/tests/fixtures/phase-models/phase-topology.ll"
tmpdir="$(mktemp -d)"
trap 'rm -rf "${tmpdir}"' EXIT

booting_state="${tmpdir}/booting.state"
runtime_state="${tmpdir}/runtime.state"
compile_result="${tmpdir}/compile.json"
compiled_c="${tmpdir}/phase-models.c"
compiled_h="${tmpdir}/phase-models.h"
svf_extapi_bc=""

[ -x "${devilang_bin}" ] || {
  echo "missing devilang binary at ${devilang_bin}" >&2
  exit 1
}

if [ -n "${llcg_build_dir}" ] && [ -f "${llcg_build_dir}/svf/lib/extapi.bc" ]; then
  svf_extapi_bc="${llcg_build_dir}/svf/lib/extapi.bc"
elif [ -f "${build_dir}/bin/extapi.bc" ]; then
  svf_extapi_bc="${build_dir}/bin/extapi.bc"
fi

[ -n "${svf_extapi_bc}" ] || {
  echo "missing SVF extapi.bc for devilang phase-model test" >&2
  exit 1
}

"${devilang_bin}" \
  --module "${fixture}" \
  --booting-entry boot_transport \
  --booting-entry boot_driver \
  --booting-output "${booting_state}" \
  --booting-machine-name phase_booting \
  --runtime-entry runtime_open \
  --runtime-entry runtime_close \
  --runtime-output "${runtime_state}" \
  --runtime-machine-name phase_runtime \
  --svf-extapi "${svf_extapi_bc}"

grep -q '^machine phase_booting {$' "${booting_state}"
grep -q '^    entry trace register_virtio_device_trace {$' "${booting_state}"
grep -q '^    entry trace virtio_dev_probe_trace {$' "${booting_state}"
grep -q '^    transition state_0 -> state_1 on boot_transport_trace$' "${booting_state}"
grep -q '^    transition state_1 -> state_2 on register_virtio_device_trace$' "${booting_state}"
grep -q '^    transition state_2 -> state_3 on virtio_dev_probe_trace$' "${booting_state}"
grep -q '^    transition state_3 -> state_4 on boot_driver_trace$' "${booting_state}"

grep -q '^machine phase_runtime {$' "${runtime_state}"
grep -q '^    transition state_0 -> state_0 on runtime_open_trace$' "${runtime_state}"
grep -q '^    transition state_0 -> state_0 on runtime_close_trace$' "${runtime_state}"
if grep -q '^    transition state_0 -> state_1 on runtime_open_trace$' "${runtime_state}"; then
  echo "runtime machine unexpectedly chained runtime_open_trace" >&2
  exit 1
fi

env MORPHEUS_SCRIPT_RESULT_FILE="${compile_result}" \
  MORPHEUS_DEVILANG_RESULT_FILE="${compile_result}" \
  MORPHEUS_DEVILANG_OUTPUT_C="${compiled_c}" \
  MORPHEUS_DEVILANG_OUTPUT_H="${compiled_h}" \
  MORPHEUS_DEVILANG_INPUT="${booting_state}"$'\n'"${runtime_state}" \
  bash "${tool_root}/scripts/compile-state.sh"

python3 - "${result_file}" "${fixture}" "${build_dir}" "${svf_extapi_bc}" <<'EOF'
import json
import sys
from pathlib import Path

result_path = Path(sys.argv[1])
fixture = Path(sys.argv[2])
build_dir = Path(sys.argv[3])
svf_extapi_bc = Path(sys.argv[4])
payload = {
    "summary": "validated devilang booting/runtime phase-model generation",
    "details": {
        "fixture": str(fixture),
        "build_dir": str(build_dir),
        "svf_extapi": str(svf_extapi_bc),
        "booting_chain": [
            "boot_transport_trace",
            "register_virtio_device_trace",
            "virtio_dev_probe_trace",
            "boot_driver_trace",
        ],
        "runtime_entries": [
            "runtime_open_trace",
            "runtime_close_trace",
        ],
    },
    "artifacts": [
        {"path": "fixture", "location": str(fixture)},
        {"path": "build-dir", "location": str(build_dir)},
    ],
}
result_path.write_text(json.dumps(payload, indent=2) + "\n")
EOF
