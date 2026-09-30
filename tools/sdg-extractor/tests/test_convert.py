#!/usr/bin/env python3
"""Unit tests for convert_to_sdg.py: the JSON-to-SDG text format.

The .sdg condition lines must carry the full canonical edge identity
(src, dst, head, predicate) and the canonical rule id must be preserved
verbatim.
"""

import json
import subprocess
import sys
import tempfile
from pathlib import Path

TESTS_DIR = Path(__file__).resolve().parent
TOOL_ROOT = TESTS_DIR.parent
CONVERTER = TOOL_ROOT / "scripts" / "convert_to_sdg.py"


def convert(rules: list) -> tuple:
    with tempfile.TemporaryDirectory() as tmp:
        rules_file = Path(tmp) / "rules.json"
        out_dir = Path(tmp) / "sdg"
        with open(rules_file, "w") as f:
            json.dump({"rules": rules}, f)
        proc = subprocess.run(
            [sys.executable, str(CONVERTER), "--rules", str(rules_file),
             "--output", str(out_dir)],
            capture_output=True, text=True,
        )
        texts = {}
        if out_dir.exists():
            for path in sorted(out_dir.glob("*.sdg")):
                texts[path.name] = path.read_text()
        return proc, texts


def base_rule(**overrides):
    rule = {
        "id": "rule:probe|target:mmio:256:1:x|predicate:gt:unsigned:40",
        "function": "probe",
        "vars": [
            {"id": "mmio:256:1:x",
             "source": {"class": "Mmio", "access_kind": "config",
                        "offset": 256, "size_bytes": 1, "field": "x"}},
        ],
        "preconditions": [],
        "target_state": {
            "src": "mmio:256:1:x",
            "dst": "mmio:256:1:x",
            "head": "head_bound",
            "predicate": {"kind": "Gt", "value": 40, "signedness": "Unsigned"},
        },
        "mutation": {"operator": "SetBoundary", "side": "Above", "var": "mmio:256:1:x"},
    }
    rule.update(overrides)
    return rule


def parse_reference(text: str) -> dict:
    """A reference parser mirroring the runtime grammar: rule id, node
    sources, and condition lines with src/dst/head/predicate."""
    parsed = {"id": None, "nodes": {}, "preconditions": [], "trigger": None,
              "mutation": None}
    for line in text.splitlines():
        if not line.strip() or line.strip().startswith("#"):
            continue
        tokens = line.split()
        if tokens[0] == "rule":
            parsed["id"] = tokens[1]
        elif tokens[0] == "node":
            name, surface = tokens[1], tokens[2]
            parsed["nodes"][name] = tokens[2:]
        elif tokens[0] == "precondition":
            parsed["preconditions"].append(
                {"src": tokens[1], "dst": tokens[2], "head": tokens[3],
                 "predicate": tokens[4:]})
        elif tokens[0] == "trigger":
            parsed["trigger"] = {"src": tokens[1], "dst": tokens[1],
                                 "head": tokens[2], "predicate": tokens[3:]}
        elif tokens[0] == "mutation":
            parsed["mutation"] = tokens[1:]
    return parsed


def canonical_predicate_text(tokens: list) -> str:
    op = tokens[0]
    if op in ("bit_set", "bit_clear"):
        return f"{op}:{tokens[1]}"
    if op == "in_range":
        return ":".join(tokens)
    if op in ("eq", "ne"):
        return f"{op}:{tokens[1]}"
    return ":".join(tokens)


def test_condition_lines_keep_full_edge_identity():
    rule = base_rule(preconditions=[
        {"src": "mmio:16:4:f", "dst": "mmio:256:1:x", "head": "head_guard",
         "predicate": {"kind": "BitSet", "bit": 5}},
        {"src": "mmio:16:4:f", "dst": "mmio:256:1:x", "head": "head_guard",
         "predicate": {"kind": "BitSet", "bit": 7}},
    ], vars=[
        {"id": "mmio:16:4:f",
         "source": {"class": "Mmio", "access_kind": "feature",
                    "offset": 16, "size_bytes": 4, "field": "f"}},
        {"id": "mmio:256:1:x",
         "source": {"class": "Mmio", "access_kind": "config",
                    "offset": 256, "size_bytes": 1, "field": "x"}},
    ])
    proc, texts = convert([rule])
    assert proc.returncode == 0, proc.stderr
    assert len(texts) == 1, texts
    parsed = parse_reference(next(iter(texts.values())))
    # The canonical rule id is preserved verbatim, including | and :.
    assert parsed["id"] == rule["id"], parsed["id"]
    # Precondition lines carry src, dst, head, and predicate.
    assert len(parsed["preconditions"]) == 2, parsed
    pre = parsed["preconditions"][0]
    assert pre["src"] == "mmio:16:4:f", pre
    assert pre["dst"] == "mmio:256:1:x", pre
    assert pre["head"] == "head_guard", pre
    assert pre["predicate"] == ["bit_set", "5"], pre
    # The trigger line carries the head and the predicate.
    trigger = parsed["trigger"]
    assert trigger["head"] == "head_bound", trigger
    assert trigger["predicate"] == ["gt", "unsigned", "40"], trigger
    # The recomputed canonical id matches the extractor id.
    recomputed = (
        f"rule:probe|target:{trigger['dst']}"
        f"|predicate:{canonical_predicate_text(trigger['predicate'])}"
    )
    assert recomputed == rule["id"], recomputed


