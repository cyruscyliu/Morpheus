#!/usr/bin/env python3
"""Unit tests for the sdg-extractor LLVM pass."""

import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

TESTS_DIR = Path(__file__).resolve().parent
TOOL_ROOT = TESTS_DIR.parent
BUILD_DIR = Path(
    os.environ.get("SDG_EXTRACTOR_BUILD_DIR", TOOL_ROOT / "builds" / "svf-test")
)
PLUGIN = BUILD_DIR / "src" / "llvm-pass" / "SDGExtractPass.so"
EXTAPI = TOOL_ROOT / "third_party" / "SVF" / "install" / "lib" / "extapi.bc"
FIXTURES = TESTS_DIR / "fixtures"


def run_opt(bitcode: Path, output: Path) -> None:
    subprocess.run(
        [
            "opt-15",
            "-load-pass-plugin",
            str(PLUGIN),
            "-passes=sdg-extract",
            "-sdg-output",
            str(output),
            "-sdg-extapi",
            str(EXTAPI),
            str(bitcode),
            "-o",
            "/dev/null",
        ],
        check=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
    )


def compile_fixture(name: str) -> Path:
    src = FIXTURES / name
    bc = src.with_suffix(".bc")
    subprocess.run(
        ["clang-15", "-emit-llvm", "-c", "-O1", "-g", str(src), "-o", str(bc)],
        check=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
    )
    return bc


def load_json(path: Path):
    with open(path) as f:
        return json.load(f)


def test_mmio_read():
    bc = compile_fixture("mmio_read.c")
    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp) / "out.json"
        run_opt(bc, out)
        data = load_json(out)

    nodes = data["nodes"]["nodes"]
    node_ids = {n["id"] for n in nodes}
    assert "mmio:4:4:version" in node_ids, node_ids
    assert "mmio:8:4:device_id" in node_ids, node_ids
    assert not any(node_id.startswith("mmio:32:") for node_id in node_ids)
    assert data["nodes"]["count"] == 2
    assert data["edges"]["self_count"] == 1
    device_id_edge = next(
        e for e in data["edges"]["self_edges"]
        if e["src"] == "mmio:8:4:device_id"
    )
    assert device_id_edge["predicate"]["kind"] == "Eq"
    assert device_id_edge["predicate"]["value"] == 0
    assert data["rules"]["count"] == 0


def test_feature_check():
    bc = compile_fixture("feature_check.c")
    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp) / "out.json"
        run_opt(bc, out)
        data = load_json(out)

    nodes = data["nodes"]["nodes"]
    node_ids = {n["id"] for n in nodes}
    assert "mmio:16:4:VIRTIO_NET_F_MAC" in node_ids, node_ids
    assert "mmio:16:4:VIRTIO_NET_F_MTU" in node_ids, node_ids
    assert "mmio:16:4:VIRTIO_F_NOTIFICATION_DATA" in node_ids, node_ids
    feature_bits = {
        n["source"]["field"]: (
            n["source"]["feature_bit"],
            n["source"]["feature_word_selector"],
            n["source"]["node_local_bit"],
        ) for n in nodes
    }
    assert feature_bits["VIRTIO_NET_F_MTU"] == (3, 0, 3)
    assert feature_bits["VIRTIO_F_NOTIFICATION_DATA"] == (38, 1, 6)


def test_dma_sink():
    bc = compile_fixture("dma_sink.c")
    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp) / "out.json"
        run_opt(bc, out)
        data = load_json(out)

    nodes = data["nodes"]["nodes"]
    node_ids = {n["id"] for n in nodes}
    assert "mmio:52:4:queue_size_max" in node_ids, node_ids

    # Ne is guard-only, so the explicit bound (n <= 4096) becomes the target.
    edge = next(
        e for e in data["edges"]["self_edges"]
        if e["src"] == "mmio:52:4:queue_size_max"
        and e["predicate"].get("kind") in ("Le", "Lt")
    )
    assert edge["predicate"]["value"] in (4096, 4097)
    assert data["rules"]["count"] == 1
    rule = data["rules"]["rules"][0]
    assert rule["target_state"]["predicate"]["kind"] in ("Le", "Lt")
    assert any(s["function"] == "kmalloc" for s in rule["sinks"])


