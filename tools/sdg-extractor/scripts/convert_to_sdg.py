#!/usr/bin/env python3
"""Convert sdg-rules.json into one .sdg text file per rule.

The .sdg format consumed by libafl is a line-oriented rule file:

    rule <canonical rule id, preserved verbatim>
    node <node-id> mmio <offset> <size>
    node <node-id> coherent <offset> <size>
    node <node-id> streaming <slot> <offset> <size>
    precondition <src-node-id> <dst-node-id> <head> <op> [<signedness>] <value...>
    trigger <node-id> <head> <op> [<signedness>] <value...>
    mutation <operator> [<value>]

Condition lines keep the full canonical edge identity: source node,
destination node, head, and predicate. Surfaces are derived from the source
class:
    Mmio  -> mmio
    Dma + coherent  -> coherent
    Dma + streaming -> streaming
Unsupported or physically unresolved sources are rejected.

Relational predicates with Unknown (or missing) signedness are expanded into
one signed and one unsigned rule candidate before serialization; neither is
silently chosen over the other.
"""

import argparse
import copy
import hashlib
import json
import os
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

RELATIONAL_KINDS = {"Lt", "Gt", "Le", "Ge", "InRange"}

MUTATION_OPS = {
    "SetValue": "set_value",
    "SetBoundary": "set_boundary",
    "SetBits": "set_bits",
    "ClearBits": "clear_bits",
    "SampleRange": "sample_range",
    "FlipBit": "flip_bit",
    "Inc": "inc",
    "Dec": "dec",
    "Keep": "keep",
}

HEADS = {"head_guard", "head_dataflow", "head_bound", "head_offset", "head_call"}

MAX_ACCESS_BYTES = 8


def sanitize_filename(name: str) -> str:
    # Only for filenames; the canonical rule id inside the file is verbatim.
    return "".join(c if c.isalnum() or c in "._-" else "_" for c in name)


def region_for_source(src: dict) -> str:
    clazz = src.get("class", "")
    kind = src.get("access_kind", "")
    if clazz == "Dma":
        return "coherent" if kind == "coherent" else "streaming"
    if clazz == "Mmio":
        return "mmio"
    raise ValueError(f"source class {clazz or '<missing>'} is not physically lowerable")


def slot_for_source(src: dict) -> int:
    slot = src.get("slot")
    if slot is None:
        raise ValueError("streaming source has no protocol slot")
    return int(slot)


def size_for_source(src: dict) -> int:
    return int(src.get("size_bytes") or src.get("width_bytes") or 0)


def signed_value(pattern: int, width_bits: int) -> int:
    """Two-complement interpretation of a width-limited bit pattern."""
    if width_bits <= 0 or width_bits > 64:
        raise ValueError(f"invalid width {width_bits}")
    if pattern >= (1 << (width_bits - 1)):
        return pattern - (1 << width_bits)
    return pattern


def condition_tokens(pred: dict) -> list:
    """Predicate tokens shared by trigger and precondition lines."""
    kind = pred.get("kind")
    op = TRIGGER_OPS.get(kind)
    if op is None:
        raise ValueError(f"predicate kind {kind or '<missing>'} is not serializable")
    tokens = [op]
    if kind in {"BitSet", "BitClear"}:
        bit = pred.get("bit")
        if bit is None:
            raise ValueError(f"{kind} predicate has no bit")
        tokens.append(str(bit))
    elif kind == "InRange":
        signedness = pred.get("signedness")
        if signedness not in {"Signed", "Unsigned"}:
            raise ValueError("InRange signedness is not resolved")
        tokens.append(signedness.lower())
        tokens.extend([str(pred.get("min", 0)), str(pred.get("max", 0))])
    elif kind in RELATIONAL_KINDS:
        signedness = pred.get("signedness")
        if signedness not in {"Signed", "Unsigned"}:
            raise ValueError(f"{kind} signedness is not resolved")
        tokens.append(signedness.lower())
        tokens.append(str(pred.get("value", 0)))
    else:
        tokens.append(str(pred.get("value", 0)))
    return tokens


def predicate_is_valid(pred: dict, src: dict) -> bool:
    kind = pred.get("kind")
    size = size_for_source(src)
    if size <= 0 or size > MAX_ACCESS_BYTES:
        return False
    width = size * 8
    if kind in {"BitSet", "BitClear"}:
        bit = pred.get("bit")
        return isinstance(bit, int) and 0 <= bit < width
    if kind == "InRange":
        minimum = pred.get("min")
        maximum = pred.get("max")
        if not (isinstance(minimum, int) and isinstance(maximum, int)):
            return False
        if not (0 <= minimum < (1 << width) and 0 <= maximum < (1 << width)):
            return False
        if pred.get("signedness") == "Signed":
            return signed_value(minimum, width) <= signed_value(maximum, width)
        return minimum <= maximum
    value = pred.get("value")
    return isinstance(value, int) and 0 <= value < (1 << width)