def test_unknown_signedness_expands_into_both_candidates():
    rule = base_rule()
    rule["id"] = "rule:probe|target:mmio:256:1:x|predicate:gt:unknown:40"
    rule["target_state"]["predicate"]["signedness"] = "Unknown"
    proc, texts = convert([rule])
    assert proc.returncode == 0, proc.stderr
    assert len(texts) == 2, texts
    ids = sorted(parse_reference(t)["id"] for t in texts.values())
    assert ids == [
        "rule:probe|target:mmio:256:1:x|predicate:gt:signed:40",
        "rule:probe|target:mmio:256:1:x|predicate:gt:unsigned:40",
    ], ids
    # Neither candidate silently replaces the other; both carry the full
    # condition identity.
    for text in texts.values():
        parsed = parse_reference(text)
        assert parsed["trigger"]["predicate"][0] == "gt", parsed
        assert parsed["trigger"]["predicate"][1] in ("signed", "unsigned"), parsed


def test_missing_relational_signedness_is_also_expanded():
    rule = base_rule()
    rule["id"] = "rule:probe|target:mmio:256:1:x|predicate:gt:unknown:40"
    del rule["target_state"]["predicate"]["signedness"]
    proc, texts = convert([rule])
    assert proc.returncode == 0, proc.stderr
    assert len(texts) == 2, texts


def test_zero_and_oversize_widths_are_rejected():
    zero = base_rule()
    zero["vars"][0]["source"]["size_bytes"] = 0
    proc, texts = convert([zero])
    assert proc.returncode == 0, proc.stderr
    assert not texts, "zero width must be rejected"

    oversize = base_rule()
    oversize["vars"][0]["source"]["size_bytes"] = 16
    oversize["target_state"]["predicate"] = {"kind": "Eq", "value": 0}
    oversize["id"] = "rule:probe|target:mmio:256:16:x|predicate:eq:0"
    proc, texts = convert([oversize])
    assert proc.returncode == 0, proc.stderr
    assert not texts, "oversize widths must be rejected"


def test_cross_word_fields_are_allowed():
    rule = base_rule()
    rule["id"] = "rule:probe|target:mmio:262:8:w|predicate:eq:0"
    rule["vars"] = [
        {"id": "mmio:262:8:w",
         "source": {"class": "Mmio", "access_kind": "config",
                    "offset": 262, "size_bytes": 8, "field": "w"}},
    ]
    rule["target_state"] = {
        "src": "mmio:262:8:w", "dst": "mmio:262:8:w", "head": "head_bound",
        "predicate": {"kind": "Eq", "value": 0},
    }
    rule["mutation"] = {"operator": "SetValue", "value": 0, "var": "mmio:262:8:w"}
    proc, texts = convert([rule])
    assert proc.returncode == 0, proc.stderr
    assert len(texts) == 1, texts
    parsed = parse_reference(next(iter(texts.values())))
    assert parsed["nodes"]["mmio:262:8:w"] == ["mmio", "0x106", "8"], parsed


def test_signed_inrange_two_complement_bounds_are_validated():
    rule = base_rule()
    rule["id"] = "rule:probe|target:mmio:266:2:v|predicate:in_range:signed:65526:10"
    rule["vars"] = [
        {"id": "mmio:266:2:v",
         "source": {"class": "Mmio", "access_kind": "config",
                    "offset": 266, "size_bytes": 2, "field": "v"}},
    ]
    rule["target_state"] = {
        "src": "mmio:266:2:v", "dst": "mmio:266:2:v", "head": "head_bound",
        "predicate": {"kind": "InRange", "min": 65526, "max": 10,
                      "signedness": "Signed"},
    }
    rule["mutation"] = {"operator": "SampleRange", "min": 65526, "max": 10,
                        "var": "mmio:266:2:v"}
    proc, texts = convert([rule])
    assert proc.returncode == 0, proc.stderr
    assert len(texts) == 1, texts
    parsed = parse_reference(next(iter(texts.values())))
    assert parsed["trigger"]["predicate"] == [
        "in_range", "signed", "65526", "10"], parsed

    # An inverted signed range is rejected.
    bad = json.loads(json.dumps(rule))
    bad["target_state"]["predicate"] = {"kind": "InRange", "min": 10,
                                        "max": 65526, "signedness": "Signed"}
    proc, texts = convert([bad])
    assert proc.returncode == 0, proc.stderr
    assert not texts, "an inverted signed range must be rejected"