def test_feature_inline():
    bc = compile_fixture("feature_inline.c")
    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp) / "out.json"
        run_opt(bc, out)
        data = load_json(out)

    nodes = {node["id"] for node in data["nodes"]["nodes"]}
    assert "mmio:16:4:device_features" in nodes, nodes


def test_net_config_read():
    bc = compile_fixture("net_config_read.c")
    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp) / "out.json"
        run_opt(bc, out)
        data = load_json(out)

    nodes = data["nodes"]["nodes"]
    mtu = next(n for n in nodes if n["id"] == "mmio:266:2:mtu")
    assert mtu["source"]["offset"] == 0x10A
    assert mtu["source"]["size_bytes"] == 2
    assert mtu["source"]["direction"] == "R"
    assert mtu["source"]["required_features_any_of"] == ["VIRTIO_NET_F_MTU"]
    assert mtu["source"]["evidence"] == "virtio-1.3:5.1.4"
    targets = data["edges"]["self_edges"]
    assert any(
        edge["src"] == mtu["id"]
        and edge["predicate"].get("kind") == "Gt"
        and edge["predicate"].get("value") == 1500
        and edge["predicate"].get("signedness") == "Unsigned"
        for edge in targets
    ), targets


def test_dma_formats():
    bc = compile_fixture("dma_formats.c")
    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp) / "out.json"
        run_opt(bc, out)
        data = load_json(out)

    nodes = {node["id"]: node for node in data["nodes"]["nodes"]}
    assert "coherent:2:2:used_idx" in nodes, nodes
    assert not any("packed_" in node_id for node_id in nodes)
    assert "streaming:0:4:2:virtio_net_hdr.gso_size" in nodes, nodes
    assert "streaming:0:6:2:virtio_net_hdr.csum_start" in nodes, nodes
    assert nodes["coherent:2:2:used_idx"]["source"]["direction"] == "device-writable"
    assert nodes["streaming:0:4:2:virtio_net_hdr.gso_size"]["source"]["slot"] == 0


def test_stored_field_flow():
    bc = compile_fixture("stored_field_flow.c")
    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp) / "out.json"
        run_opt(bc, out)
        data = load_json(out)

    node_ids = {n["id"] for n in data["nodes"]["nodes"]}
    assert "mmio:266:2:mtu" in node_ids, node_ids
    assert "internal:mtu" in node_ids, node_ids

    cross = data["edges"]["cross_edges"]
    assert any(
        e["src"] == "mmio:266:2:mtu"
        and e["dst"] == "internal:mtu"
        and e["head"] == "head_dataflow"
        for e in cross
    ), cross


def test_predicate_signedness():
    bc = compile_fixture("predicate_signedness.c")
    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp) / "out.json"
        run_opt(bc, out)
        data = load_json(out)

    edges = data["edges"]["self_edges"]
    speed_edges = [e for e in edges if e["src"] == "mmio:268:4:speed"]
    assert len(speed_edges) >= 2, [e["predicate"] for e in speed_edges]
    unsigned_gt = next(
        e for e in speed_edges
        if e["predicate"].get("kind") == "Gt"
        and e["predicate"].get("signedness") == "Unsigned"
        and e["predicate"].get("value") == 1500
    )
    assert unsigned_gt["src"] == unsigned_gt["dst"]

    # Operand reversal: 1000 < a becomes a > 1000.
    reversed = next(
        e for e in speed_edges
        if e["predicate"].get("kind") == "Gt"
        and e["predicate"].get("value") == 1000
    )
    assert reversed["src"] == reversed["dst"]

    mtu_edges = [e for e in edges if e["src"] == "mmio:266:2:mtu"]
    signed_lt = next(
        e for e in mtu_edges
        if e["predicate"].get("kind") == "Lt"
        and e["predicate"].get("signedness") == "Signed"
    )
    # 16-bit signed -10 serializes as the 16-bit bit pattern 0xfff6 = 65526.
    assert signed_lt["predicate"]["value"] == 65526


