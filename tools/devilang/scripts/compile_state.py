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
ASSIGN_RE = re.compile(r"^(?P<lhs>[A-Za-z0-9_.]+)\s*=\s*(?P<rhs>.+)$")
TRACE_RE = re.compile(
    r"^(?:(?P<entry>entry)\s+)?trace\s+(?P<name>[A-Za-z0-9_]+)\s*\{$"
)
MACHINE_RE = re.compile(r"^machine\s+([A-Za-z0-9_]+)\s*\{$")
IMPORT_RE = re.compile(r'^import\s+"(?P<path>[^"]+)"\s*;$')
INITIAL_RE = re.compile(r"^initial\s+([A-Za-z0-9_]+)$")
STATE_RE = re.compile(r"^(?:final\s+)?state\s+([A-Za-z0-9_]+)$")
TRANSITION_RE = re.compile(
    r"^transition\s+([A-Za-z0-9_]+)\s*->\s*([A-Za-z0-9_]+)\s+on\s+([A-Za-z0-9_]+)$"
)
LABEL_BLOCK_RE = re.compile(r"^@([A-Za-z0-9_]+):\s+(sequence|repeat)\s*\{$")
BLOCK_RE = re.compile(r"^(sequence|repeat)\s*\{$")
SCRATCH_RE = re.compile(r"^([A-Za-z0-9_.]+)$")
NEQJ_RE = re.compile(
    r"^neqj\s+(?P<lhs>.+),\s*(?P<rhs>.+),\s*@(?P<label>[A-Za-z0-9_]+)$"
)
CALL_STMT_RE = re.compile(r"^call\s+(?P<name>[A-Za-z0-9_.]+)\((?P<args>.*)\)$")
CALL_EXPR_RE = re.compile(r"^(?P<name>[A-Za-z0-9_.]+)\((?P<args>.*)\)$")

KNOWN_CONSTANTS: Dict[str, int] = {
    "PAGE_SIZE": 0x1000,
    "DMA_MAPPING_ERROR": (1 << 64) - 1,
    "VIRTIO_MMIO_MAGIC_VALUE": 0x000,
    "VIRTIO_MMIO_VERSION": 0x004,
    "VIRTIO_MMIO_DEVICE_ID": 0x008,
    "VIRTIO_MMIO_VENDOR_ID": 0x00C,
    "VIRTIO_MMIO_DEVICE_FEATURES": 0x010,
    "VIRTIO_MMIO_DEVICE_FEATURES_SEL": 0x014,
    "VIRTIO_MMIO_DRIVER_FEATURES": 0x020,
    "VIRTIO_MMIO_DRIVER_FEATURES_SEL": 0x024,
    "VIRTIO_MMIO_GUEST_PAGE_SIZE": 0x028,
    "VIRTIO_MMIO_QUEUE_SEL": 0x030,
    "VIRTIO_MMIO_QUEUE_NUM_MAX": 0x034,
    "VIRTIO_MMIO_QUEUE_NUM": 0x038,
    "VIRTIO_MMIO_QUEUE_ALIGN": 0x03C,
    "VIRTIO_MMIO_QUEUE_PFN": 0x040,
    "VIRTIO_MMIO_QUEUE_READY": 0x044,
    "VIRTIO_MMIO_QUEUE_NOTIFY": 0x050,
    "VIRTIO_MMIO_INTERRUPT_STATUS": 0x060,
    "VIRTIO_MMIO_INTERRUPT_ACK": 0x064,
    "VIRTIO_MMIO_STATUS": 0x070,
    "VIRTIO_MMIO_QUEUE_DESC_LOW": 0x080,
    "VIRTIO_MMIO_QUEUE_DESC_HIGH": 0x084,
    "VIRTIO_MMIO_QUEUE_AVAIL_LOW": 0x090,
    "VIRTIO_MMIO_QUEUE_AVAIL_HIGH": 0x094,
    "VIRTIO_MMIO_QUEUE_USED_LOW": 0x0A0,
    "VIRTIO_MMIO_QUEUE_USED_HIGH": 0x0A4,
    "VIRTIO_MMIO_SHM_SEL": 0x0AC,
    "VIRTIO_MMIO_SHM_LEN_LOW": 0x0B0,
    "VIRTIO_MMIO_SHM_LEN_HIGH": 0x0B4,
    "VIRTIO_MMIO_SHM_BASE_LOW": 0x0B8,
    "VIRTIO_MMIO_SHM_BASE_HIGH": 0x0BC,
    "VIRTIO_MMIO_CONFIG_GENERATION": 0x0FC,
    "VIRTIO_MMIO_CONFIG": 0x100,
}


@dataclasses.dataclass
class Block:
    label: Optional[str]
    lines: List[str]


@dataclasses.dataclass
class Trace:
    name: str
    entry: bool
    blocks: List[Block]


@dataclasses.dataclass
class Machine:
    name: str
    initial: str
    scratch: List[str]
    traces: List[Trace]
    states: List[str]
    transitions: List[Tuple[str, str, str]]


@dataclasses.dataclass
class Expr:
    kind: str
    value: Optional[int] = None
    scratch: Optional[int] = None
    symbol: Optional[int] = None
    offset: int = 0
    lhs: Optional["Expr"] = None
    rhs: Optional["Expr"] = None
    lhs_idx: int = -1
    rhs_idx: int = -1


@dataclasses.dataclass
class Step:
    kind: str
    width: int = 0
    addr: int = -1
    value: int = -1
    scratch: int = -1
    call_trace: int = -1
    call_args: Tuple[int, ...] = ()
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


def sanitize_call_name(name: str) -> str:
    return name.replace(".", "_")


def split_args(text: str) -> List[str]:
    args: List[str] = []
    depth = 0
    start = 0
    for idx, ch in enumerate(text):
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
        elif ch == "," and depth == 0:
            arg = text[start:idx].strip()
            if arg:
                args.append(arg)
            start = idx + 1
    tail = text[start:].strip()
    if tail:
        args.append(tail)
    return args


