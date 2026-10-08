#!/usr/bin/env python3
"""Compare the AST source catalog (oracle) with the CodeQL query results.

The AST tool (ast/src/ast_source_scan.cpp) is the comparison oracle; the
CodeQL queries (queries/sdg) are the implementation. Both are run per
fixture, normalized to a common schema, and diffed per section:

  sources      (class, line, function) sets
  sinks        (callee, line, arg index) sets
  self_edges   (head, predicate kind) multisets
  cross_edges  (head, predicate kind) multisets
  rules        (function, predicate kind, value) sets

Usage:
  python3 scripts/compare.py --fixtures tests/fixtures [--db-root DIR]

Pre-computed outputs are reused when present; otherwise the script runs
both extractors. CodeQL is taken from PATH (or CODEQL_BIN).
"""

import argparse
import csv
import io
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from collections import Counter
from pathlib import Path

TOOL_ROOT = Path(__file__).resolve().parent.parent
AST_BUILD = Path(
    os.environ.get("SDG_AST_BUILD_DIR", TOOL_ROOT / "builds" / "default"))
AST_TOOL = AST_BUILD / "ast_source_scan"

KIND_MAP = {
    "bit_set": "BitSet", "bit_clear": "BitClear", "eq": "Eq", "ne": "Ne",
    "lt": "Lt", "gt": "Gt", "le": "Le", "ge": "Ge", "in_range": "InRange",
    "identity": "Identity",
}

READ_RE = re.compile(r"^  \[(\w+)\] .*?:(\d+) (\S+) \(in (\w+)\)$")
SINK_RE = re.compile(r"^  sink\[(\w+)\] .*?:(\d+) (\S+) arg(\d+) role=(\w+)$")
EDGE_RE = re.compile(r"^  (\S+) --\[(\S+), (\S+)\]--> (\S+)$")
RULE_RE = re.compile(r"^rule: (rule:\S+)$")


def ast_pred_kind(pred):
    """`Gt(40)` / `InRange(0, 64)` / `bit_set:5` -> kind name."""
    head = pred.split("(", 1)[0]
    return KIND_MAP.get(head.lower().replace(":", "_"), head)


def ast_pred_value(pred):
    body = pred.split("(", 1)[1].rstrip(")") if "(" in pred else ""
    parts = [p.strip() for p in body.split(",") if p.strip()]
    if not parts:
        return 0
    try:
        vals = [int(p) for p in parts]
    except ValueError:
        return body
    return tuple(vals) if len(vals) > 1 else vals[0]


def ast_rule_parts(rule_id):
    """`rule:<fn>|target:<node>|predicate:<pred>` -> (fn, kind, value)."""
    fn = rule_id.split("|")[0][len("rule:"):]
    pred = rule_id.split("|predicate:", 1)[1]
    return (fn, ast_pred_kind(pred), ast_pred_value(pred))


def parse_ast(text):
    res = {"sources": set(), "sinks": set(), "self_edges": Counter(),
           "cross_edges": Counter(), "rules": set()}
    for line in text.splitlines():
        m = READ_RE.match(line)
        if m:
            res["sources"].add((m[1], int(m[2]), m[4]))
            continue
        m = SINK_RE.match(line)
        if m:
            res["sinks"].add((m[3], int(m[2]), int(m[4])))
            continue
        m = EDGE_RE.match(line)
        if m:
            head, pred = m[2], ast_pred_kind(m[3])
            key = "self_edges" if m[1] == m[4] else "cross_edges"
            res[key][(head, pred)] += 1
            continue
        m = RULE_RE.match(line)
        if m:
            res["rules"].add(ast_rule_parts(m[1]))
    return res


def parse_ql(text):
    res = {"sources": set(), "sinks": set(), "self_edges": Counter(),
           "cross_edges": Counter(), "rules": set()}
    for row in csv.reader(io.StringIO(text)):
        if len(row) < 3 or row[0] == "section":
            continue
        section, data = row[0], json.loads(row[2])
        if section == "sources":
            res["sources"].add((data["class"],
                                data["location"]["line"],
                                data["function"]))
        elif section == "sinks":
            res["sinks"].add((data["function"],
                              data["location"]["line"],
                              data["arg_index"]))
        elif section in ("self_edges", "cross_edges"):
            res[section][(data["head"], data["predicate"]["kind"])] += 1
        elif section == "rules":
            p = data["target_state"]["predicate"]
            val = ((p["min"], p["max"]) if p["kind"] == "InRange"
                   else p.get("bit", p.get("value")))
            res["rules"].add((data["function"], p["kind"], val))
    return res