def test_head_offset_call():
    bc = compile_fixture("head_offset_call.c")
    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp) / "out.json"
        run_opt(bc, out)
        data = load_json(out)

    edges = data["edges"]["self_edges"]
    offset_edge = next(
        e for e in edges
        if e["src"] == "mmio:266:2:mtu"
    )
    assert offset_edge["head"] == "head_offset"
    assert offset_edge["predicate"]["kind"] == "Le"
    assert offset_edge["predicate"]["value"] == 15

    # Ne is guard-only; the size sink without a dominating concrete bound
    # becomes a missing-check finding.
    call_edge = next(
        e for e in edges
        if e["src"] == "mmio:268:4:speed"
        and e["predicate"].get("kind") == "Gt"
        and e["predicate"].get("value") is None
    )
    assert call_edge["head"] == "head_call"


def test_helper_check():
    bc = compile_fixture("helper_check.c")
    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp) / "out.json"
        run_opt(bc, out)
        data = load_json(out)

    # The helper body checks sz <= 64, which the compiler lowers to sz < 65
    # unsigned. The caller rejects when it is false, so the non-error target
    # state is the upper bound.
    edge = next(
        e for e in data["edges"]["self_edges"]
        if e["src"] == "mmio:268:4:speed"
        and e["predicate"].get("kind") in ("Le", "Lt")
    )
    assert edge["predicate"]["value"] in (64, 65)
    assert edge["predicate"]["signedness"] == "Unsigned"


def test_cross_guard():
    bc = compile_fixture("cross_guard.c")
    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp) / "out.json"
        run_opt(bc, out)
        data = load_json(out)

    rules = data["rules"]["rules"]
    assert rules, "expected at least one rule gated by a feature bit"
    rule = next(
        r for r in rules
        if r["target_state"]["src"] == "mmio:266:2:mtu"
    )
    pre = rule["preconditions"]
    assert any(
        p["predicate"].get("kind") == "BitSet"
        and p["predicate"].get("bit") == 3
        for p in pre
    ), pre


def test_missing_check():
    bc = compile_fixture("missing_check.c")
    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp) / "out.json"
        run_opt(bc, out)
        data = load_json(out)

    edge = next(
        e for e in data["edges"]["self_edges"]
        if e["src"] == "mmio:268:4:speed"
    )
    assert edge["head"] == "head_call"
    assert edge["predicate"]["kind"] == "Gt"
    assert edge["predicate"].get("value") is None


def test_canonical_rule_id():
    bc = compile_fixture("dma_sink.c")
    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp) / "out.json"
        run_opt(bc, out)
        data = load_json(out)

    assert data["rules"]["count"] == 1
    rule = data["rules"]["rules"][0]
    rule_id = rule["id"]
    # The canonical rule id keeps its fixed field order verbatim.
    assert rule_id.startswith("rule:"), rule_id
    assert "|target:" in rule_id and "|predicate:" in rule_id, rule_id
    function, rest = rule_id[len("rule:"):].split("|target:", 1)
    target, predicate_text = rest.split("|predicate:", 1)
    assert function == rule["function"], rule_id
    assert target == rule["target_state"]["dst"], rule_id
    # Distinct nodes never share a canonical id and node ids keep their
    # source kind, physical identity, and semantic field name.
    for var in rule["vars"]:
        expected = canonical_node_id_of(var["source"], var["id"])
        assert var["id"] == expected, var["id"]
    for pre in rule["preconditions"]:
        assert pre["src"] != pre["dst"], pre
        assert pre["head"], pre


