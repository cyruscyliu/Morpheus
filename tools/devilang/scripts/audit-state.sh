#!/usr/bin/env bash
set -euo pipefail

tool_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
repo_root="$(cd "${tool_root}/../.." && pwd)"
result_file="${MORPHEUS_DEVILANG_RESULT_FILE:-${MORPHEUS_SCRIPT_RESULT_FILE:?}}"
input_file="${MORPHEUS_DEVILANG_INPUT_FILE:-}"
input_inline="${MORPHEUS_DEVILANG_INPUT:-}"

collect_list() {
  local file_path="$1"
  local inline_text="$2"
  local -n output_ref=$3
  output_ref=()
  if [ -n "${inline_text}" ]; then
    while IFS= read -r item; do
      [ -n "${item}" ] || continue
      output_ref+=("${item}")
    done <<< "${inline_text}"
    return
  fi
  if [ -n "${file_path}" ] && [ -s "${file_path}" ]; then
    while IFS= read -r item; do
      [ -n "${item}" ] || continue
      output_ref+=("${item}")
    done < "${file_path}"
  fi
}

collect_list "${input_file}" "${input_inline}" audit_inputs

if [ "${#audit_inputs[@]}" -eq 0 ]; then
  echo "devilang audit-state requires at least one --input" >&2
  exit 1
fi