def test_keep_and_boundary_extrema_mutations_are_emitted():
    keep = base_rule()
    keep["mutation"] = {"operator": "Keep", "var": "mmio:256:1:x"}
    proc, texts = convert([keep])
    assert proc.returncode == 0, proc.stderr
    assert "mutation keep" in next(iter(texts.values())), texts

    for side in ("Min", "Max", "Above", "Below"):
        rule = base_rule()
        rule["mutation"] = {"operator": "SetBoundary", "side": side,
                            "var": "mmio:256:1:x"}
        proc, texts = convert([rule])
        assert proc.returncode == 0, proc.stderr
        assert f"mutation set_boundary {side.lower()}" in next(iter(texts.values())), (side, texts)


def test_duplicate_canonical_rule_ids_conflict():
    proc, texts = convert([base_rule(), base_rule()])
    assert proc.returncode != 0, "duplicate canonical rule ids must conflict"
    assert not texts, "conflicting rules must not be written by order"


def test_sanitized_ids_are_never_written():
    rule = base_rule()
    proc, texts = convert([rule])
    assert proc.returncode == 0, proc.stderr
    text = next(iter(texts.values()))
    # The rule line keeps the canonical separators; no underscore sanitizing.
    assert text.startswith(f"rule {rule['id']}\n"), text


def test_unknown_precondition_does_not_create_two_rules():
    rule = base_rule(preconditions=[
        {"src": "mmio:16:4:f", "dst": "mmio:256:1:x", "head": "head_guard",
         "predicate": {"kind": "Gt", "value": 3, "signedness": "Unknown"}},
    ], vars=[
        {"id": "mmio:16:4:f",
         "source": {"class": "Mmio", "access_kind": "feature",
                    "offset": 16, "size_bytes": 4, "field": "f"}},
        {"id": "mmio:256:1:x",
         "source": {"class": "Mmio", "access_kind": "config",
                    "offset": 256, "size_bytes": 1, "field": "x"}},
    ])
    proc, texts = convert([rule])
    assert proc.returncode == 0, proc.stderr
    # The target is resolved, so exactly one rule is produced: the
    # precondition's expansion produces alternative candidate lines, not two
    # rules with identical target-derived ids.
    assert len(texts) == 1, texts
    parsed = parse_reference(next(iter(texts.values())))
    assert parsed["id"] == rule["id"], parsed["id"]
    # Both candidate lines are present as alternatives.
    pre_ops = sorted(p["predicate"][1] for p in parsed["preconditions"])
    assert pre_ops == ["signed", "unsigned"], parsed["preconditions"]


def test_two_independent_unknown_predicates():
    rule = base_rule(preconditions=[
        {"src": "mmio:16:4:f", "dst": "mmio:256:1:x", "head": "head_guard",
         "predicate": {"kind": "Lt", "value": 3, "signedness": "Unknown"}},
        {"src": "mmio:20:4:g", "dst": "mmio:256:1:x", "head": "head_guard",
         "predicate": {"kind": "Gt", "value": 9, "signedness": "Unknown"}},
    ], vars=[
        {"id": "mmio:16:4:f",
         "source": {"class": "Mmio", "access_kind": "feature",
                    "offset": 16, "size_bytes": 4, "field": "f"}},
        {"id": "mmio:20:4:g",
         "source": {"class": "Mmio", "access_kind": "feature",
                    "offset": 20, "size_bytes": 4, "field": "g"}},
        {"id": "mmio:256:1:x",
         "source": {"class": "Mmio", "access_kind": "config",
                    "offset": 256, "size_bytes": 1, "field": "x"}},
    ])
    proc, texts = convert([rule])
    assert proc.returncode == 0, proc.stderr
    # The target is resolved: one rule, with all independent signed/unsigned
    # combinations represented as alternative candidate lines.
    assert len(texts) == 1, texts
    parsed = parse_reference(next(iter(texts.values())))
    pre_pairs = sorted((p["src"], p["predicate"][1]) for p in parsed["preconditions"])
    assert pre_pairs == [
        ("mmio:16:4:f", "signed"), ("mmio:16:4:f", "unsigned"),
        ("mmio:20:4:g", "signed"), ("mmio:20:4:g", "unsigned"),
    ], pre_pairs