def canonical_node_id_of(source: dict, fallback: str) -> str:
    kind = source["class"]
    offset = source.get("offset")
    size = source.get("size_bytes")
    field = source.get("field") or fallback
    slot = source.get("slot")
    if kind == "Mmio":
        return f"mmio:{offset}:{size}:{field}"
    if kind == "Dma" and source.get("access_kind") == "streaming":
        return f"streaming:{slot}:{offset}:{size}:{field}"
    if kind == "Dma":
        return f"coherent:{offset}:{size}:{field}"
    return f"internal:{field}"


def test_signed_inrange():
    bc = compile_fixture("signed_range.c")
    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp) / "out.json"
        run_opt(bc, out)
        data = load_json(out)

    edges = data["edges"]["self_edges"]
    # 16-bit signed [-10, 10]: the minimum is the two-complement pattern of
    # -10 (0xfff6 = 65526) and the range is ordered under signedness.
    in_range = next(
        e for e in edges if e["predicate"].get("kind") == "InRange"
    )
    assert in_range["src"] == "mmio:266:2:mtu", in_range
    assert in_range["dst"] == in_range["src"], in_range
    assert in_range["predicate"]["min"] == 65526, in_range["predicate"]
    assert in_range["predicate"]["max"] == 10, in_range["predicate"]
    assert in_range["predicate"]["signedness"] == "Signed", in_range["predicate"]


def test_cross_function_guard():
    bc = compile_fixture("cross_function_guard.c")
    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp) / "out.json"
        run_opt(bc, out)
        data = load_json(out)

    rules = data["rules"]["rules"]
    assert rules, "expected a rule whose sink lives in a callee"
    rule = next(
        r for r in rules
        if r["target_state"]["src"] == "mmio:266:2:mtu"
    )
    # The feature guard lives in configure while the sink lives in
    # consume_state; the precondition is proven through the call chain.
    pre = rule["preconditions"]
    assert any(
        p["src"] == "mmio:16:4:VIRTIO_NET_F_CTRL_VQ"
        and p["dst"] == "mmio:266:2:mtu"
        and p["head"] == "head_guard"
        and p["predicate"].get("kind") == "BitSet"
        and p["predicate"].get("bit") == 17
        for p in pre
    ), pre


def test_hp_dma_trace_telemetry():
    bc = compile_fixture("hp_dma_trace.c")
    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp) / "out.json"
        run_opt(bc, out)
        data = load_json(out)

    nodes = {n["id"]: n for n in data["nodes"]["nodes"]}
    # Telemetry events confirm DMA surfaces from the patch evidence: the
    # traced address provably names the buffer the value was read from, and
    # the vq-state event's virtqueue pointer owns the used ring.
    gso = nodes["streaming:0:4:2:virtio_net_hdr.gso_size"]
    assert gso["source"]["telemetry_event"] == "map", gso["source"]
    used = nodes["coherent:2:2:used_idx"]
    assert used["source"]["telemetry_event"] == "vq_get_buf", used["source"]
    # Telemetry never fabricates nodes: only the DMA candidates carry events.
    for node in nodes.values():
        if node["source"]["class"] != "Dma":
            assert node["source"]["telemetry_event"] is None, node["id"]
    # Negative case: the ack load has only unrelated events in its function,
    # so it has no provenance and no telemetry. Telemetry alone never
    # creates a source.
    assert "streaming:0:0:1:virtio_net_ctrl_ack.ack" not in nodes, sorted(nodes)
    rule = next(
        r for r in data["rules"]["rules"]
        if r["target_state"]["src"] == "streaming:0:4:2:virtio_net_hdr.gso_size"
    )
    # A MAP event whose traced address flows into the sink confirms it.
    assert any(
        s["function"] == "memcpy" and s["telemetry_confirmed"]
        for s in rule["sinks"]
    ), rule["sinks"]


