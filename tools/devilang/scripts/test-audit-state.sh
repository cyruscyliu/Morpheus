#!/usr/bin/env bash
set -euo pipefail

tool_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
repo_root="$(cd "${tool_root}/../.." && pwd)"
result_file="${MORPHEUS_DEVILANG_RESULT_FILE:-${MORPHEUS_SCRIPT_RESULT_FILE:?}}"
tmpdir="$(mktemp -d)"
trap 'rm -rf "${tmpdir}"' EXIT

pass_state="${repo_root}/tools/devilang/tests/fixtures/audit-state/pass.state"
pass_pointer_state="${repo_root}/tools/devilang/tests/fixtures/audit-state/pass-pointer.state"
fail_state="${repo_root}/tools/devilang/tests/fixtures/audit-state/fail.state"
fail_pointer_state="${repo_root}/tools/devilang/tests/fixtures/audit-state/fail-pointer.state"
fail_role_state="${repo_root}/tools/devilang/tests/fixtures/audit-state/fail-role.state"
fail_unknown_state="${repo_root}/tools/devilang/tests/fixtures/audit-state/fail-unknown.state"
fail_direction_state="${repo_root}/tools/devilang/tests/fixtures/audit-state/fail-direction.state"
fail_alias_state="${repo_root}/tools/devilang/tests/fixtures/audit-state/fail-alias.state"

pass_result="${tmpdir}/pass.json"
fail_result="${tmpdir}/fail.json"
fail_pointer_result="${tmpdir}/fail-pointer.json"
fail_role_result="${tmpdir}/fail-role.json"
fail_unknown_result="${tmpdir}/fail-unknown.json"
fail_direction_result="${tmpdir}/fail-direction.json"
fail_alias_result="${tmpdir}/fail-alias.json"

env MORPHEUS_SCRIPT_RESULT_FILE="${pass_result}" \
  MORPHEUS_DEVILANG_RESULT_FILE="${pass_result}" \
  MORPHEUS_DEVILANG_INPUT="${pass_state}"$'\n'"${pass_pointer_state}" \
  bash "${tool_root}/scripts/audit-state.sh"

set +e
env MORPHEUS_SCRIPT_RESULT_FILE="${fail_result}" \
  MORPHEUS_DEVILANG_RESULT_FILE="${fail_result}" \
  MORPHEUS_DEVILANG_INPUT="${fail_state}" \
  bash "${tool_root}/scripts/audit-state.sh" \
  >"${tmpdir}/fail.stdout" \
  2>"${tmpdir}/fail.stderr"
fail_rc=$?
set -e

if [ "${fail_rc}" -eq 0 ]; then
  echo "audit-state unexpectedly accepted failing fixture" >&2
  exit 1
fi

set +e
env MORPHEUS_SCRIPT_RESULT_FILE="${fail_pointer_result}" \
  MORPHEUS_DEVILANG_RESULT_FILE="${fail_pointer_result}" \
  MORPHEUS_DEVILANG_INPUT="${fail_pointer_state}" \
  bash "${tool_root}/scripts/audit-state.sh" \
  >"${tmpdir}/fail-pointer.stdout" \
  2>"${tmpdir}/fail-pointer.stderr"
fail_pointer_rc=$?
set -e

if [ "${fail_pointer_rc}" -eq 0 ]; then
  echo "audit-state unexpectedly accepted failing pointer fixture" >&2
  exit 1
fi

set +e
env MORPHEUS_SCRIPT_RESULT_FILE="${fail_role_result}" \
  MORPHEUS_DEVILANG_RESULT_FILE="${fail_role_result}" \
  MORPHEUS_DEVILANG_INPUT="${fail_role_state}" \
  bash "${tool_root}/scripts/audit-state.sh" \
  >"${tmpdir}/fail-role.stdout" \
  2>"${tmpdir}/fail-role.stderr"
fail_role_rc=$?
set -e

if [ "${fail_role_rc}" -eq 0 ]; then
  echo "audit-state unexpectedly accepted failing role fixture" >&2
  exit 1
fi

