#!/usr/bin/env python3
"""Compare LLM-generated expected rules against LLVM-extracted rules."""

import json
import subprocess
import sys
import tempfile
from pathlib import Path

TESTS_DIR = Path(__file__).resolve().parent
TOOL_ROOT = TESTS_DIR.parent
BUILD_DIR = TOOL_ROOT / "builds" / "arm64-clang15" / "build"
PLUGIN = BUILD_DIR / "SDGExtractPass.so"
FIXTURES = TESTS_DIR / "fixtures"
LLM_RULES = TESTS_DIR / "llm_rules"


def run_opt(bitcode: Path, output: Path) -> None:
    subprocess.run(
        [
            "opt-15",
            "-load-pass-plugin",
            str(PLUGIN),
            "-passes=sdg-extract",
            "-sdg-output",
            str(output),
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


def rule_key(r: dict) -> tuple:
    """A stable key that identifies the semantic intent of a rule."""
    sinks = tuple(
        (s.get("function"), s.get("arg_index"), s.get("role"))
        for s in sorted(r.get("sinks", []), key=lambda x: x.get("function", ""))
    )
    var_ids = tuple(v.get("id") for v in r.get("vars", []))
    return (r.get("function"), var_ids, sinks)


def rule_body(r: dict) -> dict:
    """Detailed content used for exact comparison after grouping."""
    return {
        "trigger": r.get("trigger"),
        "mutation": r.get("mutation"),
        "preconditions": sorted(
            r.get("preconditions", []),
            key=lambda e: (e.get("src"), e.get("dst"), str(e.get("predicate"))),
        ),
    }


def exact_match(a: dict, b: dict) -> bool:
    return rule_body(a) == rule_body(b)


def load_json(path: Path):
    with open(path) as f:
        return json.load(f)


def compare_fixture(name: str) -> dict:
    bc = compile_fixture(name)
    llm_path = LLM_RULES / f"{Path(name).stem}.json"
    llm_data = load_json(llm_path)
    llm_rules = llm_data.get("rules", [])

    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp) / "out.json"
        run_opt(bc, out)
        llvm_data = load_json(out)

    llvm_rules = llvm_data.get("rules", {}).get("rules", [])

    llm_by_key = {rule_key(r): r for r in llm_rules}
    llvm_by_key = {rule_key(r): r for r in llvm_rules}

    matched = []
    llm_only = []
    llvm_only = []

    for key, lr in llm_by_key.items():
        if key in llvm_by_key:
            rr = llvm_by_key[key]
            if exact_match(lr, rr):
                matched.append(lr["id"])
            else:
                # Same semantic group but detail differs; treat as mismatch to review.
                llm_only.append(lr["id"])
                llvm_only.append(rr["id"])
        else:
            llm_only.append(lr["id"])

    for key, rr in llvm_by_key.items():
        if key not in llm_by_key:
            llvm_only.append(rr["id"])

    return {
        "llm_count": len(llm_rules),
        "llvm_count": len(llvm_rules),
        "matched": matched,
        "llm_only": llm_only,
        "llvm_only": llvm_only,
        "llm_rules": llm_rules,
        "llvm_rules": llvm_rules,
    }


def main():
    if not PLUGIN.exists():
        print(f"error: pass plugin not found at {PLUGIN}", file=sys.stderr)
        sys.exit(1)

    fixtures = ["mmio_read.c", "feature_check.c", "feature_inline.c", "dma_sink.c"]
    total = {"llm": 0, "llvm": 0, "matched": 0, "llm_only": 0, "llvm_only": 0}

    for name in fixtures:
        result = compare_fixture(name)
        total["llm"] += result["llm_count"]
        total["llvm"] += result["llvm_count"]
        total["matched"] += len(result["matched"])
        total["llm_only"] += len(result["llm_only"])
        total["llvm_only"] += len(result["llvm_only"])

        print(f"\n=== {name} ===")
        print(f"  LLM rules:   {result['llm_count']}")
        print(f"  LLVM rules:  {result['llvm_count']}")
        print(f"  Matched:     {len(result['matched'])}")
        if result["matched"]:
            for rid in result["matched"]:
                print(f"    + {rid}")
        if result["llm_only"]:
            print(f"  LLM-only (need verdict): {len(result['llm_only'])}")
            for rid in result["llm_only"]:
                print(f"    - {rid}")
        if result["llvm_only"]:
            print(f"  LLVM-only (need verdict): {len(result['llvm_only'])}")
            for rid in result["llvm_only"]:
                print(f"    - {rid}")

    print("\n=== Summary ===")
    print(f"Total LLM rules:   {total['llm']}")
    print(f"Total LLVM rules:  {total['llvm']}")
    print(f"Matched:           {total['matched']}")
    print(f"LLM-only:          {total['llm_only']}")
    print(f"LLVM-only:         {total['llvm_only']}")


if __name__ == "__main__":
    main()
