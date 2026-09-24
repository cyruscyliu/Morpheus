#!/usr/bin/env python3
"""Compare two rule-set JSON files (e.g. LLM expected vs LLVM extracted)."""

import argparse
import json
import sys
from pathlib import Path


def normalize_sink_fn(name: str) -> str:
    name = name or ""
    for suffix in ("_noprof", "_node"):
        if name.endswith(suffix):
            name = name[: -len(suffix)]
    return name


def source_key(src: dict) -> tuple:
    # Use offset/feature_bit as the canonical semantic key; field names can
    # differ between LLM labels and LLVM-extracted labels.
    return (
        src.get("class"),
        src.get("access_kind"),
        src.get("offset"),
        src.get("feature_bit"),
    )


def rule_key(r: dict) -> tuple:
    sinks = tuple(
        (normalize_sink_fn(s.get("function")), s.get("arg_index"), s.get("role"))
        for s in sorted(r.get("sinks", []), key=lambda x: x.get("function", ""))
    )
    var_keys = tuple(
        source_key(v.get("source", {}))
        for v in sorted(r.get("vars", []), key=lambda x: str(x.get("source", {})))
    )
    # Function names differ between LLM rules (often the sink site) and LLVM
    # rules (the source site); match by source semantics + sinks only.
    return (var_keys, sinks)


def rule_body(r: dict) -> dict:
    trigger = r.get("trigger", {})
    return {
        "trigger_predicate": trigger.get("predicate"),
        "mutation": r.get("mutation"),
        "preconditions": sorted(
            (e.get("predicate") for e in r.get("preconditions", [])),
            key=lambda p: str(p),
        ),
    }


def semantic_match(a: dict, b: dict, strict: bool = False) -> bool:
    # By default we count a structural match (same source + sinks) as enough,
    # because LLM-generated rules are often missing trigger/precondition
    # details. In strict mode the bodies must agree exactly.
    if not strict:
        return True
    return rule_body(a) == rule_body(b)


def load_rules(path: Path) -> list:
    data = json.load(open(path))
    if "rules" in data and isinstance(data["rules"], dict):
        return data["rules"].get("rules", [])
    return data.get("rules", [])


def compare(llm_rules: list, llvm_rules: list, strict: bool = False) -> dict:
    llm_by_key = {}
    for r in llm_rules:
        k = rule_key(r)
        # Allow duplicate keys by storing lists.
        llm_by_key.setdefault(k, []).append(r)
    llvm_by_key = {}
    for r in llvm_rules:
        llvm_by_key.setdefault(rule_key(r), []).append(r)

    matched = []
    llm_only = []
    llvm_only = []

    for key, lrs in llm_by_key.items():
        if key in llvm_by_key:
            rrs = llvm_by_key[key]
            for lr in lrs:
                found = None
                for idx, rr in enumerate(rrs):
                    if semantic_match(lr, rr, strict=strict):
                        found = idx
                        break
                if found is not None:
                    matched.append((lr["id"], rrs.pop(found)["id"]))
                else:
                    llm_only.append(lr["id"])
            if rrs:
                for rr in rrs:
                    llvm_only.append(rr["id"])
            del llvm_by_key[key]
        else:
            llm_only.extend(r["id"] for r in lrs)

    for rrs in llvm_by_key.values():
        llvm_only.extend(r["id"] for r in rrs)

    return {"matched": matched, "llm_only": llm_only, "llvm_only": llvm_only}


def main():
    parser = argparse.ArgumentParser(description="Compare LLM and LLVM rule sets.")
    parser.add_argument("--llm", required=True, type=Path, help="LLM rules JSON")
    parser.add_argument("--llvm", required=True, type=Path, help="LLVM rules JSON")
    parser.add_argument("--output", type=Path, help="Write comparison report as JSON")
    parser.add_argument(
        "--strict", action="store_true",
        help="Require trigger/mutation/precondition equality in addition to source+sinks"
    )
    args = parser.parse_args()

    llm_rules = load_rules(args.llm)
    llvm_rules = load_rules(args.llvm)
    result = compare(llm_rules, llvm_rules, strict=args.strict)

    print(f"LLM rules:   {len(llm_rules)}")
    print(f"LLVM rules:  {len(llvm_rules)}")
    print(f"Matched:     {len(result['matched'])}")
    print(f"LLM-only:    {len(result['llm_only'])}")
    print(f"LLVM-only:   {len(result['llvm_only'])}")

    if result["matched"]:
        print("\nMatched rules:")
        for lid, rid in result["matched"]:
            print(f"  LLM:{lid}  <=>  LLVM:{rid}")
    if result["llm_only"]:
        print("\nLLM-only (need verdict):")
        for rid in result["llm_only"]:
            print(f"  - {rid}")
    if result["llvm_only"]:
        print("\nLLVM-only (need verdict):")
        for rid in result["llvm_only"]:
            print(f"  - {rid}")

    if args.output:
        with open(args.output, "w") as f:
            json.dump(result, f, indent=2)
        print(f"\nReport written to {args.output}")


if __name__ == "__main__":
    main()