set +e
env MORPHEUS_SCRIPT_RESULT_FILE="${fail_unknown_result}" \
  MORPHEUS_DEVILANG_RESULT_FILE="${fail_unknown_result}" \
  MORPHEUS_DEVILANG_INPUT="${fail_unknown_state}" \
  bash "${tool_root}/scripts/audit-state.sh" \
  >"${tmpdir}/fail-unknown.stdout" \
  2>"${tmpdir}/fail-unknown.stderr"
fail_unknown_rc=$?
set -e

if [ "${fail_unknown_rc}" -eq 0 ]; then
  echo "audit-state unexpectedly accepted failing unknown fixture" >&2
  exit 1
fi

set +e
env MORPHEUS_SCRIPT_RESULT_FILE="${fail_direction_result}" \
  MORPHEUS_DEVILANG_RESULT_FILE="${fail_direction_result}" \
  MORPHEUS_DEVILANG_INPUT="${fail_direction_state}" \
  bash "${tool_root}/scripts/audit-state.sh" \
  >"${tmpdir}/fail-direction.stdout" \
  2>"${tmpdir}/fail-direction.stderr"
fail_direction_rc=$?
set -e

if [ "${fail_direction_rc}" -eq 0 ]; then
  echo "audit-state unexpectedly accepted failing direction fixture" >&2
  exit 1
fi

set +e
env MORPHEUS_SCRIPT_RESULT_FILE="${fail_alias_result}" \
  MORPHEUS_DEVILANG_RESULT_FILE="${fail_alias_result}" \
  MORPHEUS_DEVILANG_INPUT="${fail_alias_state}" \
  bash "${tool_root}/scripts/audit-state.sh" \
  >"${tmpdir}/fail-alias.stdout" \
  2>"${tmpdir}/fail-alias.stderr"
fail_alias_rc=$?
set -e

if [ "${fail_alias_rc}" -eq 0 ]; then
  echo "audit-state unexpectedly accepted failing alias fixture" >&2
  exit 1
fi

python3 - "${fail_result}" "${fail_pointer_result}" "${fail_role_result}" "${fail_unknown_result}" "${fail_direction_result}" "${fail_alias_result}" <<'EOF'
import json
import sys
from pathlib import Path

fail_payload = json.loads(Path(sys.argv[1]).read_text())
fail_pointer_payload = json.loads(Path(sys.argv[2]).read_text())
fail_role_payload = json.loads(Path(sys.argv[3]).read_text())
fail_unknown_payload = json.loads(Path(sys.argv[4]).read_text())
fail_direction_payload = json.loads(Path(sys.argv[5]).read_text())
fail_alias_payload = json.loads(Path(sys.argv[6]).read_text())
if int(fail_payload.get("details", {}).get("findings_count", 0)) <= 0:
    raise SystemExit("expected failing fixture to produce findings")
if int(fail_pointer_payload.get("details", {}).get("findings_count", 0)) <= 0:
    raise SystemExit("expected failing pointer fixture to produce findings")
if "missing_generic_pointer_layer" not in fail_pointer_payload.get("details", {}).get("findings_by_kind", {}):
    raise SystemExit("expected missing_generic_pointer_layer finding")
if int(fail_role_payload.get("details", {}).get("findings_count", 0)) <= 0:
    raise SystemExit("expected failing role fixture to produce findings")
if "missing_role_pointer_layer" not in fail_role_payload.get("details", {}).get("findings_by_kind", {}):
    raise SystemExit("expected missing_role_pointer_layer finding")
if int(fail_unknown_payload.get("details", {}).get("findings_count", 0)) <= 0:
    raise SystemExit("expected failing unknown fixture to produce findings")
if "unknown_payload_type" not in fail_unknown_payload.get("details", {}).get("findings_by_kind", {}):
    raise SystemExit("expected unknown_payload_type finding")
if int(fail_direction_payload.get("details", {}).get("findings_count", 0)) <= 0:
    raise SystemExit("expected failing direction fixture to produce findings")
for key in (
    "request_payload_received_from_device",
    "xdp_frame_from_device",
    "hash_tunnel_header_from_device",
    "stats_capabilities_wrong_direction",
):
    if key not in fail_direction_payload.get("details", {}).get("findings_by_kind", {}):
        raise SystemExit(f"expected {key} finding")
