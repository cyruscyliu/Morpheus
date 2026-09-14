#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
model="${repo_root}/tools/devilang/related-work/devgen_llm_virtual_device_synthesis.state"
tmpdir="$(mktemp -d)"
trap 'rm -rf "${tmpdir}"' EXIT

python3 "${repo_root}/tools/devilang/scripts/compile_state.py" \
  --input "${model}" \
  --output-c "${tmpdir}/devgen.c" \
  --output-h "${tmpdir}/devgen.h" \
  --symbol-prefix devgen_related_work

cc -std=c11 -Wall -Wextra -Werror -fsyntax-only \
  -I "${tmpdir}" \
  "${tmpdir}/devgen.c"

grep -q 'pci_identity_read' "${tmpdir}/devgen.c"
grep -q 'pci_bar_read' "${tmpdir}/devgen.c"
grep -q 'generated_mmio_access' "${tmpdir}/devgen.c"
grep -q 'external_interrupt_injected' "${tmpdir}/devgen.c"
grep -q 'return_concrete_value' "${tmpdir}/devgen.c"
! grep -q 'coverage' "${tmpdir}/devgen.c"
! grep -q 'repair' "${tmpdir}/devgen.c"

printf '%s\n' "DevGen-related Devilang model compiled successfully"
