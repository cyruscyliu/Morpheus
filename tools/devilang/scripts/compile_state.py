#!/usr/bin/env python3
from __future__ import annotations

import argparse
import dataclasses
import pathlib
import re
from typing import Dict, List, Optional, Sequence, Tuple


READ_RE = re.compile(
    r"^(?P<lhs>[A-Za-z0-9_.]+)\s*=\s*read(?P<width>8|16|32|64)\((?P<addr>.+)\)$"
)
WRITE_RE = re.compile(
    r"^write(?P<width>8|16|32|64)\((?P<value>.+),\s*(?P<addr>.+)\)$"
)
TRACE_RE = re.compile(r"^trace\s+([A-Za-z0-9_]+)\s*\{$")
MACHINE_RE = re.compile(r"^machine\s+([A-Za-z0-9_]+)\s*\{$")
INITIAL_RE = re.compile(r"^initial\s+([A-Za-z0-9_]+)$")
LABEL_BLOCK_RE = re.compile(r"^@([A-Za-z0-9_]+):\s+(sequence|repeat)\s*\{$")
BLOCK_RE = re.compile(r"^(sequence|repeat)\s*\{$")
SCRATCH_RE = re.compile(r"^([A-Za-z0-9_.]+)$")
NEQJ_RE = re.compile(r"^neqj\s+.+,\s*.+,\s*@([A-Za-z0-9_]+)$")


@dataclasses.dataclass
class Block:
    label: Optional[str]
    lines: List[str]


@dataclasses.dataclass
class Trace:
    name: str
    blocks: List[Block]


@dataclasses.dataclass
class Machine:
    name: str
    initial: str
    scratch: List[str]
    traces: List[Trace]


@dataclasses.dataclass
class Expr:
    kind: str
    value: Optional[int] = None
    scratch: Optional[int] = None
    symbol: Optional[int] = None
    offset: int = 0


@dataclasses.dataclass
class Step:
    kind: str
    width: int = 0
    addr: Optional[Expr] = None
    value: Optional[Expr] = None
    scratch: int = -1
    next_a: int = -1
    next_b: int = -1
    trace: int = -1
    block: int = -1


class ParseError(RuntimeError):
    pass


def split_top_level(expr: str, operators: Sequence[str]) -> Optional[Tuple[str, str, str]]:
    depth = 0
    i = len(expr) - 1
    while i >= 0:
        ch = expr[i]
        if ch == ")":
            depth += 1
            i -= 1
            continue
        if ch == "(":
            depth -= 1
            i -= 1
            continue
        if depth == 0:
            for op in operators:
                start = i - len(op) + 1
                if start >= 0 and expr[start : i + 1] == op:
                    left = expr[:start].strip()
                    right = expr[i + 1 :].strip()
                    if left and right:
                        return left, op, right
        i -= 1
    return None


def strip_outer_parens(expr: str) -> str:
    out = expr.strip()
    while out.startswith("(") and out.endswith(")"):
        depth = 0
        ok = True
        for idx, ch in enumerate(out):
            if ch == "(":
                depth += 1
            elif ch == ")":
                depth -= 1
                if depth == 0 and idx != len(out) - 1:
                    ok = False
                    break
        if not ok or depth != 0:
            break
        out = out[1:-1].strip()
    return out


