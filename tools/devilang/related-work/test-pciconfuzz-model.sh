#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
model="${repo_root}/tools/devilang/related-work/pciconfuzz_pcie_configuration_probe.state"
tmpdir="$(mktemp -d)"
trap 'rm -rf "${tmpdir}"' EXIT

python3 "${repo_root}/tools/devilang/scripts/compile_state.py" \
  --input "${model}" \
  --output-c "${tmpdir}/pciconfuzz.c" \
  --output-h "${tmpdir}/pciconfuzz.h" \
  --symbol-prefix pciconfuzz_related_work

cc -std=c11 -Wall -Wextra -Werror -fsyntax-only \
  -I "${tmpdir}" \
  "${tmpdir}/pciconfuzz.c"

grep -q 'enumeration_concrete' "${tmpdir}/pciconfuzz.c"
grep -q 'probe_capability_chain' "${tmpdir}/pciconfuzz.c"
grep -q 'probe_mmio_access' "${tmpdir}/pciconfuzz.c"
grep -q 'trigger_interrupt_write' "${tmpdir}/pciconfuzz.c"
grep -q 'interrupt_event' "${model}"
grep -q 'external_probe_restore' "${tmpdir}/pciconfuzz.c"
grep -q 'return_input_stream_value' "${tmpdir}/pciconfuzz.c"
! grep -q 'redqueen' "${tmpdir}/pciconfuzz.c"
! grep -q 'dma_event' "${model}"

printf '%s\n' "PCIconfuzz-related Devilang model compiled successfully"