def diff_section(name, ast_side, ql_side):
    """Yield ('agree'|'ast-only'|'ql-only', item) for one section."""
    ast_set = set(ast_side) if isinstance(ast_side, Counter) else set(ast_side)
    ql_set = set(ql_side) if isinstance(ql_side, Counter) else set(ql_side)
    for item in sorted(ast_set - ql_set, key=repr):
        yield "ast-only", (name, item, ast_side[item]
                           if isinstance(ast_side, Counter) else None)
    for item in sorted(ql_set - ast_set, key=repr):
        yield "ql-only", (name, item, ql_side[item]
                          if isinstance(ql_side, Counter) else None)
    if ast_set == ql_set:
        yield "agree", (name, len(ast_set), None)


def run_ast(fixtures, out_dir):
    for src in fixtures:
        name = src.stem
        dst = out_dir / f"{name}.txt"
        if dst.exists():
            continue
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            shutil.copy(src, tmp / src.name)
            (tmp / "args.txt").write_text("-I.\n")
            proc = subprocess.run(
                [str(AST_TOOL), "args.txt", src.name],
                cwd=tmp, capture_output=True, text=True)
            dst.write_text(proc.stdout)


def ql_search_path(queries):
    dist = Path(shutil.which(os.environ.get("CODEQL_BIN", "codeql"))).parent
    return f"{dist / 'qlpacks'}:{queries}"


def run_ql(fixtures, out_dir, db_root, queries):
    sp = ql_search_path(queries)
    codeql = os.environ.get("CODEQL_BIN", "codeql")
    for src in fixtures:
        name = src.stem
        dst = out_dir / f"{name}.csv"
        if dst.exists():
            continue
        db = db_root / name / "db"
        if not db.exists():
            db.parent.mkdir(parents=True, exist_ok=True)
            subprocess.run(
                [codeql, "database", "create", str(db), "--language=cpp",
                 "--overwrite", "--command",
                 f"gcc -std=gnu11 -c {src}"],
                check=True, capture_output=True, text=True)
        bqrs = db.parent / "compare.bqrs"
        subprocess.run(
            [codeql, "query", "run", str(queries / "sdg" / "SdgExtract.ql"),
             "-d", str(db), f"--search-path={sp}",
             f"--output={bqrs}", "--threads=2"],
            check=True, capture_output=True, text=True)
        dec = subprocess.run(
            [codeql, "bqrs", "decode", str(bqrs), "--format=csv"],
            check=True, capture_output=True, text=True)
        dst.write_text(dec.stdout)
        bqrs.unlink(missing_ok=True)


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--fixtures", type=Path,
                    default=TOOL_ROOT / "tests" / "fixtures")
    ap.add_argument("--ast-out", type=Path, default=None)
    ap.add_argument("--ql-out", type=Path, default=None)
    ap.add_argument("--db-root", type=Path,
                    default=TOOL_ROOT / "builds" / "fixture-dbs")
    args = ap.parse_args()

    if not AST_TOOL.exists():
        print(f"error: oracle not built at {AST_TOOL} (run ast/build.sh)",
              file=sys.stderr)
        return 1

    fixtures = sorted(args.fixtures.glob("*.c"))
    ast_out = args.ast_out or Path(tempfile.mkdtemp(prefix="sdg-cmp-ast-"))
    ql_out = args.ql_out or Path(tempfile.mkdtemp(prefix="sdg-cmp-ql-"))
    ast_out.mkdir(parents=True, exist_ok=True)
    ql_out.mkdir(parents=True, exist_ok=True)

    run_ast(fixtures, ast_out)
    run_ql(fixtures, ql_out, args.db_root, TOOL_ROOT / "queries")

    sections = ["sources", "sinks", "self_edges", "cross_edges", "rules"]
    gaps = {"ast-only": Counter(), "ql-only": Counter()}
    per_fixture = {}
    for src in fixtures:
        name = src.stem
        ast_res = parse_ast((ast_out / f"{name}.txt").read_text())
        ql_res = parse_ql((ql_out / f"{name}.csv").read_text())
        rows = []
        for sec in sections:
            for status, item in diff_section(sec, ast_res[sec], ql_res[sec]):
                rows.append((status, item))
                if status != "agree":
                    gaps[status][sec] += 1
        per_fixture[name] = rows

    for name, rows in per_fixture.items():
        if all(s == "agree" for s, _ in rows):
            print(f"{name}: agree")
            continue
        print(f"{name}:")
        for status, item in rows:
            sec, detail, n = item
            if status == "agree":
                continue
            mark = "AST-ONLY" if status == "ast-only" else "QL-ONLY"
            count = f" x{n}" if n else ""
            print(f"  {mark} {sec}: {detail}{count}")
    print("\n== summary ==")
    for sec in sections:
        a, q = gaps["ast-only"][sec], gaps["ql-only"][sec]
        print(f"  {sec}: ast-only {a}, ql-only {q}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
