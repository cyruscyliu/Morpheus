#!/usr/bin/env python3

from __future__ import annotations

import argparse
import os
import re
from collections import defaultdict, deque
from pathlib import Path


EDGE_RE = re.compile(r'^\s*"([^"]+)" -> "([^"]+)";\s*$')
NODE_RE = re.compile(r'^\s*"([^"]+)";\s*$')
LABEL_RE = re.compile(r'^\s*label="([^"]+)";\s*$')

VIRTNET_ROOTS = {
    "virtnet_open",
    "virtnet_close",
    "start_xmit",
    "virtnet_set_mac_address",
    "virtnet_set_rx_mode",
    "virtnet_vlan_rx_add_vid",
    "virtnet_vlan_rx_kill_vid",
    "virtnet_xdp",
    "virtnet_xdp_xmit",
    "virtnet_xsk_wakeup",
    "virtnet_set_features",
    "virtnet_tx_timeout",
}

EXTRA_KEEP = {
    "try_fill_recv",
    "virtnet_add_recvbuf_xsk",
    "add_recvbuf_small",
    "add_recvbuf_mergeable",
    "add_recvbuf_big",
    "virtnet_rq_init_one_sg",
    "xmit_skb",
    "__virtnet_xdp_xmit_one",
    "virtnet_add_outbuf",
    "virtnet_send_command",
    "virtnet_send_command_reply",
    "virtnet_commit_rss_command",
    "virtnet_set_guest_offloads",
    "virtio_cwrite8",
    "virtqueue_kick",
    "virtqueue_kick_prepare",
    "virtqueue_notify",
    "vm_notify",
    "vm_notify_with_data",
    "virtqueue_add_inbuf",
    "virtqueue_add_inbuf_premapped",
    "virtqueue_add_outbuf",
    "virtqueue_add_outbuf_premapped",
    "virtqueue_add_sgs",
    "virtqueue_add",
}


def is_ignored_serial_helper(name: str) -> bool:
    return name.startswith("sg_") or name == "virtqueue_kick_prepare"


def parse_dot(path: Path):
    text = path.read_text()
    adj = defaultdict(set)
    rev = defaultdict(set)
    all_nodes = set()
    cluster_members = defaultdict(set)
    current_cluster = None

    for line in text.splitlines():
        edge = EDGE_RE.match(line)
        if edge:
            src, dst = edge.groups()
            adj[src].add(dst)
            rev[dst].add(src)
            all_nodes.add(src)
            all_nodes.add(dst)
            continue

        node = NODE_RE.match(line)
        if node:
            name = node.group(1)
            all_nodes.add(name)
            if current_cluster is not None:
                cluster_members[current_cluster].add(name)
            continue

        if line.strip().startswith("subgraph cluster_"):
            current_cluster = None
            continue

        label = LABEL_RE.match(line)
        if label:
            current_cluster = label.group(1)
            continue

        if line.strip() == "}":
            current_cluster = None

    return adj, rev, all_nodes, cluster_members


def parse_runtime_groups(path: Path):
    groups = defaultdict(set)
    current = None

    for raw_line in path.read_text().splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("["):
            current = re.sub(r"^(?:\[[^\]]+\])+\s*", "", line).strip()
            continue
        if current:
            groups[current].add(line)

    return groups


def bfs(starts, graph):
    seen = set()
    queue = deque(starts)
    while queue:
        node = queue.popleft()
        if node in seen:
            continue
        seen.add(node)
        for nxt in graph.get(node, ()):
            if nxt not in seen:
                queue.append(nxt)
    return seen


def emit_group(handle, group_id: str, label: str, nodes, fill: str, color: str):
    if not nodes:
        return
    handle.write(f"    subgraph cluster_{group_id} {{\n")
    handle.write(f'        label="{label}";\n')
    handle.write('        style="rounded,filled";\n')
    handle.write(f'        fillcolor="{fill}";\n')
    handle.write(f"        color={color};\n")
    handle.write(f"        fontcolor={color};\n")
    handle.write("        penwidth=2;\n")
    for node in sorted(nodes):
        handle.write(f'        "{node}";\n')
    handle.write("    }\n\n")