def test_indirect_call_guard():
    bc = compile_fixture("indirect_call_guard.c")
    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp) / "out.json"
        run_opt(bc, out)
        data = load_json(out)

    rules = data["rules"]["rules"]
    assert rules, "expected a rule whose sink sits behind an indirect call"
    rule = next(
        r for r in rules
        if r["target_state"]["src"] == "mmio:266:2:mtu"
    )
    # The sink is reached through a function pointer; the guard precondition
    # is proven through the pointer-analysis-resolved call edge.
    pre = rule["preconditions"]
    assert any(
        p["src"] == "mmio:16:4:VIRTIO_NET_F_CTRL_VQ"
        and p["head"] == "head_guard"
        and p["predicate"].get("kind") == "BitSet"
        and p["predicate"].get("bit") == 17
        for p in pre
    ), pre


def test_guard_polarity():
    bc = compile_fixture("guard_polarity.c")
    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp) / "out.json"
        run_opt(bc, out)
        data = load_json(out)

    rules = data["rules"]["rules"]
    assert len(rules) == 2, [r["id"] for r in rules]
    # The callee on the bit-set branch gets BitSet; the callee on the
    # bit-clear branch gets BitClear. Both callees sink identically, so the
    # proof must carry the exact guarded successor and callsite.
    true_rule = next(r for r in rules if r["function"] == "sink_true")
    false_rule = next(r for r in rules if r["function"] == "sink_false")
    assert any(
        p["predicate"].get("kind") == "BitSet"
        and p["predicate"].get("bit") == 3
        for p in true_rule["preconditions"]
    ), true_rule["preconditions"]
    assert not any(
        p["predicate"].get("kind") == "BitClear"
        for p in true_rule["preconditions"]
    ), true_rule["preconditions"]
    assert any(
        p["predicate"].get("kind") == "BitClear"
        and p["predicate"].get("bit") == 3
        for p in false_rule["preconditions"]
    ), false_rule["preconditions"]
    assert not any(
        p["predicate"].get("kind") == "BitSet"
        for p in false_rule["preconditions"]
    ), false_rule["preconditions"]


def test_unproven_reads():
    bc = compile_fixture("unproven_reads.c")
    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp) / "out.json"
        run_opt(bc, out)
        data = load_json(out)

    # An arbitrary readl call at a catalog transport offset and an arbitrary
    # volatile load at a catalog config offset produce no Virtio MMIO node;
    # two arbitrary reads on the same unproven base never prove each other;
    # a generic ioremap of an unrelated region proves MMIO, not Virtio MMIO.
    assert data["nodes"]["count"] == 0, data["nodes"]["nodes"]


def test_unproven_dma():
    bc = compile_fixture("unproven_dma.c")
    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp) / "out.json"
        run_opt(bc, out)
        data = load_json(out)

    # The avail ring is driver-written, packed descriptors need ownership
    # proof, and the control request header is driver-to-device: none of
    # them is a device-controlled source.
    assert data["nodes"]["count"] == 0, data["nodes"]["nodes"]


def main():
    if not PLUGIN.exists():
        print(f"error: pass plugin not found at {PLUGIN}", file=sys.stderr)
        sys.exit(1)

    failures = 0
    for test in (
        test_mmio_read,
        test_feature_check,
        test_feature_inline,
        test_dma_sink,
        test_net_config_read,
        test_dma_formats,
        test_stored_field_flow,
        test_predicate_signedness,
        test_head_offset_call,
        test_helper_check,
        test_cross_guard,
        test_missing_check,
        test_canonical_rule_id,
        test_signed_inrange,
        test_cross_function_guard,
        test_hp_dma_trace_telemetry,
        test_indirect_call_guard,
        test_guard_polarity,
        test_unproven_reads,
        test_unproven_dma,
    ):
        try:
            test()
            print(f"PASS {test.__name__}")
        except Exception as e:
            print(f"FAIL {test.__name__}: {e}")
            failures += 1

    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