def format_condition(keyword: str, edge: dict) -> str:
    head = edge.get("head", "")
    if head not in HEADS:
        raise ValueError(f"edge head {head or '<missing>'} is unknown")
    pred = edge.get("predicate", {})
    parts = [keyword, edge.get("src", ""), edge.get("dst", ""), head]
    parts.extend(condition_tokens(pred))
    return " ".join(parts)


def format_trigger(edge: dict) -> str:
    src = edge.get("src", "")
    dst = edge.get("dst", "")
    if src != dst:
        raise ValueError("target state is not a self-edge")
    head = edge.get("head", "")
    if head not in HEADS:
        raise ValueError(f"edge head {head or '<missing>'} is unknown")
    parts = ["trigger", dst, head]
    parts.extend(condition_tokens(edge.get("predicate", {})))
    return " ".join(parts)


def format_mutation(mut: dict, target_var: str) -> str:
    op = MUTATION_OPS.get(mut.get("operator", ""))
    if op is None:
        raise ValueError(f"mutation operator {mut.get('operator') or '<missing>'} is unknown")
    # The mutation var must match the rule's target variable exactly.
    var = mut.get("var")
    if var is not None and var != target_var:
        raise ValueError(f"mutation var {var} does not match the target variable {target_var}")
    parts = [op]
    if op == "sample_range":
        parts.extend([str(mut["min"]), str(mut["max"])])
    elif op == "set_boundary":
        side = str(mut.get("side", "")).lower()
        if side not in {"above", "below", "min", "max"}:
            raise ValueError(f"set_boundary side {side or '<missing>'} is unknown")
        parts.append(side)
    elif op == "keep":
        pass
    elif op in ("set_bits", "clear_bits"):
        mask = mut.get("mask")
        if mask is None:
            mask = mut.get("value")
        if mask is None:
            raise ValueError(f"{mut.get('operator')} has no mask")
        parts.append(str(mask))
    elif op in ("inc", "dec"):
        delta = mut.get("delta")
        if delta is None:
            delta = mut.get("value")
        if delta is None:
            raise ValueError(f"{mut.get('operator')} has no delta")
        parts.append(str(delta))
    elif op == "flip_bit":
        bit = mut.get("bit")
        if bit is None:
            raise ValueError("FlipBit has no bit")
        parts.append(str(bit))
    else:
        value = mut.get("value")
        if value is None:
            raise ValueError(f"{mut.get('operator')} has no value")
        parts.append(str(value))
    return "mutation " + " ".join(parts)


def predicate_text(pred: dict) -> str:
    """Canonical predicate serialization from the SDG document: decimal
    values without leading zeroes and explicit signedness for relational
    predicates."""
    kind = pred.get("kind")
    if kind in {"BitSet", "BitClear"}:
        return f"{TRIGGER_OPS[kind]}:{pred.get('bit', 0)}"
    if kind == "InRange":
        signedness = pred.get("signedness", "Unknown")
        return f"in_range:{signedness.lower()}:{pred.get('min', 0)}:{pred.get('max', 0)}"
    if kind in {"Eq", "Ne"}:
        return f"{kind.lower()}:{pred.get('value', 0)}"
    signedness = pred.get("signedness", "Unknown")
    return f"{kind.lower()}:{signedness.lower()}:{pred.get('value', 0)}"


def canonical_rule_id(rule: dict) -> str:
    trigger = rule.get("target_state", rule.get("trigger", {}))
    return (
        f"rule:{rule.get('function', '')}"
        f"|target:{trigger.get('dst', '')}"
        f"|predicate:{predicate_text(trigger.get('predicate', {}))}"
    )


def pred_is_unresolved(pred: dict) -> bool:
    return pred.get("kind") in RELATIONAL_KINDS and pred.get("signedness") not in ("Signed", "Unsigned")


def expand_precondition_candidates(rule: dict) -> list:
    """Replace every unresolved precondition with its signed and unsigned
    candidate lines. The candidates are alternatives: the runtime
    at-least-one rule is satisfied by either candidate, so all independent
    signed/unsigned combinations are represented without creating extra
    rules or corrupting canonical ids."""
    preconditions = rule.get("preconditions", [])
    expanded = []
    for pre in preconditions:
        pred = pre.get("predicate", {})
        if pred_is_unresolved(pred):
            for signedness in ("Signed", "Unsigned"):
                candidate = copy.deepcopy(pre)
                candidate["predicate"]["signedness"] = signedness
                expanded.append(candidate)
        else:
            expanded.append(pre)
    rule["preconditions"] = expanded
    return rule