if int(fail_alias_payload.get("details", {}).get("findings_count", 0)) <= 0:
    raise SystemExit("expected failing alias fixture to produce findings")
if "uncanonicalized_field_alias" not in fail_alias_payload.get("details", {}).get("findings_by_kind", {}):
    raise SystemExit("expected uncanonicalized_field_alias finding")
EOF

python3 - "${result_file}" "${pass_result}" "${fail_result}" "${fail_pointer_result}" "${fail_role_result}" "${fail_unknown_result}" "${fail_direction_result}" "${fail_alias_result}" "${pass_state}" "${pass_pointer_state}" "${fail_state}" "${fail_pointer_state}" "${fail_role_state}" "${fail_unknown_state}" "${fail_direction_state}" "${fail_alias_state}" <<'EOF'
import json
import sys
from pathlib import Path

result_path = Path(sys.argv[1])
pass_payload = json.loads(Path(sys.argv[2]).read_text())
fail_payload = json.loads(Path(sys.argv[3]).read_text())
fail_pointer_payload = json.loads(Path(sys.argv[4]).read_text())
fail_role_payload = json.loads(Path(sys.argv[5]).read_text())
fail_unknown_payload = json.loads(Path(sys.argv[6]).read_text())
fail_direction_payload = json.loads(Path(sys.argv[7]).read_text())
fail_alias_payload = json.loads(Path(sys.argv[8]).read_text())
pass_fixture = Path(sys.argv[9])
pass_pointer_fixture = Path(sys.argv[10])
fail_fixture = Path(sys.argv[11])
fail_pointer_fixture = Path(sys.argv[12])
fail_role_fixture = Path(sys.argv[13])
fail_unknown_fixture = Path(sys.argv[14])
fail_direction_fixture = Path(sys.argv[15])
fail_alias_fixture = Path(sys.argv[16])

payload = {
    "summary": "validated devilang audit-state pass/fail fixtures",
    "details": {
        "pass_findings": pass_payload.get("details", {}).get("findings_count", 0),
        "fail_findings": fail_payload.get("details", {}).get("findings_count", 0),
        "fail_findings_by_kind": fail_payload.get("details", {}).get("findings_by_kind", {}),
        "fail_pointer_findings": fail_pointer_payload.get("details", {}).get("findings_count", 0),
        "fail_pointer_findings_by_kind": fail_pointer_payload.get("details", {}).get("findings_by_kind", {}),
        "fail_role_findings": fail_role_payload.get("details", {}).get("findings_count", 0),
        "fail_role_findings_by_kind": fail_role_payload.get("details", {}).get("findings_by_kind", {}),
        "fail_unknown_findings": fail_unknown_payload.get("details", {}).get("findings_count", 0),
        "fail_unknown_findings_by_kind": fail_unknown_payload.get("details", {}).get("findings_by_kind", {}),
        "fail_direction_findings": fail_direction_payload.get("details", {}).get("findings_count", 0),
        "fail_direction_findings_by_kind": fail_direction_payload.get("details", {}).get("findings_by_kind", {}),
        "fail_alias_findings": fail_alias_payload.get("details", {}).get("findings_count", 0),
        "fail_alias_findings_by_kind": fail_alias_payload.get("details", {}).get("findings_by_kind", {}),
    },
    "artifacts": [
        {"path": "pass-fixture", "location": str(pass_fixture)},
        {"path": "pass-pointer-fixture", "location": str(pass_pointer_fixture)},
        {"path": "fail-fixture", "location": str(fail_fixture)},
        {"path": "fail-pointer-fixture", "location": str(fail_pointer_fixture)},
        {"path": "fail-role-fixture", "location": str(fail_role_fixture)},
        {"path": "fail-unknown-fixture", "location": str(fail_unknown_fixture)},
        {"path": "fail-direction-fixture", "location": str(fail_direction_fixture)},
        {"path": "fail-alias-fixture", "location": str(fail_alias_fixture)},
    ],
}
result_path.write_text(json.dumps(payload, indent=2) + "\n")
EOF