def main():
    parser = argparse.ArgumentParser(
        description="Extract a virtnet sink-oriented subgraph from an llcg DOT file."
    )
    parser.add_argument("input_dot", type=Path)
    parser.add_argument("output_dot", type=Path)
    parser.add_argument(
        "--runtime-groups",
        type=Path,
        default=(
            Path(os.environ.get("MORPHEUS_DATA_ROOT", "."))
            / "workspaces"
            / "hyperarm"
            / "tools"
            / "driver-callgraph"
            / "scripts"
            / "runtime-groups.txt"
        ),
    )
    args = parser.parse_args()

    adj, rev, all_nodes, cluster_members = parse_dot(args.input_dot)
    runtime_groups = parse_runtime_groups(args.runtime_groups)

    roots = VIRTNET_ROOTS & all_nodes
    mmio_sinks = cluster_members.get("virtio_mmio_config_ops", set()) & all_nodes
    io_sinks = runtime_groups.get("MMIO ops", set()) & all_nodes
    dma_sinks = runtime_groups.get("DMA ops", set()) & all_nodes
    sinks = mmio_sinks | io_sinks | dma_sinks

    reachable = bfs(roots, adj)
    can_reach_sinks = bfs(sinks, rev)
    selected = (reachable & can_reach_sinks) | roots | sinks

    for node in list(selected):
        for nxt in adj.get(node, ()):
            if nxt in EXTRA_KEEP:
                selected.add(nxt)
        for prev in rev.get(node, ()):
            if prev in EXTRA_KEEP:
                selected.add(prev)

    selected = {node for node in selected if not is_ignored_serial_helper(node)}

    edges = sorted(
        (src, dst)
        for src, dsts in adj.items()
        for dst in dsts
        if (
            src in selected
            and dst in selected
            and not is_ignored_serial_helper(src)
            and not is_ignored_serial_helper(dst)
        )
    )

    connected = {src for src, _ in edges} | {dst for _, dst in edges}
    selected = {n for n in selected if n in connected or n in roots or n in sinks}
    edges = sorted((src, dst) for src, dst in edges if src in selected and dst in selected)

    args.output_dot.parent.mkdir(parents=True, exist_ok=True)
    with args.output_dot.open("w") as handle:
        handle.write("digraph VirtnetSinkSubgraph {\n")
        handle.write("    rankdir=LR;\n")
        handle.write("    node [shape=box, style=filled, fillcolor=lightyellow];\n\n")

        emit_group(handle, "virtnet_roots", "virtnet_netdev roots", roots & selected,
                   "#eeffee", "darkgreen")
        emit_group(handle, "mmio_sinks", "virtio_mmio_config_ops", mmio_sinks & selected,
                   "#ffeaea", "darkred")
        emit_group(handle, "io_sinks", "IO sinks", io_sinks & selected,
                   "#fff2cc", "darkorange")
        emit_group(handle, "dma_sinks", "DMA and queue sinks", dma_sinks & selected,
                   "#ddeeff", "steelblue")

        grouped = roots | mmio_sinks | io_sinks | dma_sinks
        for node in sorted(selected - grouped):
            handle.write(f'    "{node}";\n')
        if selected - grouped:
            handle.write("\n")

        for src, dst in edges:
            attrs = []
            if dst in mmio_sinks:
                attrs.extend(["color=darkred", "penwidth=2"])
            elif dst in io_sinks:
                attrs.extend(["color=darkorange", "penwidth=2"])
            elif dst in dma_sinks:
                attrs.extend(["color=steelblue", "penwidth=2"])
            elif src in roots:
                attrs.append("color=darkgreen")

            if attrs:
                handle.write(f'    "{src}" -> "{dst}" [{", ".join(attrs)}];\n')
            else:
                handle.write(f'    "{src}" -> "{dst}";\n')

        handle.write("}\n")

    print(args.output_dot)
    print(f"nodes={len(selected)} edges={len(edges)}")


if __name__ == "__main__":
    main()