def test_unknown_target_with_unknown_precondition():
    rule = base_rule(preconditions=[
        {"src": "mmio:16:4:f", "dst": "mmio:256:1:x", "head": "head_guard",
         "predicate": {"kind": "Lt", "value": 3, "signedness": "Unknown"}},
    ], vars=[
        {"id": "mmio:16:4:f",
         "source": {"class": "Mmio", "access_kind": "feature",
                    "offset": 16, "size_bytes": 4, "field": "f"}},
        {"id": "mmio:256:1:x",
         "source": {"class": "Mmio", "access_kind": "config",
                    "offset": 256, "size_bytes": 1, "field": "x"}},
    ])
    rule["id"] = "rule:probe|target:mmio:256:1:x|predicate:gt:unknown:40"
    rule["target_state"]["predicate"]["signedness"] = "Unknown"
    proc, texts = convert([rule])
    assert proc.returncode == 0, proc.stderr
    # Two rule candidates (the target's expansion), each carrying both
    # precondition candidate lines.
    assert len(texts) == 2, texts
    for text in texts.values():
        parsed = parse_reference(text)
        pre_pairs = sorted((p["src"], p["predicate"][1]) for p in parsed["preconditions"])
        assert pre_pairs == [
            ("mmio:16:4:f", "signed"), ("mmio:16:4:f", "unsigned"),
        ], pre_pairs


def test_mutation_json_fields_round_trip():
    target = "mmio:256:1:x"
    cases = [
        ({"operator": "SetValue", "value": 42, "var": target},
         ["set_value", "42"]),
        ({"operator": "SetBits", "mask": 32, "var": target},
         ["set_bits", "32"]),
        ({"operator": "ClearBits", "mask": 32, "var": target},
         ["clear_bits", "32"]),
        ({"operator": "FlipBit", "bit": 5, "var": target},
         ["flip_bit", "5"]),
        ({"operator": "Inc", "delta": 3, "var": target},
         ["inc", "3"]),
        ({"operator": "Dec", "delta": 3, "var": target},
         ["dec", "3"]),
        ({"operator": "SampleRange", "min": 5, "max": 9, "var": target},
         ["sample_range", "5", "9"]),
        ({"operator": "SetBoundary", "side": "Above", "var": target},
         ["set_boundary", "above"]),
        ({"operator": "SetBoundary", "side": "Below", "var": target},
         ["set_boundary", "below"]),
        ({"operator": "SetBoundary", "side": "Min", "var": target},
         ["set_boundary", "min"]),
        ({"operator": "SetBoundary", "side": "Max", "var": target},
         ["set_boundary", "max"]),
        ({"operator": "Keep", "var": target},
         ["keep"]),
    ]
    for mut, expected_args in cases:
        rule = base_rule()
        rule["mutation"] = mut
        proc, texts = convert([rule])
        assert proc.returncode == 0, (mut, proc.stderr)
        assert len(texts) == 1, (mut, texts)
        parsed = parse_reference(next(iter(texts.values())))
        assert parsed["mutation"] == expected_args, (mut, parsed["mutation"])
        # The runtime rule id is preserved and validated.
        assert parsed["id"] == rule["id"], (mut, parsed["id"])


def test_mutation_var_must_match_target():
    rule = base_rule()
    rule["mutation"] = {"operator": "SetValue", "value": 42,
                        "var": "mmio:999:1:other"}
    proc, texts = convert([rule])
    assert proc.returncode == 0, proc.stderr
    assert not texts, "a mutation var that disagrees with the target must be rejected"


def test_argument_less_documented_mutations_are_rejected():
    # Documented JSON with only mask/delta must round-trip; a mutation with
    # no argument at all must be rejected.
    for mut in ({"operator": "SetBits", "var": "mmio:256:1:x"},
                {"operator": "Inc", "var": "mmio:256:1:x"},
                {"operator": "FlipBit", "var": "mmio:256:1:x"},
                {"operator": "SetValue", "var": "mmio:256:1:x"}):
        rule = base_rule()
        rule["mutation"] = mut
        proc, texts = convert([rule])
        assert proc.returncode == 0, (mut, proc.stderr)
        assert not texts, f"argument-less {mut} must be rejected, not emitted bare"


def main():
    failures = 0
    for test in (
        test_condition_lines_keep_full_edge_identity,
        test_unknown_signedness_expands_into_both_candidates,
        test_missing_relational_signedness_is_also_expanded,
        test_zero_and_oversize_widths_are_rejected,
        test_cross_word_fields_are_allowed,
        test_signed_inrange_two_complement_bounds_are_validated,
        test_keep_and_boundary_extrema_mutations_are_emitted,
        test_duplicate_canonical_rule_ids_conflict,
        test_sanitized_ids_are_never_written,
        test_unknown_precondition_does_not_create_two_rules,
        test_two_independent_unknown_predicates,
        test_unknown_target_with_unknown_precondition,
        test_mutation_json_fields_round_trip,
        test_mutation_var_must_match_target,
        test_argument_less_documented_mutations_are_rejected,
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