def expand_unknown_signedness(rule: dict) -> list:
    """Expand Unknown relational signedness. A target-state predicate
    determines the canonical rule id, so its expansion produces two rule
    candidates with distinct ids. A precondition's expansion produces
    alternative candidate lines inside each rule, so it never creates extra
    rules or identity conflicts. No signedness is ever silently chosen."""
    target_pred = rule.get("target_state", {}).get("predicate", {})
    if not pred_is_unresolved(target_pred):
        # Only preconditions may be unresolved.
        variant = copy.deepcopy(rule)
        expand_precondition_candidates(variant)
        return [(variant, rule.get("id"))]
    variants = []
    for signedness in ("Signed", "Unsigned"):
        variant = copy.deepcopy(rule)
        variant["target_state"]["predicate"]["signedness"] = signedness
        expand_precondition_candidates(variant)
        variant["id"] = canonical_rule_id(variant)
        variants.append((variant, variant["id"]))
    return variants


def convert_rule(rule: dict) -> str:
    rule_id = rule.get("id")
    if not rule_id:
        raise ValueError("rule has no canonical id")
    lines = [f"rule {rule_id}"]
    vars_by_id = {var.get("id"): var for var in rule.get("vars", [])}
    trigger = rule.get("target_state", rule.get("trigger", {}))
    trigger_id = trigger.get("src", "")
    trigger_var = vars_by_id.get(trigger_id)
    if trigger_var is None or not predicate_is_valid(
        trigger.get("predicate", {}), trigger_var.get("source", {})
    ):
        raise ValueError("target state is not valid for its node width")

    valid_preconditions = []
    for precondition in rule.get("preconditions", []):
        var = vars_by_id.get(precondition.get("src"))
        if var is None:
            continue
        src = var.get("source", {})
        try:
            region_for_source(src)
        except ValueError:
            continue
        if predicate_is_valid(precondition.get("predicate", {}), src):
            valid_preconditions.append(precondition)
    if rule.get("preconditions") and not valid_preconditions:
        raise ValueError("no physically resolvable precondition remains")

    needed_ids = {trigger_id}
    needed_ids.update(edge.get("src") for edge in valid_preconditions)
    for var in rule.get("vars", []):
        if var.get("id") not in needed_ids:
            continue
        src = var.get("source", {})
        var_id = var.get("id", "var")
        region = region_for_source(src)
        slot = slot_for_source(src) if region == "streaming" else 0
        off = src.get("offset")
        if off is None:
            raise ValueError(f"node {var_id} has no physical offset")
        off_dec = int(off)
        size = size_for_source(src)
        if size <= 0 or size > MAX_ACCESS_BYTES:
            raise ValueError(f"node {var_id} has invalid access width {size}")
        if region == "mmio":
            lines.append(f"node {var_id} mmio 0x{off_dec:x} {size}")
        elif region == "coherent":
            lines.append(f"node {var_id} coherent 0x{off_dec:x} {size}")
        else:
            lines.append(f"node {var_id} streaming {slot} 0x{off_dec:x} {size}")

    for precondition in valid_preconditions:
        lines.append(format_condition("precondition", precondition))
    lines.append(format_trigger(trigger))
    lines.append(format_mutation(rule.get("mutation", {}), trigger.get("dst", "")))
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

    # Detect identity conflicts before writing anything: duplicate canonical
    # rule ids are never resolved by container order.
    seen_ids = {}
    conflicts = []
    pending = []
    for rule in rules:
        rid = rule.get("id", "")
        for variant, variant_id in expand_unknown_signedness(rule):
            if not variant_id:
                pending.append((variant, variant_id))
                continue
            if variant_id in seen_ids:
                conflicts.append(variant_id)
                print(f"identity conflict: duplicate canonical rule id {variant_id}")
                continue
            seen_ids[variant_id] = True
            pending.append((variant, variant_id))

    if conflicts:
        raise SystemExit(f"SDG rule identity conflicts: {sorted(set(conflicts))}")

    written = 0
    skipped = 0
    for variant, variant_id in pending:
        if not variant_id:
            skipped += 1
            print(f"skipping {variant.get('id', '')}: rule has no canonical id")
            continue
        digest = hashlib.sha256(variant_id.encode()).hexdigest()[:12]
        fname = f"{sanitize_filename(variant_id)}-{digest}.sdg"
        out_path = args.output / fname
        try:
            rendered = convert_rule(variant)
        except ValueError as exc:
            skipped += 1
            print(f"skipping {variant_id}: {exc}")
            continue
        out_path.write_text(rendered)
        written += 1

    print(f"wrote {written} .sdg files to {args.output} (skipped {skipped})")


if __name__ == "__main__":
    main()
