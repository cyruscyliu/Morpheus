#!/usr/bin/env bash
set -euo pipefail

install_dir="${MORPHEUS_NQC2_INSTALL_DIR:?}"
coverage_output="${MORPHEUS_NQC2_COVERAGE_OUTPUT:?}"
output_dir="${MORPHEUS_NQC2_OUTPUT:?}"
title="${MORPHEUS_NQC2_TITLE:-NQC2 Coverage}"
result_file="${MORPHEUS_NQC2_RESULT_FILE:-${MORPHEUS_SCRIPT_RESULT_FILE:?}}"
source_dir=""

if ! command -v genhtml >/dev/null 2>&1; then
  echo "missing genhtml; run tools/nqc2/scripts/install-dependencies.sh" >&2
  exit 1
fi

if [ -n "${MORPHEUS_NQC2_SOURCE_DIR:-}" ]; then
  source_dir="${MORPHEUS_NQC2_SOURCE_DIR}"
else
  source_dir="$(
    python3 - <<'PY' "${coverage_output}"
from pathlib import Path
import sys

coverage = Path(sys.argv[1]).resolve()
workspace = None
for parent in coverage.parents:
    if parent.name == "workspace":
        workspace = parent
        break
if workspace is None:
    print("")
    raise SystemExit
sf = None
for line in coverage.read_text(errors='ignore').splitlines():
    if line.startswith('SF:'):
        sf = line[3:]
        break
if not sf:
    print("")
    raise SystemExit
sf_path = Path(sf)
if sf_path.is_absolute():
    print(str(sf_path.parent))
    raise SystemExit
matches = list(workspace.glob(f"tools/buildroot/builds/*/output/build/*/{sf}"))
if not matches:
    print("")
    raise SystemExit
match = matches[0].resolve()
root = match
for _ in sf_path.parts:
    root = root.parent
print(str(root))
PY
  )"
fi

mkdir -p "${output_dir}"
args=(
  --output-directory "${output_dir}"
  --title "${title}"
  --ignore-errors source
  --ignore-errors inconsistent
  --ignore-errors unsupported
  --synthesize-missing
)
if [ -n "${source_dir}" ]; then
  args+=(--source-directory "${source_dir}")
fi
args+=("${coverage_output}")

genhtml "${args[@]}"

cat > "${result_file}" <<EOF
{"details":{"coverage_output":"${coverage_output}","output":"${output_dir}","title":"${title}","source_dir":"${source_dir}"}}
EOF
