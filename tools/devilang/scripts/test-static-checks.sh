#!/usr/bin/env bash
set -euo pipefail

tool_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
repo_root="$(cd "${tool_root}/../.." && pwd)"
result_file="${MORPHEUS_DEVILANG_RESULT_FILE:-${MORPHEUS_SCRIPT_RESULT_FILE:?}}"
tmpdir="$(mktemp -d)"
trap 'rm -rf "${tmpdir}"' EXIT

pass_state="${repo_root}/tools/devilang/tests/fixtures/static-checks/pass.state"
fail_layout_state="${repo_root}/tools/devilang/tests/fixtures/static-checks/fail-layout.state"
fail_topology_state="${repo_root}/tools/devilang/tests/fixtures/static-checks/fail-topology.state"
fail_machine_state="${repo_root}/tools/devilang/tests/fixtures/static-checks/fail-machine.state"
fail_mmio_dma_state="${repo_root}/tools/devilang/tests/fixtures/static-checks/fail-mmio-dma.state"

run_compile() {
  local state_file="$1"
  local out_prefix="$2"
  local result_path="${tmpdir}/${out_prefix}.json"
  env MORPHEUS_SCRIPT_RESULT_FILE="${result_path}" \
    MORPHEUS_DEVILANG_RESULT_FILE="${result_path}" \
    MORPHEUS_DEVILANG_OUTPUT_C="${tmpdir}/${out_prefix}.c" \
    MORPHEUS_DEVILANG_OUTPUT_H="${tmpdir}/${out_prefix}.h" \
    MORPHEUS_DEVILANG_INPUT="${state_file}" \
    bash "${tool_root}/scripts/compile-state.sh"
}

run_compile "${pass_state}" "pass"

declare -A fail_expected=(
  ["${fail_layout_state}"]="align modifier is only legal"
  ["${fail_topology_state}"]="link field next is not present on all member types"
  ["${fail_machine_state}"]="goto target @done is not declared"
  ["${fail_mmio_dma_state}"]="size must be one of 1, 2, 4, or 8 bytes"
)

for state_file in "${!fail_expected[@]}"; do
  name="$(basename "${state_file}" .state)"
  set +e
  env MORPHEUS_SCRIPT_RESULT_FILE="${tmpdir}/${name}.json" \
    MORPHEUS_DEVILANG_RESULT_FILE="${tmpdir}/${name}.json" \
    MORPHEUS_DEVILANG_OUTPUT_C="${tmpdir}/${name}.c" \
    MORPHEUS_DEVILANG_OUTPUT_H="${tmpdir}/${name}.h" \
    MORPHEUS_DEVILANG_INPUT="${state_file}" \
    bash "${tool_root}/scripts/compile-state.sh" \
    >"${tmpdir}/${name}.stdout" \
    2>"${tmpdir}/${name}.stderr"
  rc=$?
  set -e
  if [ "${rc}" -eq 0 ]; then
    echo "compile-state unexpectedly accepted ${state_file}" >&2
    exit 1
  fi
  if ! grep -q "${fail_expected[${state_file}]}" "${tmpdir}/${name}.stderr"; then
    echo "compile-state did not report expected semantic failure for ${state_file}" >&2
    cat "${tmpdir}/${name}.stderr" >&2
    exit 1
  fi
done

python3 - "${result_file}" "${pass_state}" "${fail_layout_state}" "${fail_topology_state}" "${fail_machine_state}" "${fail_mmio_dma_state}" <<'EOF'
import json
import sys
from pathlib import Path

result_path = Path(sys.argv[1])
payload = {
    "summary": "validated devilang static semantic checks",
    "details": {
        "pass_fixture": str(Path(sys.argv[2])),
        "fail_fixtures": [str(Path(arg)) for arg in sys.argv[3:]],
    },
    "artifacts": [
        {"path": "pass-fixture", "location": str(Path(sys.argv[2]))},
        *[
            {"path": f"fail-fixture-{idx}", "location": str(Path(arg))}
            for idx, arg in enumerate(sys.argv[3:], start=1)
        ],
    ],
}
result_path.write_text(json.dumps(payload, indent=2) + "\n")
EOF