for i in "${!audit_inputs[@]}"; do
  if [[ "${audit_inputs[$i]}" != /* ]]; then
    audit_inputs[$i]="${repo_root}/${audit_inputs[$i]#./}"
  fi
done

python3 - "${result_file}" "${audit_inputs[@]}" <<'EOF'
import json
import re
import sys
from pathlib import Path

result_file = Path(sys.argv[1])
inputs = [Path(arg) for arg in sys.argv[2:]]

reply_only = {
    "virtio_net_ctrl_status",
    "virtio_net_stats_capabilities",
    "virtio_net_stats_reply_hdr",
    "virtio_net_stats_cvq",
    "virtio_net_stats_rx_basic",
    "virtio_net_stats_tx_basic",
    "virtio_net_stats_rx_csum",
    "virtio_net_stats_tx_csum",
    "virtio_net_stats_rx_gso",
    "virtio_net_stats_tx_gso",
    "virtio_net_stats_rx_speed",
    "virtio_net_stats_tx_speed",
}
request_only = {
    "virtio_net_ctrl_hdr",
    "virtio_net_ctrl_hdr_mac",
    "virtio_net_ctrl_hdr_vlan_add",
    "virtio_net_ctrl_hdr_vlan_del",
    "virtio_net_ctrl_hdr_mq",
    "virtio_net_ctrl_hdr_guest_offloads",
    "virtio_net_ctrl_hdr_coal_rx",
    "virtio_net_ctrl_hdr_coal_tx",
    "virtio_net_ctrl_hdr_coal_vq",
    "virtio_net_ctrl_hdr_queue_stats",
    "virtio_net_ctrl_mac_addr",
    "virtio_net_ctrl_vlan",
    "virtio_net_ctrl_mq",
    "virtio_net_ctrl_coal_rx",
    "virtio_net_ctrl_coal_tx",
    "virtio_net_ctrl_coal_vq",
    "virtio_net_ctrl_queue_stats",
    "virtio_net_guest_offloads",
    "virtio_net_rss_config_hdr",
    "virtio_net_rss_config_trailer",
    "VIRTIO_NET_CTRL_CTRL_HDR_11",
    "VIRTIO_NET_CTRL_CTRL_HDR_40",
    "VIRTIO_NET_CTRL_CTRL_HDR_41",
    "VIRTIO_NET_CTRL_CTRL_HDR_5",
    "VIRTIO_NET_CTRL_CTRL_HDR_COAL_RX",
    "VIRTIO_NET_CTRL_CTRL_HDR_COAL_TX",
    "VIRTIO_NET_CTRL_CTRL_HDR_COAL_VQ",
    "VIRTIO_NET_CTRL_CTRL_HDR_QUEUE_STATS",
}

head_re = re.compile(r"head\s+(\w+)_head\s*\{\s*position = (.*?);\s*to = \1;", re.S)
dma_re = re.compile(r"dir=([^,]+).*data_type=([^,\)]+)")
kind_type_re = re.compile(r"dir=([^,]+).*data_kind=([^,\)]+)(?:, data_type=([^,\)]+))?")
pointer_re = re.compile(r"pointer\s*\{\s*from = ([^;]+);\s*to = ([^;]+);", re.S)
forbidden_field_aliases = (
    "virtio_net_hdr_v1_hash_tunnel__hash_hdr__",
    "virtio_net_hdr__hash_hdr__",
)

all_findings = []
per_file = []

for path in inputs:
    text = path.read_text()
    findings = []
    for match in head_re.finditer(text):
        name = match.group(1)
        position = match.group(2)
        if "virtqueue_" in position or "vring_" in position:
            findings.append({
                "kind": "transport_head_noise",
                "head": name,
            })

    for alias in forbidden_field_aliases:
        if alias in text:
            findings.append({
                "kind": "uncanonicalized_field_alias",
                "alias": alias,
            })

    pointer_targets = {}
    for match in pointer_re.finditer(text):
        source = match.group(1).strip()
        targets = tuple(part.strip() for part in match.group(2).split("|"))
        pointer_targets.setdefault(source, []).append(targets)

    def has_pointer(source, *required):
        for targets in pointer_targets.get(source, []):
            if all(item in targets for item in required):
                return True
        return False

    generic_pointer_expectations = [
        ("VIRTIO_NET_TX_VRING.addr0", ("VIRTIO_NET_TX_BUF0",)),
        ("VIRTIO_NET_RX_VRING.addr0", ("VIRTIO_NET_RX_BUF0",)),
        ("VIRTIO_NET_CTRL_VRING.addr0", ("VIRTIO_NET_CTRL_BUF0",)),
        ("vring_desc.addr", ("VIRTIO_NET_TX_BUF0",)),
        ("vring_desc.addr", ("VIRTIO_NET_RX_BUF0",)),
        ("vring_desc.addr", ("VIRTIO_NET_CTRL_BUF0",)),
        ("vring_packed_desc.addr", ("VIRTIO_NET_TX_BUF0",)),
        ("vring_packed_desc.addr", ("VIRTIO_NET_RX_BUF0",)),
        ("vring_packed_desc.addr", ("VIRTIO_NET_CTRL_BUF0",)),
        ("virtnet_rq_dma.addr", ("VIRTIO_NET_RX_BUF0",)),
    ]
    for source, required in generic_pointer_expectations:
        if source in pointer_targets and not has_pointer(source, *required):
            findings.append({
                "kind": "missing_generic_pointer_layer",
                "source": source,
                "required_targets": list(required),
            })

    role_pointer_expectations = [
        ("VIRTIO_NET_CTRL_VRING.addr0", ("VIRTIO_NET_CTRL_CTRL_HDR_11",)),
        ("VIRTIO_NET_CTRL_VRING.addr1", ("virtio_net_ctrl_status", "virtio_net_rss_config_trailer")),
        ("VIRTIO_NET_CTRL_VRING.addr2", ("virtio_net_ctrl_status", "virtio_net_stats_reply_hdr")),
        ("VIRTIO_NET_CTRL_VRING.addr3", ("virtio_net_stats_reply_hdr",)),
        ("vring_desc.addr", ("VIRTIO_NET_CTRL_CTRL_HDR_11",)),
        ("vring_desc.addr", ("virtio_net_ctrl_status", "virtio_net_rss_config_trailer")),
        ("vring_desc.addr", ("virtio_net_ctrl_status", "virtio_net_stats_reply_hdr")),
        ("vring_desc.addr", ("virtio_net_stats_reply_hdr",)),
        ("vring_packed_desc.addr", ("VIRTIO_NET_CTRL_CTRL_HDR_11",)),
        ("vring_packed_desc.addr", ("virtio_net_ctrl_status", "virtio_net_rss_config_trailer")),
        ("vring_packed_desc.addr", ("virtio_net_ctrl_status", "virtio_net_stats_reply_hdr")),
        ("vring_packed_desc.addr", ("virtio_net_stats_reply_hdr",)),
    ]
    for source, required in role_pointer_expectations:
        if source in pointer_targets and not has_pointer(source, *required):
            findings.append({
                "kind": "missing_role_pointer_layer",
                "source": source,
                "required_targets": list(required),
            })

    for lineno, line in enumerate(text.splitlines(), 1):
        if "dma_event(" not in line:
            continue
        match = dma_re.search(line)
        if not match:
            continue
        direction, data_type = match.groups()
        kind_match = kind_type_re.search(line)
        data_kind = kind_match.group(2) if kind_match else ""
        if direction == "to_device" and data_type in reply_only:
            findings.append({
                "kind": "reply_payload_sent_to_device",
                "line": lineno,
                "data_type": data_type,
            })
        if direction == "from_device" and data_type in request_only:
            findings.append({
                "kind": "request_payload_received_from_device",
                "line": lineno,
                "data_type": data_type,
            })
        if data_type == "unknown":
            findings.append({
                "kind": "unknown_payload_type",
                "line": lineno,
            })
        if data_type == "xdp_frame" and direction == "from_device":
            findings.append({
                "kind": "xdp_frame_from_device",
                "line": lineno,
            })
        if data_type == "virtio_net_hdr_v1_hash_tunnel" and direction == "from_device":
            findings.append({
                "kind": "hash_tunnel_header_from_device",
                "line": lineno,
            })
        if data_type == "virtio_net_stats_capabilities" and direction != "from_device":
            findings.append({
                "kind": "stats_capabilities_wrong_direction",
                "line": lineno,
                "direction": direction,
            })
        if data_type == "virtio_net_ctrl_status" and data_kind != "sg_buffer":
            findings.append({
                "kind": "ctrl_status_wrong_data_kind",
                "line": lineno,
                "data_kind": data_kind,
            })

    per_file.append({
        "path": str(path),
        "findings": findings,
    })
    all_findings.extend([{"path": str(path), **item} for item in findings])

success = not all_findings
counts_by_kind = {}
for item in all_findings:
    kind = str(item.get("kind", "unknown"))
    counts_by_kind[kind] = counts_by_kind.get(kind, 0) + 1
payload = {
    "summary": "audited devilang state files" if success else "devilang state audit failed",
    "details": {
        "files": per_file,
        "findings_count": len(all_findings),
        "findings_by_kind": counts_by_kind,
    },
    "artifacts": [{"path": "input", "location": str(path)} for path in inputs],
}
result_file.write_text(json.dumps(payload, indent=2) + "\n")
if not success:
    print(json.dumps(payload, indent=2))
    sys.exit(1)
EOF