class StateCompiler:
    def __init__(self, symbol_prefix: str) -> None:
        self.symbol_prefix = symbol_prefix
        self.symbol_ids: Dict[str, int] = {}

    def parse_files(self, paths: Sequence[pathlib.Path]) -> List[Machine]:
        machines: List[Machine] = []
        for path in paths:
            machines.extend(self.parse_text(path.read_text(encoding="utf-8"), str(path)))
        return machines

    def parse_text(self, text: str, source_name: str) -> List[Machine]:
        machines: List[Machine] = []
        current_machine: Optional[Machine] = None
        current_trace: Optional[Trace] = None
        current_block: Optional[Block] = None
        stack: List[str] = []

        for lineno, raw in enumerate(text.splitlines(), start=1):
            line = raw.strip()
            if not line:
                continue

            machine_match = MACHINE_RE.match(line)
            if machine_match:
                current_machine = Machine(
                    name=machine_match.group(1),
                    initial="",
                    scratch=[],
                    traces=[],
                )
                machines.append(current_machine)
                stack.append("machine")
                continue

            if line == "scratch {":
                if current_machine is None:
                    raise ParseError(f"{source_name}:{lineno}: scratch outside machine")
                stack.append("scratch")
                continue

            trace_match = TRACE_RE.match(line)
            if trace_match:
                if current_machine is None:
                    raise ParseError(f"{source_name}:{lineno}: trace outside machine")
                current_trace = Trace(name=trace_match.group(1), blocks=[])
                current_machine.traces.append(current_trace)
                stack.append("trace")
                continue

            label_block_match = LABEL_BLOCK_RE.match(line)
            if label_block_match:
                if current_trace is None:
                    raise ParseError(f"{source_name}:{lineno}: labeled block outside trace")
                current_block = Block(label=label_block_match.group(1), lines=[])
                current_trace.blocks.append(current_block)
                stack.append("block")
                continue

            block_match = BLOCK_RE.match(line)
            if block_match:
                if current_trace is None:
                    raise ParseError(f"{source_name}:{lineno}: block outside trace")
                current_block = Block(label=None, lines=[])
                current_trace.blocks.append(current_block)
                stack.append("block")
                continue

            if line == "}":
                if not stack:
                    raise ParseError(f"{source_name}:{lineno}: unmatched }}")
                closing = stack.pop()
                if closing == "block":
                    current_block = None
                elif closing == "trace":
                    current_trace = None
                elif closing == "machine":
                    current_machine = None
                continue

            initial_match = INITIAL_RE.match(line)
            if initial_match and current_machine is not None:
                current_machine.initial = initial_match.group(1)
                continue

            if stack and stack[-1] == "scratch":
                scratch_line = line.removesuffix(";").strip()
                scratch_match = SCRATCH_RE.match(scratch_line)
                if scratch_match and current_machine is not None:
                    current_machine.scratch.append(scratch_match.group(1))
                    continue

            if current_block is not None:
                current_block.lines.append(line.removesuffix(";").strip())
                continue

        return machines

    def symbol_id(self, raw: str) -> int:
        if raw not in self.symbol_ids:
            self.symbol_ids[raw] = len(self.symbol_ids)
        return self.symbol_ids[raw]

    def parse_expr(
        self, expr: str, scratch_map: Dict[str, int], *, allow_symbol: bool
    ) -> Expr:
        expr = strip_outer_parens(expr)
        if expr == "unknown":
            return Expr(kind="any")
        if re.fullmatch(r"[0-9]+", expr):
            return Expr(kind="const", value=int(expr))
        if expr in scratch_map:
            return Expr(kind="scratch", scratch=scratch_map[expr])

        split = split_top_level(expr, ["+", "-"])
        if split is not None:
            left, op, right = split
            if re.fullmatch(r"[0-9]+", right):
                base = self.parse_expr(left, scratch_map, allow_symbol=allow_symbol)
                offset = int(right) if op == "+" else -int(right)
                if base.kind == "symbol":
                    return Expr(
                        kind="symbol",
                        symbol=base.symbol,
                        offset=base.offset + offset,
                    )
                if base.kind == "const":
                    return Expr(kind="const", value=(base.value or 0) + offset)
                if base.kind == "scratch":
                    return Expr(kind="any")

        if allow_symbol:
            return Expr(kind="symbol", symbol=self.symbol_id(expr), offset=0)
        return Expr(kind="any")

    def compile_machine(self, machine: Machine) -> Tuple[List[Step], List[str], Dict[str, int]]:
        scratch_map = {name: idx for idx, name in enumerate(machine.scratch)}
        trace_start_steps: Dict[str, int] = {}
        all_steps: List[Step] = []

        for trace_idx, trace in enumerate(machine.traces):
            block_start: List[int] = []
            label_to_start: Dict[str, int] = {}
            trace_steps: List[Step] = []
            block_offsets: List[int] = []
            for block in trace.blocks:
                block_offsets.append(len(trace_steps))
                if block.label:
                    label_to_start[block.label] = len(trace_steps)
                for line in block.lines:
                    step = Step(kind="eps", trace=trace_idx, block=len(block_offsets) - 1)
                    read_match = READ_RE.match(line)
                    write_match = WRITE_RE.match(line)
                    neqj_match = NEQJ_RE.match(line)
                    if read_match:
                        step.kind = "read"
                        step.width = int(read_match.group("width"))
                        step.addr = self.parse_expr(
                            read_match.group("addr"), scratch_map, allow_symbol=True
                        )
                        step.scratch = scratch_map.get(read_match.group("lhs"), -1)
                    elif write_match:
                        step.kind = "write"
                        step.width = int(write_match.group("width"))
                        step.addr = self.parse_expr(
                            write_match.group("addr"), scratch_map, allow_symbol=True
                        )
                        step.value = self.parse_expr(
                            write_match.group("value"), scratch_map, allow_symbol=False
                        )
                    elif neqj_match:
                        step.kind = "branch"
                        step.next_b = -2
                        step.next_a = -2
                        step.value = Expr(kind="label", value=0)
                        step.scratch = -1
                        step.addr = Expr(
                            kind="symbol",
                            symbol=self.symbol_id(f"label:{trace.name}:{neqj_match.group(1)}"),
                            offset=0,
                        )
                    elif line == "...":
                        step.kind = "wildcard"
                    trace_steps.append(step)
                trace_steps.append(Step(kind="end", trace=trace_idx, block=len(block_offsets) - 1))

            for block_idx, block in enumerate(trace.blocks):
                block_start.append(block_offsets[block_idx])

            for block_idx, block in enumerate(trace.blocks):
                start = block_offsets[block_idx]
                end = block_offsets[block_idx + 1] if block_idx + 1 < len(block_offsets) else len(trace_steps)
                for step_idx in range(start, end):
                    step = trace_steps[step_idx]
                    default_next = step_idx + 1 if step_idx + 1 < len(trace_steps) else -1
                    if step.kind == "branch":
                        match = NEQJ_RE.match(block.lines[step_idx - start])
                        assert match is not None
                        target = match.group(1)
                        step.next_a = label_to_start.get(target, default_next)
                        step.next_b = default_next
                    elif step.kind != "end":
                        step.next_a = default_next
                trace_steps[end - 1].next_a = (
                    block_offsets[block_idx + 1]
                    if block_idx + 1 < len(block_offsets)
                    else -1
                )

            trace_start_steps[trace.name] = len(all_steps)
            all_steps.extend(trace_steps)

        starts = [trace_start_steps[trace.name] for trace in machine.traces if trace.blocks]
        return all_steps, starts, scratch_map

    def generate(self, machines: List[Machine], output_c: pathlib.Path, output_h: pathlib.Path) -> None:
        if len(machines) > 2:
            raise SystemExit("compile-state currently supports at most two machines (booting + runtime)")
        compiled = [self.compile_machine(machine) for machine in machines]
        output_h.write_text(self.render_header(), encoding="utf-8")
        output_c.write_text(self.render_c(machines, compiled, output_h.name), encoding="utf-8")

    def render_header(self) -> str:
        prefix = self.symbol_prefix.upper()
        return f"""#ifndef {prefix}_STATE_MACHINE_H
#define {prefix}_STATE_MACHINE_H

#include <stddef.h>
#include <stdint.h>

enum devilang_event_kind {{
    DEVILANG_EV_MMIO_READ = 1,
    DEVILANG_EV_MMIO_WRITE = 2,
}};

struct devilang_event {{
    enum devilang_event_kind kind;
    uint64_t addr;
    uint64_t value;
    uint32_t width;
}};

struct devilang_active_state {{
    const char *phase;
    const char *trace;
    const char *block;
    uint32_t score;
}};

struct {self.symbol_prefix}_machine;

void {self.symbol_prefix}_init(struct {self.symbol_prefix}_machine *machine);
int {self.symbol_prefix}_feed_event(
    struct {self.symbol_prefix}_machine *machine,
    const struct devilang_event *event);
size_t {self.symbol_prefix}_collect_active(
    const struct {self.symbol_prefix}_machine *machine,
    struct devilang_active_state *out,
    size_t cap);

#endif
"""

    def render_expr(self, expr: Optional[Expr]) -> str:
        if expr is None:
            return "{0, 0, 0, 0}"
        kind_map = {
            "any": "DL_EXPR_ANY",
            "const": "DL_EXPR_CONST",
            "scratch": "DL_EXPR_SCRATCH",
            "symbol": "DL_EXPR_SYMBOL",
        }
        return "{{{kind}, {value}, {scratch}, {symbol}, {offset}}}".format(
            kind=kind_map.get(expr.kind, "DL_EXPR_ANY"),
            value=expr.value or 0,
            scratch=expr.scratch if expr.scratch is not None else -1,
            symbol=expr.symbol if expr.symbol is not None else -1,
            offset=expr.offset,
        )

    def render_c(
        self,
        machines: List[Machine],
        compiled: List[Tuple[List[Step], List[int], Dict[str, int]]],
        header_name: str,
    ) -> str:
        max_scratch = max((len(machine.scratch) for machine in machines), default=0)
        max_symbols = max((len(self.symbol_ids), 1))
        phase_names = [machine.name for machine in machines]
        lines: List[str] = []
        lines.append(f'#include "{header_name}"')
        lines.append("")
        lines.append("#include <stdbool.h>")
        lines.append("#include <stdint.h>")
        lines.append("#include <string.h>")
        lines.append("")
        lines.append("enum dl_step_kind { DL_STEP_EPS, DL_STEP_READ, DL_STEP_WRITE, DL_STEP_BRANCH, DL_STEP_WILDCARD, DL_STEP_END };")
        lines.append("enum dl_expr_kind { DL_EXPR_ANY, DL_EXPR_CONST, DL_EXPR_SCRATCH, DL_EXPR_SYMBOL };")
        lines.append("")
        lines.append("struct dl_expr { int kind; uint64_t value; int scratch; int symbol; int64_t offset; };")
        lines.append("struct dl_step { int kind; int width; struct dl_expr addr; struct dl_expr value; int scratch; int next_a; int next_b; int trace; int block; };")
        lines.append("struct dl_trace_meta { const char *name; const char **blocks; size_t nr_blocks; int start_step; };")
        lines.append("struct dl_machine_meta { const char *phase; const struct dl_trace_meta *traces; size_t nr_traces; int initial_trace_count; const int *initial_steps; };")
        lines.append(
            "struct dl_cursor { int machine; int trace; int step; uint32_t score; uint64_t scratch[%d]; uint64_t symbols[%d]; uint8_t symbol_valid[%d]; };"
            % (max_scratch if max_scratch else 1, max_symbols, max_symbols)
        )
        lines.append("struct %s_machine { struct dl_cursor active[256]; size_t active_count; int booting_complete; int runtime_started; };" % self.symbol_prefix)
        lines.append("")

        for machine_idx, machine in enumerate(machines):
            steps, starts, _ = compiled[machine_idx]
            block_names: Dict[Tuple[int, int], str] = {}
            for trace_idx, trace in enumerate(machine.traces):
                for block_idx, block in enumerate(trace.blocks):
                    block_names[(trace_idx, block_idx)] = block.label or "entry"
                    lines.append(
                        'static const char *%s_machine_%d_trace_%d_blocks_%d = "%s";'
                        % (
                            self.symbol_prefix,
                            machine_idx,
                            trace_idx,
                            block_idx,
                            block_names[(trace_idx, block_idx)].replace('"', '\\"'),
                        )
                    )
                block_refs = ", ".join(
                    "&%s_machine_%d_trace_%d_blocks_%d"[1:]
                    for _ in []
                )
            for trace_idx, trace in enumerate(machine.traces):
                lines.append(
                    "static const char *%s_machine_%d_trace_%d_blocks[] = { %s };"
                    % (
                        self.symbol_prefix,
                        machine_idx,
                        trace_idx,
                        ", ".join(
                            '"%s"' % ((block.label or "entry").replace('"', '\\"'))
                            for block in trace.blocks
                        ),
                    )
                )
            lines.append(
                "static const struct dl_step %s_machine_%d_steps[] = {"
                % (self.symbol_prefix, machine_idx)
            )
            for step in steps:
                kind_map = {
                    "eps": "DL_STEP_EPS",
                    "read": "DL_STEP_READ",
                    "write": "DL_STEP_WRITE",
                    "branch": "DL_STEP_BRANCH",
                    "wildcard": "DL_STEP_WILDCARD",
                    "end": "DL_STEP_END",
                }
                lines.append(
                    "    {%s, %d, %s, %s, %d, %d, %d, %d, %d},"
                    % (
                        kind_map[step.kind],
                        step.width,
                        self.render_expr(step.addr),
                        self.render_expr(step.value),
                        step.scratch,
                        step.next_a,
                        step.next_b,
                        step.trace,
                        step.block,
                    )
                )
            lines.append("};")
            lines.append(
                "static const int %s_machine_%d_initial_steps[] = { %s };"
                % (
                    self.symbol_prefix,
                    machine_idx,
                    ", ".join(str(item) for item in starts) if starts else "-1",
                )
            )
            lines.append(
                "static const struct dl_trace_meta %s_machine_%d_traces[] = {"
                % (self.symbol_prefix, machine_idx)
            )
            offset = 0
            for trace_idx, trace in enumerate(machine.traces):
                lines.append(
                    '    {"%s", %s_machine_%d_trace_%d_blocks, %d, %d},'
                    % (
                        trace.name.replace('"', '\\"'),
                        self.symbol_prefix,
                        machine_idx,
                        trace_idx,
                        len(trace.blocks),
                        offset,
                    )
                )
                step_count = sum(len(block.lines) + 1 for block in trace.blocks)
                offset += step_count
            lines.append("};")
            lines.append("")

        lines.append(
            "static const struct dl_machine_meta %s_machines[] = {"
            % self.symbol_prefix
        )
        for machine_idx, machine in enumerate(machines):
            lines.append(
                '    {"%s", %s_machine_%d_traces, %d, %d, %s_machine_%d_initial_steps},'
                % (
                    machine.name.replace('"', '\\"'),
                    self.symbol_prefix,
                    machine_idx,
                    len(machine.traces),
                    len(compiled[machine_idx][1]),
                    self.symbol_prefix,
                    machine_idx,
                )
            )
        lines.append("};")
        lines.append("")

        lines.append(
            """static uint64_t dl_eval_expr(
    const struct dl_expr *expr,
    const struct dl_cursor *cursor,
    int *known) {
    switch (expr->kind) {
    case DL_EXPR_CONST:
        *known = 1;
        return expr->value;
    case DL_EXPR_SCRATCH:
        if (expr->scratch < 0) {
            *known = 0;
            return 0;
        }
        *known = 1;
        return cursor->scratch[expr->scratch];
    case DL_EXPR_SYMBOL:
        if (expr->symbol < 0 || !cursor->symbol_valid[expr->symbol]) {
            *known = 0;
            return 0;
        }
        *known = 1;
        return cursor->symbols[expr->symbol] + (uint64_t)expr->offset;
    default:
        *known = 0;
        return 0;
    }
}"""
        )
        lines.append("")
        lines.append(
            """static int dl_match_addr(
    const struct dl_expr *expr,
    struct dl_cursor *cursor,
    uint64_t addr) {
    if (expr->kind == DL_EXPR_ANY) {
        return 1;
    }
    if (expr->kind == DL_EXPR_SYMBOL && expr->symbol >= 0 &&
        !cursor->symbol_valid[expr->symbol]) {
        cursor->symbols[expr->symbol] = addr - (uint64_t)expr->offset;
        cursor->symbol_valid[expr->symbol] = 1;
        return 1;
    }
    int known = 0;
    return dl_eval_expr(expr, cursor, &known) == addr || !known;
}"""
        )
        lines.append("")
        lines.append(
            """static int dl_match_value(
    const struct dl_expr *expr,
    const struct dl_cursor *cursor,
    uint64_t value) {
    int known = 0;
    if (expr->kind == DL_EXPR_ANY) {
        return 1;
    }
    return dl_eval_expr(expr, cursor, &known) == value || !known;
}"""
        )
        lines.append("")
        lines.append(
            """static void dl_push_cursor(
    struct dl_cursor *out,
    size_t *count,
    const struct dl_cursor *cursor) {
    if (*count >= 256) {
        return;
    }
    out[*count] = *cursor;
    (*count)++;
}"""
        )
        lines.append("")
        lines.append(
            """static void dl_closure(
    const struct dl_machine_meta *machine_meta,
    const struct dl_step *steps,
    struct dl_cursor *io,
    size_t *count,
    int *phase_complete) {
    size_t index = 0;
    while (index < *count) {
        struct dl_cursor cursor = io[index];
        if (cursor.step < 0) {
            *phase_complete = 1;
            index++;
            continue;
        }
        const struct dl_step *step = &steps[cursor.step];
        if (step->kind == DL_STEP_EPS) {
            io[index].step = step->next_a;
            continue;
        }
        if (step->kind == DL_STEP_BRANCH) {
            struct dl_cursor alt = cursor;
            io[index].step = step->next_a;
            alt.step = step->next_b;
            dl_push_cursor(io, count, &alt);
            continue;
        }
        if (step->kind == DL_STEP_END) {
            io[index].step = -1;
            *phase_complete = 1;
            index++;
            continue;
        }
        index++;
    }
}"""
        )
        lines.append("")
        lines.append(
            """static void dl_expand_cursor(
    const struct dl_machine_meta *machine_meta,
    const struct dl_step *steps,
    const struct dl_cursor *cursor,
    struct dl_cursor *out,
    size_t *out_count,
    int *phase_complete) {
    struct dl_cursor local[256];
    size_t local_count = 1;
    local[0] = *cursor;
    dl_closure(machine_meta, steps, local, &local_count, phase_complete);
    for (size_t i = 0; i < local_count; ++i) {
        dl_push_cursor(out, out_count, &local[i]);
    }
}"""
        )
        lines.append("")
        lines.append(
            """void %s_init(struct %s_machine *machine) {
    memset(machine, 0, sizeof(*machine));
    const struct dl_machine_meta *meta = &%s_machines[0];
    for (int i = 0; i < meta->initial_trace_count; ++i) {
        machine->active[machine->active_count].machine = 0;
        machine->active[machine->active_count].trace = i;
        machine->active[machine->active_count].step = meta->initial_steps[i];
        machine->active[machine->active_count].score = 0;
        machine->active_count++;
    }
    dl_closure(meta, %s_machine_0_steps, machine->active, &machine->active_count,
               &machine->booting_complete);
}"""
            % (self.symbol_prefix, self.symbol_prefix, self.symbol_prefix, self.symbol_prefix)
        )
        lines.append("")
        lines.append(
            """static void dl_start_runtime(struct %s_machine *machine) {
    if (machine->runtime_started || %d < 2) {
        return;
    }
    machine->runtime_started = 1;
    const struct dl_machine_meta *meta = &%s_machines[1];
    struct dl_cursor expanded[256];
    size_t expanded_count = 0;
    for (int i = 0; i < meta->initial_trace_count; ++i) {
        struct dl_cursor cursor;
        memset(&cursor, 0, sizeof(cursor));
        cursor.machine = 1;
        cursor.trace = i;
        cursor.step = meta->initial_steps[i];
        int runtime_complete = 0;
        dl_expand_cursor(meta, %s_machine_1_steps, &cursor, expanded, &expanded_count,
                         &runtime_complete);
    }
    for (size_t i = 0; i < expanded_count; ++i) {
        dl_push_cursor(machine->active, &machine->active_count, &expanded[i]);
    }
}"""
            % (self.symbol_prefix, len(machines), self.symbol_prefix, self.symbol_prefix)
        )
        lines.append("")
        lines.append(
            """int %s_feed_event(
    struct %s_machine *machine,
    const struct devilang_event *event) {
    struct dl_cursor next[256];
    size_t next_count = 0;
    for (size_t i = 0; i < machine->active_count; ++i) {
        struct dl_cursor cursor = machine->active[i];
        if (cursor.step < 0) {
            continue;
        }
        const struct dl_step *steps = cursor.machine == 0
            ? %s_machine_0_steps
            : %s_machine_1_steps;
        const struct dl_step *step = &steps[cursor.step];
        if (step->kind == DL_STEP_WILDCARD) {
            cursor.step = step->next_a;
            cursor.score += 1;
            dl_push_cursor(next, &next_count, &cursor);
            continue;
        }
        if (step->kind == DL_STEP_READ) {
            if (event->kind != DEVILANG_EV_MMIO_READ || event->width != (uint32_t)step->width) {
                continue;
            }
            if (!dl_match_addr(&step->addr, &cursor, event->addr)) {
                continue;
            }
            if (step->scratch >= 0) {
                cursor.scratch[step->scratch] = event->value;
            }
            cursor.step = step->next_a;
            cursor.score += 1;
            dl_push_cursor(next, &next_count, &cursor);
            continue;
        }
        if (step->kind == DL_STEP_WRITE) {
            if (event->kind != DEVILANG_EV_MMIO_WRITE || event->width != (uint32_t)step->width) {
                continue;
            }
            if (!dl_match_addr(&step->addr, &cursor, event->addr)) {
                continue;
            }
            if (!dl_match_value(&step->value, &cursor, event->value)) {
                continue;
            }
            cursor.step = step->next_a;
            cursor.score += 1;
            dl_push_cursor(next, &next_count, &cursor);
        }
    }
    machine->active_count = next_count;
    memcpy(machine->active, next, sizeof(next[0]) * next_count);
    struct dl_cursor expanded[256];
    size_t expanded_count = 0;
    for (size_t i = 0; i < machine->active_count; ++i) {
        const struct dl_machine_meta *meta = &%s_machines[machine->active[i].machine];
        const struct dl_step *steps = machine->active[i].machine == 0
            ? %s_machine_0_steps
            : %s_machine_1_steps;
        int phase_complete = 0;
        dl_expand_cursor(meta, steps, &machine->active[i], expanded, &expanded_count,
                         &phase_complete);
        if (machine->active[i].machine == 0 && phase_complete) {
            machine->booting_complete = 1;
        }
    }
    machine->active_count = expanded_count;
    memcpy(machine->active, expanded, sizeof(expanded[0]) * expanded_count);
    if (machine->booting_complete) {
        dl_start_runtime(machine);
    }
    return machine->active_count > 0 ? 0 : -1;
}"""
            % (
                self.symbol_prefix,
                self.symbol_prefix,
                self.symbol_prefix,
                self.symbol_prefix,
                self.symbol_prefix,
                self.symbol_prefix,
                self.symbol_prefix,
            )
        )
        lines.append("")
        lines.append(
            """size_t %s_collect_active(
    const struct %s_machine *machine,
    struct devilang_active_state *out,
    size_t cap) {
    size_t written = 0;
    for (size_t i = 0; i < machine->active_count && written < cap; ++i) {
        const struct dl_cursor *cursor = &machine->active[i];
        if (cursor->step < 0) {
            continue;
        }
        const struct dl_machine_meta *meta = &%s_machines[cursor->machine];
        const struct dl_trace_meta *trace = &meta->traces[cursor->trace];
        int block = 0;
        const struct dl_step *steps = cursor->machine == 0
            ? %s_machine_0_steps
            : %s_machine_1_steps;
        block = steps[cursor->step].block;
        out[written].phase = meta->phase;
        out[written].trace = trace->name;
        out[written].block = block >= 0 && (size_t)block < trace->nr_blocks
            ? trace->blocks[block]
            : "entry";
        out[written].score = cursor->score;
        written++;
    }
    return written;
}"""
            % (
                self.symbol_prefix,
                self.symbol_prefix,
                self.symbol_prefix,
                self.symbol_prefix,
                self.symbol_prefix,
            )
        )
        return "\n".join(lines) + "\n"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", action="append", required=True)
    parser.add_argument("--output-c", required=True)
    parser.add_argument("--output-h", required=True)
    parser.add_argument("--symbol-prefix", default="devilang")
    args = parser.parse_args()

    compiler = StateCompiler(args.symbol_prefix)
    machines = compiler.parse_files([pathlib.Path(item) for item in args.input])
    if not machines:
        raise SystemExit("no machines found in input state files")
    compiler.generate(machines, pathlib.Path(args.output_c), pathlib.Path(args.output_h))


if __name__ == "__main__":
    main()
