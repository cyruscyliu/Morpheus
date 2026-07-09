#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
tmpdir="$(mktemp -d)"
trap 'rm -rf "${tmpdir}"' EXIT

report="${tmpdir}/replay.txt"

set +e
"${repo_root}/tools/devilang/scripts/replay-trace.sh" \
  --input "${repo_root}/tools/devilang/tests/fixtures/replay-trace/state/booting.state" \
  --input "${repo_root}/tools/devilang/tests/fixtures/replay-trace/state/runtime.state" \
  --trace-log "${repo_root}/tools/devilang/tests/fixtures/replay-trace/trace.txt" \
  --output "${report}" \
  --symbol-prefix virtio_trace_sm
status=$?
set -e

if [ "${status}" -ne 0 ] && [ "${status}" -ne 2 ]; then
  exit "${status}"
fi

grep -q "active 0 virtio_net_mmio_booting virtio_mmio_probe_trace entry 1" "${report}"
grep -q "active 0 virtio_net_mmio_booting virtio_mmio_probe_trace check_v2 2" "${report}"
grep -q "active 0 virtio_net_mmio_booting virtio_mmio_probe_trace read_vendor_modern 3" "${report}"
grep -q "active 0 virtio_net_mmio_booting virtnet_probe_trace entry 4" "${report}"
grep -q "event 5 line 5 matched 0 candidates 0" "${report}"
grep -q "halt unmatched_event" "${report}"