class StateCompiler:
    def __init__(self, symbol_prefix: str) -> None:
        self.symbol_prefix = symbol_prefix
        self.symbol_ids: Dict[str, int] = {}

    def active_trace_names(self, machine: Machine) -> Optional[set[str]]:
        if machine.transitions and machine.initial:
            transition_names = {
                trace
                for src, _dst, trace in machine.transitions
                if src == machine.initial
            }
            if transition_names:
                return transition_names
        entry_names = {trace.name for trace in machine.traces if trace.entry}
        return entry_names if entry_names else None

    def parse_files(self, paths: Sequence[pathlib.Path]) -> List[Machine]:
        machines: List[Machine] = []
        for path in paths:
            machines.extend(self.parse_file(path))
        return machines

    def parse_file(
        self,
        path: pathlib.Path,
        seen: Optional[set[pathlib.Path]] = None,
    ) -> List[Machine]:
        resolved = path.resolve()
        if seen is None:
            seen = set()
        if resolved in seen:
            return []
        seen.add(resolved)

        text = path.read_text(encoding="utf-8")
        machines = self.parse_text(text, str(path))
        imports = [
            (path.parent / match.group("path")).resolve()
            for line in text.splitlines()
            if (match := IMPORT_RE.match(line.strip()))
        ]
        imported_machines: List[Machine] = []
        for import_path in imports:
            imported_machines.extend(self.parse_file(import_path, seen))
        if imported_machines:
            for machine in machines:
                self.merge_imports(machine, imported_machines)
        return machines

    def merge_imports(self, machine: Machine, imported_machines: Sequence[Machine]) -> None:
        seen_scratch = set(machine.scratch)
        seen_traces = {trace.name for trace in machine.traces}
        for imported in imported_machines:
            for scratch in imported.scratch:
                if scratch not in seen_scratch:
                    machine.scratch.append(scratch)
                    seen_scratch.add(scratch)
            for trace in imported.traces:
                if trace.name in seen_traces:
                    continue
                machine.traces.append(trace)
                seen_traces.add(trace.name)

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
                    states=[],
                    transitions=[],
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
                current_trace = Trace(
                    name=trace_match.group("name"),
                    entry=trace_match.group("entry") is not None,
                    blocks=[],
                )
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

            state_match = STATE_RE.match(line)
            if state_match and current_machine is not None:
                current_machine.states.append(state_match.group(1))
                continue

            transition_match = TRANSITION_RE.match(line)
            if transition_match and current_machine is not None:
                current_machine.transitions.append(
                    (
                        transition_match.group(1),
                        transition_match.group(2),
                        transition_match.group(3),
                    )
                )
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
        if re.fullmatch(r"0[xX][0-9a-fA-F]+", expr):
            return Expr(kind="const", value=int(expr, 16))
        if expr in KNOWN_CONSTANTS:
            return Expr(kind="const", value=KNOWN_CONSTANTS[expr])
        sizeof_match = re.fullmatch(r"sizeof_[A-Za-z0-9_]*u(8|16|32|64)", expr)
        if sizeof_match:
            return Expr(kind="const", value=int(sizeof_match.group(1)) // 8)
        if expr in scratch_map:
            return Expr(kind="scratch", scratch=scratch_map[expr])

        comparison_kinds = {
            " eq ": "eq",
            " ne ": "ne",
            " ult ": "ult",
            " ule ": "ule",
            " ugt ": "ugt",
            " uge ": "uge",
            " slt ": "slt",
            " sle ": "sle",
            " sgt ": "sgt",
            " sge ": "sge",
        }
        split = split_top_level(expr, list(comparison_kinds.keys()))
        if split is not None:
            left, op, right = split
            return Expr(
                kind=comparison_kinds[op],
                lhs=self.parse_expr(left, scratch_map, allow_symbol=allow_symbol),
                rhs=self.parse_expr(right, scratch_map, allow_symbol=allow_symbol),
            )

        arithmetic_kinds = {
            "|": "or",
            "&": "and",
            "+": "add",
            "-": "sub",
            "<<": "shl",
            ">>": "lshr",
        }
        for operators in (["|"], ["&"], ["+", "-"], ["<<", ">>"]):
            split = split_top_level(expr, operators)
            if split is None:
                continue
            left, op, right = split
            lhs = self.parse_expr(left, scratch_map, allow_symbol=allow_symbol)
            rhs = self.parse_expr(right, scratch_map, allow_symbol=allow_symbol)
            folded = self.fold_expr(arithmetic_kinds[op], lhs, rhs)
            if folded is not None:
                return folded
            return Expr(kind=arithmetic_kinds[op], lhs=lhs, rhs=rhs)

        if allow_symbol:
            return Expr(kind="symbol", symbol=self.symbol_id(expr), offset=0)
        return Expr(kind="any")

    def fold_expr(self, kind: str, lhs: Expr, rhs: Expr) -> Optional[Expr]:
        lhs_value = lhs.value if lhs.kind == "const" else None
        rhs_value = rhs.value if rhs.kind == "const" else None

        if kind == "add":
            if lhs.kind == "symbol" and rhs_value is not None:
                return Expr(
                    kind="symbol",
                    symbol=lhs.symbol,
                    offset=lhs.offset + rhs_value,
                )
            if rhs.kind == "symbol" and lhs_value is not None:
                return Expr(
                    kind="symbol",
                    symbol=rhs.symbol,
                    offset=rhs.offset + lhs_value,
                )
            if lhs_value is not None and rhs_value is not None:
                return Expr(kind="const", value=lhs_value + rhs_value)

        if kind == "sub":
            if lhs.kind == "symbol" and rhs_value is not None:
                return Expr(
                    kind="symbol",
                    symbol=lhs.symbol,
                    offset=lhs.offset - rhs_value,
                )
            if lhs_value is not None and rhs_value is not None:
                return Expr(kind="const", value=lhs_value - rhs_value)

        if lhs_value is None or rhs_value is None:
            return None

        if kind == "and":
            return Expr(kind="const", value=lhs_value & rhs_value)
        if kind == "or":
            return Expr(kind="const", value=lhs_value | rhs_value)
        if kind == "shl":
            return Expr(kind="const", value=lhs_value << rhs_value)
        if kind == "lshr":
            return Expr(kind="const", value=lhs_value >> rhs_value)

        return None

    def collect_variable_names(self, machine: Machine) -> List[str]:
        names: List[str] = list(machine.scratch)
        seen = set(names)

        for trace in machine.traces:
            for block in trace.blocks:
                for line in block.lines:
                    read_match = READ_RE.match(line)
                    assign_match = ASSIGN_RE.match(line)
                    lhs: Optional[str] = None

                    if read_match:
                        lhs = read_match.group("lhs")
                    elif assign_match and not WRITE_RE.match(line):
                        lhs = assign_match.group("lhs")

                    if lhs and lhs not in seen:
                        names.append(lhs)
                        seen.add(lhs)

        return names

    def collect_trace_external_symbols(
        self,
        trace: Trace,
        machine_scratch: Sequence[str],
    ) -> List[str]:
        keywords = {
            "entry",
            "trace",
            "sequence",
            "repeat",
            "read8",
            "read16",
            "read32",
            "read64",
            "write8",
            "write16",
            "write32",
            "write64",
            "neqj",
            "unknown",
            "call",
            "BUG",
            "BUG_ON",
            "WARN_ON",
        }
        locals_seen = set(machine_scratch)
        ordered: List[str] = []
        ordered_seen: set[str] = set()

        for block in trace.blocks:
            for line in block.lines:
                assign_match = ASSIGN_RE.match(line)
                if assign_match:
                    locals_seen.add(assign_match.group("lhs"))
                for match in re.finditer(r"[A-Za-z_][A-Za-z0-9_.]*", line):
                    token = match.group(0)
                    prev_char = line[match.start() - 1:match.start()]
                    next_char = line[match.end():match.end() + 1]
                    if prev_char == "@":
                        continue
                    if token in keywords:
                        continue
                    if token.upper() == token and "_" in token:
                        continue
                    if token in locals_seen:
                        continue
                    if "." in token:
                        continue
                    if next_char == "(":
                        continue
                    if token not in ordered_seen:
                        ordered.append(token)
                        ordered_seen.add(token)

        return ordered

    def compile_machine(self, machine: Machine) -> Tuple[
        List[Step],
        List[Expr],
        List[int],
        Dict[str, int],
        List[List[str]],
        List[str],
        List[Tuple[int, int, int]],
        int,
    ]:
        scratch_names = self.collect_variable_names(machine)
        scratch_map = {name: idx for idx, name in enumerate(scratch_names)}
        trace_start_steps: Dict[str, int] = {}
        trace_name_to_idx = {trace.name: idx for idx, trace in enumerate(machine.traces)}
        trace_params = [
            self.collect_trace_external_symbols(trace, machine.scratch)
            for trace in machine.traces
        ]
        all_steps: List[Step] = []
        exprs: List[Expr] = []

        def intern_expr(expr: Optional[Expr]) -> int:
            if expr is None:
                return -1
            lhs = intern_expr(expr.lhs) if expr.lhs is not None else -1
            rhs = intern_expr(expr.rhs) if expr.rhs is not None else -1
            exprs.append(
                Expr(
                    kind=expr.kind,
                    value=expr.value,
                    scratch=expr.scratch,
                    symbol=expr.symbol,
                    offset=expr.offset,
                    lhs_idx=lhs,
                    rhs_idx=rhs,
                )
            )
            return len(exprs) - 1

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
                    assign_match = ASSIGN_RE.match(line)
                    call_stmt_match = CALL_STMT_RE.match(line)
                    if read_match:
                        step.kind = "read"
                        step.width = int(read_match.group("width"))
                        step.addr = intern_expr(
                            self.parse_expr(
                                read_match.group("addr"),
                                scratch_map,
                                allow_symbol=True,
                            )
                        )
                        step.scratch = scratch_map.get(read_match.group("lhs"), -1)
                    elif write_match:
                        step.kind = "write"
                        step.width = int(write_match.group("width"))
                        step.addr = intern_expr(
                            self.parse_expr(
                                write_match.group("addr"),
                                scratch_map,
                                allow_symbol=True,
                            )
                        )
                        step.value = intern_expr(
                            self.parse_expr(
                                write_match.group("value"),
                                scratch_map,
                                allow_symbol=False,
                            )
                        )
                    elif neqj_match:
                        step.kind = "branch"
                        step.next_b = -2
                        step.next_a = -2
                        step.addr = intern_expr(
                            self.parse_expr(
                                neqj_match.group("lhs"),
                                scratch_map,
                                allow_symbol=False,
                            )
                        )
                        step.value = intern_expr(
                            self.parse_expr(
                                neqj_match.group("rhs"),
                                scratch_map,
                                allow_symbol=False,
                            )
                        )
                        step.scratch = -1
                    elif call_stmt_match:
                        call_trace = trace_name_to_idx.get(
                            sanitize_call_name(call_stmt_match.group("name")) + "_trace",
                            -1,
                        )
                        if call_trace >= 0:
                            step.kind = "call"
                            step.call_trace = call_trace
                            step.call_args = tuple(
                                intern_expr(
                                    self.parse_expr(
                                        arg,
                                        scratch_map,
                                        allow_symbol=True,
                                    )
                                )
                                for arg in split_args(call_stmt_match.group("args"))
                            )
                        else:
                            step.kind = "eps"
                    elif assign_match and not WRITE_RE.match(line):
                        lhs = assign_match.group("lhs")
                        rhs = assign_match.group("rhs").strip()
                        call_expr_match = CALL_EXPR_RE.match(rhs)
                        if call_expr_match:
                            call_trace = trace_name_to_idx.get(
                                sanitize_call_name(call_expr_match.group("name")) + "_trace",
                                -1,
                            )
                            if call_trace >= 0:
                                step.kind = "call"
                                step.call_trace = call_trace
                                step.scratch = scratch_map.get(lhs, -1)
                                step.call_args = tuple(
                                    intern_expr(
                                        self.parse_expr(
                                            arg,
                                            scratch_map,
                                            allow_symbol=True,
                                        )
                                    )
                                    for arg in split_args(call_expr_match.group("args"))
                                )
                            else:
                                step.kind = "assign"
                                step.scratch = scratch_map.get(lhs, -1)
                                step.value = intern_expr(
                                    self.parse_expr(
                                        rhs,
                                        scratch_map,
                                        allow_symbol=False,
                                    )
                                )
                        else:
                            step.kind = "assign"
                            step.scratch = scratch_map.get(lhs, -1)
                            step.value = intern_expr(
                                self.parse_expr(
                                    rhs,
                                    scratch_map,
                                    allow_symbol=False,
                                )
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
                        target = match.group("label")
                        step.next_a = label_to_start.get(target, default_next)
                        step.next_b = default_next
                    elif step.kind != "end":
                        step.next_a = default_next
                trace_steps[end - 1].next_a = (
                    block_offsets[block_idx + 1]
                    if block_idx + 1 < len(block_offsets)
                    else -1
                )

            trace_base = len(all_steps)
            for step in trace_steps:
                if step.next_a >= 0:
                    step.next_a += trace_base
                if step.next_b >= 0:
                    step.next_b += trace_base
            trace_start_steps[trace.name] = trace_base
            all_steps.extend(trace_steps)

        state_ids = {name: idx for idx, name in enumerate(machine.states)}
        trace_ids = {trace.name: idx for idx, trace in enumerate(machine.traces)}
        compiled_transitions: List[Tuple[int, int, int]] = []
        for src, dst, trace in machine.transitions:
            if src not in state_ids or dst not in state_ids or trace not in trace_ids:
                continue
            compiled_transitions.append((state_ids[src], state_ids[dst], trace_ids[trace]))

        active_names = self.active_trace_names(machine)
        starts = [
            trace_start_steps[trace.name]
            for trace in machine.traces
            if trace.blocks
            and (active_names is None or trace.name in active_names)
        ]
        return (
            all_steps,
            exprs,
            starts,
            scratch_map,
            trace_params,
            list(machine.states),
            compiled_transitions,
            state_ids.get(machine.initial, -1),
        )

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

struct dl_cursor {{
    int machine;
    int state;
    int trace;
    int step;
    int call_depth;
    uint32_t score;
    uint64_t scratch[256];
    uint8_t scratch_valid[256];
    uint64_t symbols[256];
    uint8_t symbol_valid[256];
    int return_steps[32];
    int return_traces[32];
    int return_bindings[32];
}};

struct {self.symbol_prefix}_machine {{
    struct dl_cursor active[256];
    size_t active_count;
    struct dl_cursor matched[256];
    size_t matched_count;
    int booting_complete;
    int runtime_started;
}};

void {self.symbol_prefix}_init(struct {self.symbol_prefix}_machine *machine);
int {self.symbol_prefix}_feed_event(
    struct {self.symbol_prefix}_machine *machine,
    const struct devilang_event *event);
int {self.symbol_prefix}_parse_trace_line(
    const char *line,
    struct devilang_event *event);
int {self.symbol_prefix}_feed_trace_line(
    struct {self.symbol_prefix}_machine *machine,
    const char *line);
size_t {self.symbol_prefix}_collect_active(
    const struct {self.symbol_prefix}_machine *machine,
    struct devilang_active_state *out,
    size_t cap);
size_t {self.symbol_prefix}_collect_matched(
    const struct {self.symbol_prefix}_machine *machine,
    struct devilang_active_state *out,
    size_t cap);
int {self.symbol_prefix}_best_active(
    const struct {self.symbol_prefix}_machine *machine,
    struct devilang_active_state *out);

#endif
"""

    def render_expr(self, expr: Expr) -> str:
        kind_map = {
            "any": "DL_EXPR_ANY",
            "const": "DL_EXPR_CONST",
            "scratch": "DL_EXPR_SCRATCH",
            "symbol": "DL_EXPR_SYMBOL",
            "add": "DL_EXPR_ADD",
            "sub": "DL_EXPR_SUB",
            "and": "DL_EXPR_AND",
            "or": "DL_EXPR_OR",
            "shl": "DL_EXPR_SHL",
            "lshr": "DL_EXPR_LSHR",
            "eq": "DL_EXPR_EQ",
            "ne": "DL_EXPR_NE",
            "ult": "DL_EXPR_ULT",
            "ule": "DL_EXPR_ULE",
            "ugt": "DL_EXPR_UGT",
            "uge": "DL_EXPR_UGE",
            "slt": "DL_EXPR_SLT",
            "sle": "DL_EXPR_SLE",
            "sgt": "DL_EXPR_SGT",
            "sge": "DL_EXPR_SGE",
        }
        return "{{{kind}, {value}, {scratch}, {symbol}, {offset}, {lhs_idx}, {rhs_idx}}}".format(
            kind=kind_map.get(expr.kind, "DL_EXPR_ANY"),
            value=self.render_u64_literal(expr.value or 0),
            scratch=expr.scratch if expr.scratch is not None else -1,
            symbol=expr.symbol if expr.symbol is not None else -1,
            offset=expr.offset,
            lhs_idx=expr.lhs_idx,
            rhs_idx=expr.rhs_idx,
        )

    def render_u64_literal(self, value: int) -> str:
        return f"0x{value & ((1 << 64) - 1):x}ULL"

    def render_call_args(self, args: Tuple[int, ...]) -> str:
        values = [str(arg) for arg in args[:8]]
        values.extend("-1" for _ in range(8 - len(values)))
        return ", ".join(values)

    def render_c(
        self,
        machines: List[Machine],
        compiled: List[
            Tuple[
                List[Step],
                List[Expr],
                List[int],
                Dict[str, int],
                List[List[str]],
                List[str],
                List[Tuple[int, int, int]],
                int,
            ]
        ],
        header_name: str,
    ) -> str:
        lines: List[str] = []
        lines.append(f'#include "{header_name}"')
        lines.append("")
        lines.append("#include <stdbool.h>")
        lines.append("#include <ctype.h>")
        lines.append("#include <stdint.h>")
        lines.append("#include <string.h>")
        lines.append("")
        lines.append("enum dl_step_kind { DL_STEP_EPS, DL_STEP_READ, DL_STEP_WRITE, DL_STEP_BRANCH, DL_STEP_WILDCARD, DL_STEP_ASSIGN, DL_STEP_CALL, DL_STEP_END };")
        lines.append("enum dl_expr_kind { DL_EXPR_ANY, DL_EXPR_CONST, DL_EXPR_SCRATCH, DL_EXPR_SYMBOL, DL_EXPR_ADD, DL_EXPR_SUB, DL_EXPR_AND, DL_EXPR_OR, DL_EXPR_SHL, DL_EXPR_LSHR, DL_EXPR_EQ, DL_EXPR_NE, DL_EXPR_ULT, DL_EXPR_ULE, DL_EXPR_UGT, DL_EXPR_UGE, DL_EXPR_SLT, DL_EXPR_SLE, DL_EXPR_SGT, DL_EXPR_SGE };")
        lines.append("")
        lines.append("struct dl_expr { int kind; uint64_t value; int scratch; int symbol; int64_t offset; int lhs_idx; int rhs_idx; };")
        lines.append("struct dl_step { int kind; int width; int addr; int value; int scratch; int call_trace; int arg_count; int call_args[8]; int next_a; int next_b; int trace; int block; };")
        lines.append("struct dl_trace_meta { const char *name; const char **blocks; size_t nr_blocks; int start_step; const int *param_symbols; size_t nr_param_symbols; };")
        lines.append("struct dl_transition { int src_state; int dst_state; int trace; };")
        lines.append("struct dl_machine_meta { const char *phase; const struct dl_trace_meta *traces; size_t nr_traces; const char **states; size_t nr_states; const struct dl_transition *transitions; size_t nr_transitions; const struct dl_expr *exprs; size_t nr_exprs; int initial_state; };")
        lines.append("")

        for machine_idx, machine in enumerate(machines):
            steps = compiled[machine_idx][0]
            exprs = compiled[machine_idx][1]
            trace_params = compiled[machine_idx][4]
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
                    "static const int %s_machine_%d_trace_%d_params[] = { %s };"
                    % (
                        self.symbol_prefix,
                        machine_idx,
                        trace_idx,
                        ", ".join(
                            str(self.symbol_id(name))
                            for name in trace_params[trace_idx]
                        ) if trace_params[trace_idx] else "-1",
                    )
                )
            lines.append(
                "static const struct dl_expr %s_machine_%d_exprs[] = {"
                % (self.symbol_prefix, machine_idx)
            )
            for expr in exprs:
                lines.append(f"    {self.render_expr(expr)},")
            lines.append("};")
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
                    "assign": "DL_STEP_ASSIGN",
                    "call": "DL_STEP_CALL",
                    "end": "DL_STEP_END",
                }
                lines.append(
                    "    {%s, %d, %d, %d, %d, %d, %d, {%s}, %d, %d, %d, %d},"
                    % (
                        kind_map[step.kind],
                        step.width,
                        step.addr,
                        step.value,
                        step.scratch,
                        step.call_trace,
                        len(step.call_args),
                        self.render_call_args(step.call_args),
                        step.next_a,
                        step.next_b,
                        step.trace,
                        step.block,
                    )
                )
            lines.append("};")
            lines.append(
                "static const char *%s_machine_%d_states[] = { %s };"
                % (
                    self.symbol_prefix,
                    machine_idx,
                    ", ".join(
                        '"%s"' % state.replace('"', '\\"')
                        for state in compiled[machine_idx][5]
                    ) if compiled[machine_idx][5] else '""',
                )
            )
            lines.append(
                "static const struct dl_transition %s_machine_%d_transitions[] = {"
                % (self.symbol_prefix, machine_idx)
            )
            for src_state, dst_state, trace_id in compiled[machine_idx][6]:
                lines.append(
                    "    {%d, %d, %d},"
                    % (src_state, dst_state, trace_id)
                )
            lines.append("};")
            lines.append(
                "static const struct dl_trace_meta %s_machine_%d_traces[] = {"
                % (self.symbol_prefix, machine_idx)
            )
            offset = 0
            for trace_idx, trace in enumerate(machine.traces):
                lines.append(
                    '    {"%s", %s_machine_%d_trace_%d_blocks, %d, %d, %s_machine_%d_trace_%d_params, %d},'
                    % (
                        trace.name.replace('"', '\\"'),
                        self.symbol_prefix,
                        machine_idx,
                        trace_idx,
                        len(trace.blocks),
                        offset,
                        self.symbol_prefix,
                        machine_idx,
                        trace_idx,
                        len(trace_params[trace_idx]),
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
                '    {"%s", %s_machine_%d_traces, %d, %s_machine_%d_states, %d, %s_machine_%d_transitions, %d, %s_machine_%d_exprs, %d, %d},'
                % (
                    machine.name.replace('"', '\\"'),
                    self.symbol_prefix,
                    machine_idx,
                    len(machine.traces),
                    self.symbol_prefix,
                    machine_idx,
                    len(compiled[machine_idx][5]),
                    self.symbol_prefix,
                    machine_idx,
                    len(compiled[machine_idx][6]),
                    self.symbol_prefix,
                    machine_idx,
                    len(compiled[machine_idx][1]),
                    compiled[machine_idx][7],
                )
            )
        lines.append("};")
        lines.append("")
        lines.append(
            "static const char *%s_symbol_names[] = { %s };"
            % (
                self.symbol_prefix,
                ", ".join(
                    '"%s"' % name.replace('"', '\\"')
                    for name, _idx in sorted(self.symbol_ids.items(), key=lambda item: item[1])
                ) if self.symbol_ids else '""',
            )
        )
        lines.append("")

        lines.append(
            """static const char *dl_find_hex_value(
    const char *line,
    const char *label) {
    const char *match = strstr(line, label);
    if (!match) {
        return NULL;
    }
    match += strlen(label);
    while (*match == ' ' || *match == '\\t') {
        ++match;
    }
    return match;
}"""
        )
        lines.append("")
        lines.append(
            """static int dl_parse_u64_hex(
    const char *text,
    uint64_t *out) {
    uint64_t value = 0;
    int digits = 0;

    if (!text || text[0] != '0' || (text[1] != 'x' && text[1] != 'X')) {
        return -1;
    }

    text += 2;
    while (*text) {
        unsigned char ch = (unsigned char)*text;
        uint64_t digit = 0;

        if (ch >= '0' && ch <= '9') {
            digit = (uint64_t)(ch - '0');
        } else if (ch >= 'a' && ch <= 'f') {
            digit = (uint64_t)(ch - 'a' + 10);
        } else if (ch >= 'A' && ch <= 'F') {
            digit = (uint64_t)(ch - 'A' + 10);
        } else {
            break;
        }

        value = (value << 4) | digit;
        ++digits;
        ++text;
    }

    if (!digits) {
        return -1;
    }

    *out = value;
    return 0;
}"""
        )
        lines.append("")
        lines.append(
            """static int dl_symbol_name_has_suffix(
    const char *name,
    const char *suffix) {
    size_t name_len = strlen(name);
    size_t suffix_len = strlen(suffix);

    if (name_len < suffix_len) {
        return 0;
    }
    return strcmp(name + name_len - suffix_len, suffix) == 0;
}"""
        )
        lines.append("")
        lines.append(
            """static int dl_symbol_allows_value(
    int symbol,
    uint64_t value) {
    const char *name;

    if (symbol < 0) {
        return 0;
    }

    name = %s_symbol_names[symbol];
    if (strcmp(name, "offset") == 0 ||
        strcmp(name, "len") == 0 ||
        strcmp(name, "size") == 0 ||
        strcmp(name, "width") == 0 ||
        strcmp(name, "i") == 0 ||
        strcmp(name, "idx") == 0 ||
        strcmp(name, "index") == 0 ||
        dl_symbol_name_has_suffix(name, "_offset") ||
        dl_symbol_name_has_suffix(name, "_len") ||
        dl_symbol_name_has_suffix(name, "_size") ||
        dl_symbol_name_has_suffix(name, "_width") ||
        dl_symbol_name_has_suffix(name, "_idx") ||
        dl_symbol_name_has_suffix(name, "_index")) {
        return value <= 0x7fffffffULL;
    }

    return 1;
}"""
            % self.symbol_prefix
        )
        lines.append("")
        lines.append(
            """static uint64_t dl_eval_expr(
    const struct dl_expr *exprs,
    int expr_idx,
    const struct dl_cursor *cursor,
    int *known) {
    int lhs_known = 0;
    int rhs_known = 0;
    uint64_t lhs = 0;
    uint64_t rhs = 0;
    const struct dl_expr *expr;

    if (expr_idx < 0) {
        *known = 0;
        return 0;
    }

    expr = &exprs[expr_idx];
    switch (expr->kind) {
    case DL_EXPR_ANY:
        *known = 0;
        return 0;
    case DL_EXPR_CONST:
        *known = 1;
        return expr->value;
    case DL_EXPR_SCRATCH:
        if (expr->scratch < 0 || !cursor->scratch_valid[expr->scratch]) {
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
        lhs = dl_eval_expr(exprs, expr->lhs_idx, cursor, &lhs_known);
        rhs = dl_eval_expr(exprs, expr->rhs_idx, cursor, &rhs_known);
        *known = lhs_known && rhs_known;
        if (!*known) {
            return 0;
        }
        switch (expr->kind) {
        case DL_EXPR_ADD:
            return lhs + rhs;
        case DL_EXPR_SUB:
            return lhs - rhs;
        case DL_EXPR_AND:
            return lhs & rhs;
        case DL_EXPR_OR:
            return lhs | rhs;
        case DL_EXPR_SHL:
            return lhs << rhs;
        case DL_EXPR_LSHR:
            return lhs >> rhs;
        case DL_EXPR_EQ:
            return lhs == rhs;
        case DL_EXPR_NE:
            return lhs != rhs;
        case DL_EXPR_ULT:
            return lhs < rhs;
        case DL_EXPR_ULE:
            return lhs <= rhs;
        case DL_EXPR_UGT:
            return lhs > rhs;
        case DL_EXPR_UGE:
            return lhs >= rhs;
        case DL_EXPR_SLT:
            return (uint64_t)((int64_t)lhs < (int64_t)rhs);
        case DL_EXPR_SLE:
            return (uint64_t)((int64_t)lhs <= (int64_t)rhs);
        case DL_EXPR_SGT:
            return (uint64_t)((int64_t)lhs > (int64_t)rhs);
        case DL_EXPR_SGE:
            return (uint64_t)((int64_t)lhs >= (int64_t)rhs);
        default:
            *known = 0;
            return 0;
        }
    }
}"""
        )
        lines.append("")
        lines.append(
            """static int dl_bind_expr(
    const struct dl_expr *exprs,
    int expr_idx,
    struct dl_cursor *cursor,
    uint64_t target) {
    int lhs_known = 0;
    int rhs_known = 0;
    uint64_t lhs = 0;
    uint64_t rhs = 0;
    const struct dl_expr *expr;

    if (expr_idx < 0) {
        return 0;
    }

    expr = &exprs[expr_idx];
    if (expr->kind == DL_EXPR_SYMBOL && expr->symbol >= 0 &&
        !cursor->symbol_valid[expr->symbol]) {
        uint64_t value = target - (uint64_t)expr->offset;
        if (!dl_symbol_allows_value(expr->symbol, value)) {
            return 0;
        }
        cursor->symbols[expr->symbol] = value;
        cursor->symbol_valid[expr->symbol] = 1;
        return 1;
    }

    if (expr->kind == DL_EXPR_ADD || expr->kind == DL_EXPR_SUB) {
        lhs = dl_eval_expr(exprs, expr->lhs_idx, cursor, &lhs_known);
        rhs = dl_eval_expr(exprs, expr->rhs_idx, cursor, &rhs_known);
        if (lhs_known && !rhs_known) {
            uint64_t rhs_target = expr->kind == DL_EXPR_ADD
                ? target - lhs
                : lhs - target;
            return dl_bind_expr(exprs, expr->rhs_idx, cursor, rhs_target);
        }
        if (!lhs_known && rhs_known) {
            uint64_t lhs_target = expr->kind == DL_EXPR_ADD
                ? target - rhs
                : target + rhs;
            return dl_bind_expr(exprs, expr->lhs_idx, cursor, lhs_target);
        }
    }

    return 0;
}"""
        )
        lines.append("")
        lines.append(
            """static int dl_match_addr(
    const struct dl_expr *exprs,
    int expr_idx,
    struct dl_cursor *cursor,
    uint64_t addr) {
    int known = 0;
    const struct dl_expr *expr;

    if (expr_idx < 0) {
        return 0;
    }

    expr = &exprs[expr_idx];
    if (expr->kind == DL_EXPR_ANY) {
        return 1;
    }
    if (expr->kind == DL_EXPR_SYMBOL && expr->symbol >= 0 &&
        !cursor->symbol_valid[expr->symbol]) {
        uint64_t value = addr - (uint64_t)expr->offset;
        if (!dl_symbol_allows_value(expr->symbol, value)) {
            return 0;
        }
        cursor->symbols[expr->symbol] = value;
        cursor->symbol_valid[expr->symbol] = 1;
        return 1;
    }
    if (dl_eval_expr(exprs, expr_idx, cursor, &known) == addr) {
        return 1;
    }
    if (!known && dl_bind_expr(exprs, expr_idx, cursor, addr)) {
        return 1;
    }
    return !known;
}"""
        )
        lines.append("")
        lines.append(
            """static int dl_match_value(
    const struct dl_expr *exprs,
    int expr_idx,
    const struct dl_cursor *cursor,
    uint64_t value) {
    int known = 0;

    if (expr_idx < 0) {
        return 0;
    }
    if (exprs[expr_idx].kind == DL_EXPR_ANY) {
        return 1;
    }
    return dl_eval_expr(exprs, expr_idx, cursor, &known) == value || !known;
}"""
        )
        lines.append("")
        lines.append(
            """static int dl_branch_taken(
    const struct dl_expr *exprs,
    const struct dl_step *step,
    const struct dl_cursor *cursor,
    int *known) {
    int lhs_known = 0;
    int rhs_known = 0;
    uint64_t lhs;
    uint64_t rhs;

    lhs = dl_eval_expr(exprs, step->addr, cursor, &lhs_known);
    rhs = dl_eval_expr(exprs, step->value, cursor, &rhs_known);
    *known = lhs_known && rhs_known;
    if (!*known) {
        return 0;
    }
    return lhs != rhs;
}"""
        )
        lines.append("")
        lines.append(
            """static int dl_cursor_equal(
    const struct dl_cursor *lhs,
    const struct dl_cursor *rhs) {
    return memcmp(lhs, rhs, sizeof(*lhs)) == 0;
}"""
        )
        lines.append("")
        lines.append(
            """static void dl_push_cursor(
    struct dl_cursor *out,
    size_t *count,
    const struct dl_cursor *cursor) {
    for (size_t i = 0; i < *count; ++i) {
        if (dl_cursor_equal(&out[i], cursor)) {
            return;
        }
    }
    if (*count >= 256) {
        return;
    }
    out[*count] = *cursor;
    (*count)++;
}"""
        )
        lines.append("")
        lines.append(
            """static void dl_activate_state(
    const struct dl_machine_meta *machine_meta,
    int machine_idx,
    const struct dl_cursor *base,
    int state,
    struct dl_cursor *out,
    size_t *count) {
    for (size_t i = 0; i < machine_meta->nr_transitions; ++i) {
        const struct dl_transition *transition = &machine_meta->transitions[i];
        const struct dl_trace_meta *trace;
        struct dl_cursor next;

        if (transition->src_state != state) {
            continue;
        }
        if (transition->trace < 0 ||
            (size_t)transition->trace >= machine_meta->nr_traces) {
            continue;
        }

        trace = &machine_meta->traces[transition->trace];
        next = *base;
        next.machine = machine_idx;
        next.state = state;
        next.trace = transition->trace;
        next.step = trace->start_step;
        dl_push_cursor(out, count, &next);
    }
}"""
        )
        lines.append("")
        lines.append(
            """static void dl_bind_call_params(
    const struct dl_machine_meta *machine_meta,
    const struct dl_trace_meta *trace_meta,
    const struct dl_step *step,
    struct dl_cursor *cursor) {
    int used_args[8] = {0};

    for (size_t i = 0; i < trace_meta->nr_param_symbols; ++i) {
        int param_symbol = trace_meta->param_symbols[i];
        if (param_symbol < 0 || cursor->symbol_valid[param_symbol]) {
            continue;
        }
        for (int arg_index = 0; arg_index < step->arg_count; ++arg_index) {
            int known = 0;
            uint64_t value = 0;
            const struct dl_expr *arg_expr;

            if (used_args[arg_index] || step->call_args[arg_index] < 0) {
                continue;
            }
            arg_expr = &machine_meta->exprs[step->call_args[arg_index]];
            if (arg_expr->kind == DL_EXPR_SYMBOL &&
                arg_expr->symbol == param_symbol) {
                value = dl_eval_expr(machine_meta->exprs, step->call_args[arg_index],
                                     cursor, &known);
                if (!known) {
                    continue;
                }
                cursor->symbols[param_symbol] = value;
                cursor->symbol_valid[param_symbol] = 1;
                used_args[arg_index] = 1;
                break;
            }
        }
    }

    for (size_t i = 0; i < trace_meta->nr_param_symbols; ++i) {
        int param_symbol = trace_meta->param_symbols[i];
        const char *param_name;

        if (param_symbol < 0 || cursor->symbol_valid[param_symbol]) {
            continue;
        }
        param_name = %s_symbol_names[param_symbol];
        if (strcmp(param_name, "len") != 0 &&
            strcmp(param_name, "size") != 0 &&
            strcmp(param_name, "width") != 0) {
            continue;
        }
        for (int arg_index = 0; arg_index < step->arg_count; ++arg_index) {
            const struct dl_expr *arg_expr;
            if (used_args[arg_index] || step->call_args[arg_index] < 0) {
                continue;
            }
            arg_expr = &machine_meta->exprs[step->call_args[arg_index]];
            if (arg_expr->kind != DL_EXPR_CONST) {
                continue;
            }
            cursor->symbols[param_symbol] = arg_expr->value;
            cursor->symbol_valid[param_symbol] = 1;
            used_args[arg_index] = 1;
            break;
        }
        if (cursor->symbol_valid[param_symbol]) {
            continue;
        }
        for (int arg_index = 0; arg_index < step->arg_count; ++arg_index) {
            int known = 0;
            uint64_t value = dl_eval_expr(machine_meta->exprs, step->call_args[arg_index],
                                          cursor, &known);
            if (used_args[arg_index] || !known) {
                continue;
            }
            cursor->symbols[param_symbol] = value;
            cursor->symbol_valid[param_symbol] = 1;
            used_args[arg_index] = 1;
            break;
        }
    }
}"""
            % self.symbol_prefix
        )
        lines.append("")
        lines.append(
            """static void dl_closure(
    const struct dl_machine_meta *machine_meta,
    const struct dl_step *steps,
    struct dl_cursor *io,
    size_t *count) {
    size_t index = 0;
    while (index < *count) {
        struct dl_cursor cursor = io[index];
        if (cursor.step < 0) {
            index++;
            continue;
        }
        const struct dl_step *step = &steps[cursor.step];
        if (step->kind == DL_STEP_EPS) {
            io[index].step = step->next_a;
            continue;
        }
        if (step->kind == DL_STEP_ASSIGN) {
            int known = 0;
            uint64_t value = dl_eval_expr(machine_meta->exprs, step->value,
                                          &cursor, &known);
            if (step->scratch >= 0) {
                if (known) {
                    io[index].scratch[step->scratch] = value;
                    io[index].scratch_valid[step->scratch] = 1;
                } else {
                    io[index].scratch_valid[step->scratch] = 0;
                }
            }
            io[index].step = step->next_a;
            continue;
        }
        if (step->kind == DL_STEP_CALL) {
            if (step->call_trace < 0 ||
                (size_t)step->call_trace >= machine_meta->nr_traces ||
                io[index].call_depth >= 32) {
                io[index].step = step->next_a;
                if (step->scratch >= 0) {
                    io[index].scratch_valid[step->scratch] = 0;
                }
                continue;
            }
            io[index].return_steps[io[index].call_depth] = step->next_a;
            io[index].return_traces[io[index].call_depth] = cursor.trace;
            io[index].return_bindings[io[index].call_depth] = step->scratch;
            io[index].call_depth++;
            io[index].trace = step->call_trace;
            dl_bind_call_params(machine_meta,
                                &machine_meta->traces[step->call_trace],
                                step,
                                &io[index]);
            io[index].step = machine_meta->traces[step->call_trace].start_step;
            continue;
        }
        if (step->kind == DL_STEP_BRANCH) {
            int known = 0;
            int taken = dl_branch_taken(machine_meta->exprs, step, &cursor, &known);
            if (known) {
                io[index].step = taken ? step->next_a : step->next_b;
                continue;
            }
            struct dl_cursor alt = cursor;
            io[index].step = step->next_a;
            alt.step = step->next_b;
            dl_push_cursor(io, count, &alt);
            continue;
        }
        if (step->kind == DL_STEP_END) {
            if (io[index].call_depth > 0) {
                int binding;
                io[index].call_depth--;
                binding = io[index].return_bindings[io[index].call_depth];
                if (binding >= 0) {
                    io[index].scratch_valid[binding] = 0;
                }
                io[index].trace = io[index].return_traces[io[index].call_depth];
                io[index].step = io[index].return_steps[io[index].call_depth];
                continue;
            }
            io[index].step = -1;
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
    int machine_idx,
    const struct dl_step *steps,
    const struct dl_cursor *cursor,
    struct dl_cursor *out,
    size_t *out_count) {
    struct dl_cursor local[256];
    size_t local_count = 1;
    int has_live = 0;
    local[0] = *cursor;
    dl_closure(machine_meta, steps, local, &local_count);
    for (size_t i = 0; i < local_count; ++i) {
        if (local[i].step >= 0) {
            has_live = 1;
        }
    }
    for (size_t i = 0; i < local_count; ++i) {
        if (local[i].step < 0) {
            continue;
        }
        dl_push_cursor(out, out_count, &local[i]);
    }
    if (!has_live) {
        for (size_t j = 0; j < machine_meta->nr_transitions; ++j) {
            const struct dl_transition *transition =
                &machine_meta->transitions[j];
            if (transition->src_state != cursor->state ||
                transition->trace != cursor->trace) {
                continue;
            }
            dl_activate_state(machine_meta, machine_idx, cursor,
                              transition->dst_state, out, out_count);
        }
    }
}"""
        )
        lines.append("")
        lines.append(
            """void %s_init(struct %s_machine *machine) {
    memset(machine, 0, sizeof(*machine));
    const struct dl_machine_meta *meta = &%s_machines[0];
    struct dl_cursor base;
    memset(&base, 0, sizeof(base));
    base.machine = 0;
    dl_activate_state(meta, 0, &base, meta->initial_state, machine->active,
                      &machine->active_count);
    dl_closure(meta, %s_machine_0_steps, machine->active, &machine->active_count);
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
    struct dl_cursor cursor;
    memset(&cursor, 0, sizeof(cursor));
    cursor.machine = 1;
    dl_activate_state(meta, 1, &cursor, meta->initial_state, expanded,
                      &expanded_count);
    for (size_t i = 0; i < expanded_count; ++i) {
        dl_push_cursor(machine->active, &machine->active_count, &expanded[i]);
    }
}"""
            % (self.symbol_prefix, len(machines), self.symbol_prefix)
        )
        lines.append("")
        lines.append(
            """static void dl_normalize_active_set(
    struct %s_machine *machine) {
    struct dl_cursor expanded[256];
    size_t expanded_count = 0;

    for (size_t i = 0; i < machine->active_count; ++i) {
        const struct dl_machine_meta *meta =
            &%s_machines[machine->active[i].machine];
        const struct dl_step *steps = machine->active[i].machine == 0
            ? %s_machine_0_steps
            : %s_machine_1_steps;
        dl_expand_cursor(meta, machine->active[i].machine, steps,
                         &machine->active[i], expanded, &expanded_count);
    }

    machine->active_count = expanded_count;
    memcpy(machine->active, expanded, sizeof(expanded[0]) * expanded_count);
}"""
            % (
                self.symbol_prefix,
                self.symbol_prefix,
                self.symbol_prefix,
                self.symbol_prefix,
            )
        )
        lines.append("")
        lines.append(
            """int %s_feed_event(
    struct %s_machine *machine,
    const struct devilang_event *event) {
    struct dl_cursor next[256];
    size_t next_count = 0;

    dl_normalize_active_set(machine);

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
            if (!dl_match_addr(%s_machines[cursor.machine].exprs, step->addr, &cursor, event->addr)) {
                continue;
            }
            if (step->scratch >= 0) {
                cursor.scratch[step->scratch] = event->value;
                cursor.scratch_valid[step->scratch] = 1;
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
            if (!dl_match_addr(%s_machines[cursor.machine].exprs, step->addr, &cursor, event->addr)) {
                continue;
            }
            if (!dl_match_value(%s_machines[cursor.machine].exprs, step->value, &cursor, event->value)) {
                continue;
            }
            cursor.step = step->next_a;
            cursor.score += 1;
            dl_push_cursor(next, &next_count, &cursor);
        }
    }
    if (next_count == 0) {
        machine->matched_count = 0;
        machine->active_count = 0;
        return 1;
    }
    machine->matched_count = next_count;
    memcpy(machine->matched, next, sizeof(next[0]) * next_count);
    machine->active_count = next_count;
    memcpy(machine->active, next, sizeof(next[0]) * next_count);
    struct dl_cursor expanded[256];
    size_t expanded_count = 0;
    int has_live_booting = 0;
    for (size_t i = 0; i < machine->active_count; ++i) {
        const struct dl_machine_meta *meta = &%s_machines[machine->active[i].machine];
        const struct dl_step *steps = machine->active[i].machine == 0
            ? %s_machine_0_steps
            : %s_machine_1_steps;
        dl_expand_cursor(meta, machine->active[i].machine, steps, &machine->active[i],
                         expanded, &expanded_count);
    }
    machine->active_count = expanded_count;
    memcpy(machine->active, expanded, sizeof(expanded[0]) * expanded_count);
    for (size_t i = 0; i < machine->active_count; ++i) {
        if (machine->active[i].machine == 0 && machine->active[i].step >= 0) {
            has_live_booting = 1;
            break;
        }
    }
    machine->booting_complete = machine->booting_complete || !has_live_booting;
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
                self.symbol_prefix,
                self.symbol_prefix,
                self.symbol_prefix,
            )
        )
        lines.append("")
        lines.append(
            """int %s_parse_trace_line(
    const char *line,
    struct devilang_event *event) {
    const char *addr_text;
    const char *value_text;

    if (!line || !event) {
        return -1;
    }

    memset(event, 0, sizeof(*event));
    event->width = 32;

    if (strstr(line, "virtio_mmio_read ") != NULL) {
        event->kind = DEVILANG_EV_MMIO_READ;
    } else if (strstr(line, "virtio_mmio_write ") != NULL ||
               strstr(line, "virtio_mmio_write_offset ") != NULL) {
        event->kind = DEVILANG_EV_MMIO_WRITE;
    } else {
        return -1;
    }

    addr_text = dl_find_hex_value(line, "addr");
    if (!addr_text || dl_parse_u64_hex(addr_text, &event->addr) != 0) {
        return -1;
    }

    if (event->kind == DEVILANG_EV_MMIO_WRITE) {
        value_text = dl_find_hex_value(line, "value");
        if (!value_text || dl_parse_u64_hex(value_text, &event->value) != 0) {
            return -1;
        }
    } else {
        value_text = dl_find_hex_value(line, "value");
        if (value_text) {
            if (dl_parse_u64_hex(value_text, &event->value) != 0) {
                return -1;
            }
        }
    }

    return 0;
}"""
            % self.symbol_prefix
        )
        lines.append("")
        lines.append(
            """int %s_feed_trace_line(
    struct %s_machine *machine,
    const char *line) {
    struct devilang_event event;

    if (%s_parse_trace_line(line, &event) != 0) {
        return -1;
    }

    return %s_feed_event(machine, &event);
}"""
            % (
                self.symbol_prefix,
                self.symbol_prefix,
                self.symbol_prefix,
                self.symbol_prefix,
            )
        )
        lines.append("")
        lines.append(
            """static void dl_project_cursor(
    const struct dl_cursor *cursor,
    int *trace_out,
    int *step_out) {
    if (cursor->call_depth > 0) {
        int return_step = cursor->return_steps[0];
        *trace_out = cursor->return_traces[0];
        *step_out = return_step > 0 ? return_step - 1 : return_step;
        return;
    }

    *trace_out = cursor->trace;
    *step_out = cursor->step;
}"""
        )
        lines.append("")
        lines.append(
            """static size_t dl_collect_states(
    const struct dl_cursor *cursors,
    size_t cursor_count,
    struct devilang_active_state *out,
    size_t cap) {
    size_t written = 0;
    for (size_t i = 0; i < cursor_count && written < cap; ++i) {
        const struct dl_cursor *cursor = &cursors[i];
        int trace_index = -1;
        int step_index = -1;
        if (cursor->step < 0) {
            continue;
        }
        dl_project_cursor(cursor, &trace_index, &step_index);
        if (trace_index < 0 || step_index < 0) {
            continue;
        }
        const struct dl_machine_meta *meta = &%s_machines[cursor->machine];
        const struct dl_trace_meta *trace = &meta->traces[trace_index];
        int block = 0;
        const struct dl_step *steps = cursor->machine == 0
            ? %s_machine_0_steps
            : %s_machine_1_steps;
        block = steps[step_index].block;
        out[written].phase = meta->phase;
        out[written].trace = trace->name;
        out[written].block = block >= 0 && (size_t)block < trace->nr_blocks
            ? trace->blocks[block]
            : "entry";
        out[written].score = cursor->score;
        for (size_t j = 0; j < written; ++j) {
            if (strcmp(out[j].phase, out[written].phase) == 0 &&
                strcmp(out[j].trace, out[written].trace) == 0 &&
                strcmp(out[j].block, out[written].block) == 0) {
                if (out[written].score > out[j].score) {
                    out[j].score = out[written].score;
                }
                goto next_cursor;
            }
        }
        written++;
next_cursor:
        ;
    }
    return written;
}"""
            % (
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
    return dl_collect_states(machine->active, machine->active_count, out, cap);
}"""
            % (
                self.symbol_prefix,
                self.symbol_prefix,
            )
        )
        lines.append("")
        lines.append(
            """size_t %s_collect_matched(
    const struct %s_machine *machine,
    struct devilang_active_state *out,
    size_t cap) {
    return dl_collect_states(machine->matched, machine->matched_count, out, cap);
}"""
            % (
                self.symbol_prefix,
                self.symbol_prefix,
            )
        )
        lines.append("")
        lines.append(
            """int %s_best_active(
    const struct %s_machine *machine,
    struct devilang_active_state *out) {
    struct devilang_active_state candidates[256];
    size_t count = %s_collect_active(machine, candidates, 256);
    size_t best = 0;

    if (!out || count == 0) {
        return -1;
    }

    for (size_t i = 1; i < count; ++i) {
        if (candidates[i].score > candidates[best].score) {
            best = i;
        }
    }

    *out = candidates[best];
    return 0;
}"""
            % (
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
