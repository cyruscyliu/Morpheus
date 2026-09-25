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
BUILD_DIR = TOOL_ROOT / "builds" / "svf-test"
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
    assert "MmioTransport.version" in node_ids, node_ids
    assert "MmioTransport.device_id" in node_ids, node_ids
    assert data["nodes"]["count"] == 2
    assert data["edges"]["self_count"] >= 2


def test_feature_check():
    bc = compile_fixture("feature_check.c")
    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp) / "out.json"
        run_opt(bc, out)
        data = load_json(out)

    nodes = data["nodes"]["nodes"]
    node_ids = {n["id"] for n in nodes}
    assert "MmioFeature.VIRTIO_NET_F_MAC" in node_ids, node_ids


def test_dma_sink():
    bc = compile_fixture("dma_sink.c")
    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp) / "out.json"
        run_opt(bc, out)
        data = load_json(out)

    nodes = data["nodes"]["nodes"]
    node_ids = {n["id"] for n in nodes}
    assert "MmioTransport.queue_num_max" in node_ids, node_ids

    rules = data["rules"]["rules"]
    rule_ids = {r["id"] for r in rules}
    assert any("queue_num_max" in rid for rid in rule_ids), rule_ids
    assert any("kmalloc" in s["function"] for r in rules for s in r["sinks"])


def test_feature_inline():
    bc = compile_fixture("feature_inline.c")
    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp) / "out.json"
        run_opt(bc, out)
        data = load_json(out)

    edges = data["edges"]
    predicates = [e["predicate"] for e in edges["self_edges"] + edges["cross_edges"]]
    assert any(p.get("bit") == 5 and p.get("kind") in ("BitSet", "BitClear")
               for p in predicates), predicates


def main():
    if not PLUGIN.exists():
        print(f"error: pass plugin not found at {PLUGIN}", file=sys.stderr)
        sys.exit(1)

    failures = 0
    for test in (test_mmio_read, test_feature_check, test_feature_inline, test_dma_sink):
        try:
            test()
            print(f"PASS {test.__name__}")
        except Exception as e:
            print(f"FAIL {test.__name__}: {e}")
            failures += 1

    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
