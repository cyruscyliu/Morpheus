#!/usr/bin/env python3
"""Convert sdg-rules.json into one .sdg text file per rule.

The .sdg format consumed by libafl is a line-oriented rule file:

    rule <rule-id>
    node <var-id> <region> <region-index> <slot> <offset>
    ...
    trigger <var-id> <predicate-op> [<value> ...]
    mutation <operator> [<value>]

Regions are derived from the source class:
    Mmio  -> mmio
    Dma + coherent  -> coherent
    Dma + streaming -> streaming
    other -> mmio (fallback)
"""

import argparse
import json
import os
import re
from pathlib import Path

TRIGGER_OPS = {
    "Eq": "eq",
    "Ne": "ne",
    "Gt": "gt",
    "Lt": "lt",
    "Ge": "ge",
    "Le": "le",
    "BitSet": "bit_set",
    "BitClear": "bit_clear",
    "InRange": "in_range",
}

MUTATION_OPS = {
    "SetValue": "set_value",
    "SetBoundary": "set_boundary",
    "SetBits": "set_bits",
    "ClearBits": "clear_bits",
    "SampleRange": "sample_range",
    "FlipBit": "flip_bit",
    "Inc": "inc",
    "Dec": "dec",
}


def sanitize_id(name: str) -> str:
    # Replace characters that are awkward in filenames with underscores.
    return re.sub(r"[^A-Za-z0-9_.-]", "_", name)


def region_for_source(src: dict) -> str:
    clazz = src.get("class", "")
    kind = src.get("access_kind", "")
    if clazz == "Dma":
        return "coherent" if kind == "coherent" else "streaming"
    return "mmio"


def slot_for_source(src: dict) -> int:
    off = src.get("offset")
    if off is None:
        return 0
    return int(off) // 4


def format_trigger(var_id: str, pred: dict) -> str:
    kind = pred.get("kind", "Ne")
    op = TRIGGER_OPS.get(kind, kind.lower())
    parts = [var_id, op]
    if kind == "BitSet" or kind == "BitClear":
        bit = pred.get("bit")
        if bit is not None:
            parts.append(str(bit))
    elif kind == "InRange":
        mn = pred.get("min", 0)
        mx = pred.get("max", 0)
        parts.extend([str(mn), str(mx)])
    else:
        val = pred.get("value")
        if val is not None:
            parts.append(str(val))
    return "trigger " + " ".join(parts)


def format_mutation(mut: dict) -> str:
    op = MUTATION_OPS.get(mut.get("operator", ""), mut.get("operator", ""))
    parts = [op]
    # Append a single numeric hint when available.
    val = mut.get("value")
    bit = mut.get("bit")
    if val is not None:
        parts.append(str(val))
    elif bit is not None:
        parts.append(str(bit))
    return "mutation " + " ".join(parts)


def convert_rule(rule: dict) -> str:
    lines = [f"rule {sanitize_id(rule.get('id', 'rule'))}"]
    for var in rule.get("vars", []):
        src = var.get("source", {})
        var_id = sanitize_id(var.get("id", "var"))
        region = region_for_source(src)
        region_idx = 0
        slot = slot_for_source(src)
        off = src.get("offset")
        off_hex = int(off) if off is not None else 0
        lines.append(
            f"node {var_id} {region} {region_idx} {slot} 0x{off_hex:x}"
        )

    trigger = rule.get("trigger", {})
    trigger_var = sanitize_id(trigger.get("src", ""))
    lines.append(format_trigger(trigger_var, trigger.get("predicate", {})))
    lines.append(format_mutation(rule.get("mutation", {})))
    return "\n".join(lines) + "\n"


def main():
    parser = argparse.ArgumentParser(description="Convert SDG JSON to .sdg files")
    parser.add_argument("--rules", required=True, type=Path, help="sdg-rules.json")
    parser.add_argument("--output", required=True, type=Path, help="output directory")
    args = parser.parse_args()

    with open(args.rules) as f:
        data = json.load(f)

    raw_rules = data.get("rules", [])
    if isinstance(raw_rules, dict):
        rules = raw_rules.get("rules", [])
    else:
        rules = raw_rules
    os.makedirs(args.output, exist_ok=True)

    written = 0
    for rule in rules:
        rid = rule.get("id", f"rule-{written}")
        fname = sanitize_id(rid) + ".sdg"
        out_path = args.output / fname
        out_path.write_text(convert_rule(rule))
        written += 1

    print(f"wrote {written} .sdg files to {args.output}")


if __name__ == "__main__":
    main()
