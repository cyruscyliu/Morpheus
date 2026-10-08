#!/usr/bin/env python3
"""AST source catalog test: builds the tool and checks that the three
device-written surfaces are classified and the unproven read is not.

Usage: python3 test_ast_scan.py
"""

import os
import subprocess
import sys
import tempfile
from pathlib import Path

TESTS_DIR = Path(__file__).resolve().parent
TOOL_ROOT = TESTS_DIR.parent
BUILD_DIR = Path(os.environ.get("SDG_AST_BUILD_DIR", TOOL_ROOT / "builds" / "default"))
TOOL = BUILD_DIR / "ast_source_scan"
FIXTURE = TESTS_DIR / "fixtures" / "member_assign_read.c"

ARGS = ["-std=gnu11", "-x", "c"]


def main() -> None:
    if not TOOL.exists():
        print(f"error: tool not found at {TOOL} (run scripts/build.sh)",
              file=sys.stderr)
        sys.exit(1)

    with tempfile.TemporaryDirectory() as tmp:
        args_file = Path(tmp) / "flags.txt"
        args_file.write_text("\n".join(ARGS) + "\n")
        proc = subprocess.run(
            [str(TOOL), str(args_file), str(FIXTURE)],
            capture_output=True,
            text=True,
            cwd=str(TOOL.parent.parent),
        )
        if proc.returncode != 0:
            print(proc.stdout)
            print(proc.stderr, file=sys.stderr)
            sys.exit(1)
        out = proc.stdout

    counts = {}
    sink_counts = {}
    for line in out.splitlines():
        if line.startswith("  ") and ": " in line and "reads" not in line and "sinks" not in line:
            surface, n = line.strip().rsplit(": ", 1)
            if surface in ("Mmio", "Coherent", "Streaming"):
                counts[surface] = int(n)

    print(out.strip())
    missing = [s for s in ("Mmio", "Coherent", "Streaming") if s not in counts]
    if missing:
        print(f"FAIL: missing surfaces: {missing}")
        sys.exit(1)
    if "read_unproven" in out:
        print("FAIL: unproven read was classified")
        sys.exit(1)
    if "sinks discovered: 0" in out or "sink[Coherent]" not in out:
        print("FAIL: no Coherent sink discovered")
        sys.exit(1)
    if "self-edges built: 0" in out:
        print("FAIL: no self-edges built")
        sys.exit(1)
    if "head_guard" not in out:
        print("FAIL: no head_guard self-edge")
        sys.exit(1)
    if "head_call" not in out:
        print("FAIL: no head_call self-edge")
        sys.exit(1)
    if "BitSet(3)" not in out:
        print("FAIL: no BitSet(3) mask self-edge")
        sys.exit(1)
    if "cross-edges built: 0" in out:
        print("FAIL: no cross-edges built")
        sys.exit(1)
    if "BitSet(60)" not in out:
        print("FAIL: no feature-bit gate from the bit-test helper")
        sys.exit(1)
    if "virtio_dev.features_array --[head_guard, BitSet(60)]--> " \
            "drv_state.gated_len" not in out:
        print("FAIL: no transitive feature gate on the gated read")
        sys.exit(1)
    if "key --[head_bound, Lt(256)]--> key" not in out:
        print("FAIL: no clamp-bound self-edge")
        sys.exit(1)
    if "key --[head_guard, Gt(256)]--> key" not in out:
        print("FAIL: no bounded var-vs-var degrade self-edge")
        sys.exit(1)
    if "i --[head_offset, Lt(4)]--> i" not in out:
        print("FAIL: no bounded loop-counter offset self-edge")
        sys.exit(1)
    if "head_guard" not in out.split("cross-edges built")[1]:
        print("FAIL: no head_guard cross-edge")
        sys.exit(1)
    if "head_dataflow" not in out.split("cross-edges built")[1]:
        print("FAIL: no head_dataflow cross-edge")
        sys.exit(1)
    if "head_bound" not in out.split("cross-edges built")[1]:
        print("FAIL: no var-vs-var head_bound cross-edge")
        sys.exit(1)
    print("PASS: surfaces classified; sink + self-edges (guard/call/mask)"
          " + cross-edges (guard/dataflow/bound) built")


if __name__ == "__main__":
    main()
