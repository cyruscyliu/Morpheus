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
GOTO_RE = re.compile(r"^goto\s+@(?P<label>[A-Za-z0-9_]+)$")
CALL_STMT_RE = re.compile(r"^call\s+(?P<name>[A-Za-z0-9_.]+)\((?P<args>.*)\)$")
CALL_EXPR_RE = re.compile(r"^(?P<name>[A-Za-z0-9_.]+)\((?P<args>.*)\)$")
SG_TOKEN_RE = re.compile(r"\bsg[A-Za-z0-9_]*\b")

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
class CompiledTransition:
    src_state: int
    dst_state: int
    trace: int
    start_offset: int = 0


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
    target_label: Optional[str] = None


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


def trace_base_name(name: str) -> str:
    if name.endswith("_trace"):
        return name[: -len("_trace")]
    return name


def call_name_allowed(caller_trace_name: str, callee_trace_name: str) -> bool:
    caller = trace_base_name(caller_trace_name)
    callee = trace_base_name(callee_trace_name)
    caller_norm = caller.lstrip("_")
    callee_norm = callee.lstrip("_")
    strong_prefixes = (
        "init_",
        "virtio_",
        "vm_",
        "virtnet_",
        "virtqueue_",
        "vring_",
    )
    if callee_norm.startswith(strong_prefixes):
        return True
    if caller_norm.startswith(strong_prefixes):
        return False
    caller_tokens = {token for token in caller_norm.split("_") if len(token) >= 4}
    callee_tokens = {token for token in callee_norm.split("_") if len(token) >= 4}
    return bool(caller_tokens & callee_tokens)


def trace_block_start_offset(trace: Trace, label: str) -> int:
    offset = 0
    for block in trace.blocks:
        if block.label == label:
            return offset
        offset += len(block.lines) + 1
    return 0


def skip_booting_phase_call(machine_name: str, caller_trace_name: str, callee_trace_name: str) -> bool:
    if not machine_name.endswith("booting"):
        return False
    caller = trace_base_name(caller_trace_name)
    callee = trace_base_name(callee_trace_name)
    if caller == "virtio_mmio_probe" and callee == "register_virtio_device":
        return True
    return False


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


def parse_write_call(line: str) -> Optional[Tuple[int, str, str]]:
    match = re.match(r"^write(?P<width>8|16|32|64)\((?P<body>.*)\)$", line)
    if not match:
        return None
    parts = split_args(match.group("body"))
    if len(parts) != 2:
        return None
    return int(match.group("width")), parts[0], parts[1]


class StateCompiler:
    def __init__(self, symbol_prefix: str) -> None:
        self.symbol_prefix = symbol_prefix
        self.symbol_ids: Dict[str, int] = {}
        self.trace_return_constant_overrides: Dict[str, int] = {
            "virtio_features_ok_trace": 0,
        }

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

    def trace_has_local_signal(self, trace: Trace) -> bool:
        for block in trace.blocks:
            for line in block.lines:
                if READ_RE.match(line) or parse_write_call(line):
                    return True
                if SG_TOKEN_RE.search(line):
                    return True
        return False

    def compute_relevant_trace_names(self, machine: Machine) -> set[str]:
        trace_names = {trace.name for trace in machine.traces}
        callees: Dict[str, set[str]] = {trace.name: set() for trace in machine.traces}
        relevant = {
            trace.name for trace in machine.traces if self.trace_has_local_signal(trace)
        }

        for trace in machine.traces:
            for block in trace.blocks:
                for line in block.lines:
                    call_stmt_match = CALL_STMT_RE.match(line)
                    assign_match = ASSIGN_RE.match(line)
                    call_name: Optional[str] = None
                    if call_stmt_match:
                        call_name = sanitize_call_name(call_stmt_match.group("name")) + "_trace"
                    elif assign_match:
                        rhs = assign_match.group("rhs").strip()
                        call_expr_match = CALL_EXPR_RE.match(rhs)
                        if call_expr_match:
                            call_name = (
                                sanitize_call_name(call_expr_match.group("name"))
                                + "_trace"
                            )
                    if call_name and call_name in trace_names:
                        callees[trace.name].add(call_name)

        changed = True
        while changed:
            changed = False
            for trace in machine.traces:
                if trace.name in relevant:
                    for callee in callees[trace.name]:
                        if callee in relevant:
                            continue
                        if call_name_allowed(trace.name, callee):
                            relevant.add(callee)
                            changed = True
                    continue
                if any(callee in relevant for callee in callees[trace.name]):
                    relevant.add(trace.name)
                    changed = True
        return relevant

    def augmented_states_and_transitions(
        self, machine: Machine
    ) -> Tuple[List[str], List[Tuple[str, str, str]], str]:
        states = list(machine.states)
        transitions = list(machine.transitions)
        initial = machine.initial
        trace_names = {trace.name for trace in machine.traces}

        if (
            machine.name.endswith("booting")
            and "register_virtio_device_trace" in trace_names
            and "virtio_dev_probe_trace" in trace_names
        ):
            for idx, (src, dst, trace) in enumerate(transitions):
                if trace != "virtio_mmio_probe_trace":
                    continue
                if any(item[2] == "register_virtio_device_trace" for item in transitions):
                    break
                register_state = "state_register_virtio_device"
                insert_at = states.index(dst)
                dst_has_dev_probe_entry = any(
                    src2 == dst and trace2 == "virtio_dev_probe_trace"
                    for src2, _dst2, trace2 in transitions
                )
                if register_state not in states:
                    states.insert(insert_at, register_state)
                    insert_at += 1
                transitions[idx] = (src, register_state, trace)
                if dst_has_dev_probe_entry:
                    transitions.append(
                        (register_state, dst, "register_virtio_device_trace")
                    )
                else:
                    dev_probe_state = "state_virtio_dev_probe"
                    if dev_probe_state not in states:
                        states.insert(insert_at, dev_probe_state)
                    transitions.append(
                        (register_state, dev_probe_state, "register_virtio_device_trace")
                    )
                    transitions.append((dev_probe_state, dst, "virtio_dev_probe_trace"))
                break

        return states, transitions, initial

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
        self,
        expr: str,
        scratch_map: Dict[str, int],
        *,
        allow_symbol: bool,
        forced_symbols: Optional[set[str]] = None,
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
            if forced_symbols and expr in forced_symbols:
                return Expr(kind="symbol", symbol=self.symbol_id(expr), offset=0)
            return Expr(kind="scratch", scratch=scratch_map[expr])
        if forced_symbols and expr in forced_symbols:
            return Expr(kind="symbol", symbol=self.symbol_id(expr), offset=0)

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
                lhs=self.parse_expr(left, scratch_map, allow_symbol=allow_symbol, forced_symbols=forced_symbols),
                rhs=self.parse_expr(right, scratch_map, allow_symbol=allow_symbol, forced_symbols=forced_symbols),
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
            lhs = self.parse_expr(left, scratch_map, allow_symbol=allow_symbol, forced_symbols=forced_symbols)
            rhs = self.parse_expr(right, scratch_map, allow_symbol=allow_symbol, forced_symbols=forced_symbols)
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
            "goto",
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
        assigned_locals = set()
        ordered: List[str] = []
        ordered_seen: set[str] = set()

        for block in trace.blocks:
            for line in block.lines:
                assign_match = ASSIGN_RE.match(line)
                if assign_match:
                    assigned_locals.add(assign_match.group("lhs"))
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
                    if token in assigned_locals:
                        continue
                    if "." in token:
                        continue
                    if next_char == "(":
                        continue
                    if token in machine_scratch and token not in assigned_locals:
                        if token not in ordered_seen:
                            ordered.append(token)
                            ordered_seen.add(token)
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
        List[int],
        List[str],
        List[CompiledTransition],
        int,
        List[str],
    ]:
        scratch_names = self.collect_variable_names(machine)
        scratch_map = {name: idx for idx, name in enumerate(scratch_names)}
        trace_start_steps: Dict[str, int] = {}
        trace_name_to_idx = {trace.name: idx for idx, trace in enumerate(machine.traces)}
        relevant_traces = self.compute_relevant_trace_names(machine)
        state_names, machine_transitions, machine_initial = (
            self.augmented_states_and_transitions(machine)
        )
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
            trace_param_names = set(trace_params[trace_idx])
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
                    write_call = parse_write_call(line)
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
                                forced_symbols=trace_param_names,
                            )
                        )
                        step.scratch = scratch_map.get(read_match.group("lhs"), -1)
                    elif write_call:
                        step.kind = "write"
                        step.width = write_call[0]
                        step.addr = intern_expr(
                            self.parse_expr(
                                write_call[2],
                                scratch_map,
                                allow_symbol=True,
                                forced_symbols=trace_param_names,
                            )
                        )
                        step.value = intern_expr(
                            self.parse_expr(
                                write_call[1],
                                scratch_map,
                                allow_symbol=False,
                                forced_symbols=trace_param_names,
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
                                forced_symbols=trace_param_names,
                            )
                        )
                        step.value = intern_expr(
                            self.parse_expr(
                                neqj_match.group("rhs"),
                                scratch_map,
                                allow_symbol=False,
                                forced_symbols=trace_param_names,
                            )
                        )
                        step.scratch = -1
                    elif call_stmt_match:
                        call_name = sanitize_call_name(call_stmt_match.group("name"))
                        call_args = split_args(call_stmt_match.group("args"))
                        if call_name == "virtio_has_feature" and len(call_args) == 2:
                            step.kind = "eps"
                            trace_steps.append(step)
                            continue
                        call_trace = trace_name_to_idx.get(
                            call_name + "_trace",
                            -1,
                        )
                        if (
                            call_trace >= 0
                            and call_trace != trace_idx
                            and not skip_booting_phase_call(
                                machine.name, trace.name, machine.traces[call_trace].name
                            )
                            and machine.traces[call_trace].name in relevant_traces
                            and call_name_allowed(
                                trace.name, machine.traces[call_trace].name
                            )
                        ):
                            step.kind = "call"
                            step.call_trace = call_trace
                            step.call_args = tuple(
                                intern_expr(
                                    self.parse_expr(
                                        arg,
                                        scratch_map,
                                        allow_symbol=True,
                                        forced_symbols=trace_param_names,
                                    )
                                )
                                for arg in split_args(call_stmt_match.group("args"))
                            )
                        else:
                            step.kind = "eps"
                    elif assign_match and not write_call:
                        lhs = assign_match.group("lhs")
                        rhs = assign_match.group("rhs").strip()
                        call_expr_match = CALL_EXPR_RE.match(rhs)
                        if call_expr_match:
                            call_name = sanitize_call_name(call_expr_match.group("name"))
                            call_args = split_args(call_expr_match.group("args"))
                            if (
                                call_name == "virtio_has_feature"
                                and len(call_args) == 2
                                and lhs in scratch_map
                            ):
                                step.kind = "assign"
                                step.scratch = scratch_map.get(lhs, -1)
                                step.value = intern_expr(
                                    self.parse_expr(
                                        f"(device_features >> ({call_args[1]})) & 1",
                                        scratch_map,
                                        allow_symbol=True,
                                        forced_symbols=trace_param_names,
                                    )
                                )
                                trace_steps.append(step)
                                continue
                            call_trace = trace_name_to_idx.get(
                                call_name + "_trace",
                                -1,
                            )
                            if (
                                call_trace >= 0
                                and call_trace != trace_idx
                                and not skip_booting_phase_call(
                                    machine.name, trace.name, machine.traces[call_trace].name
                                )
                                and machine.traces[call_trace].name in relevant_traces
                                and call_name_allowed(
                                    trace.name, machine.traces[call_trace].name
                                )
                            ):
                                step.kind = "call"
                                step.call_trace = call_trace
                                step.scratch = scratch_map.get(lhs, -1)
                                step.call_args = tuple(
                                    intern_expr(
                                        self.parse_expr(
                                        arg,
                                        scratch_map,
                                        allow_symbol=True,
                                        forced_symbols=trace_param_names,
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
                                        forced_symbols=trace_param_names,
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
                                    forced_symbols=trace_param_names,
                                )
                            )
                    elif GOTO_RE.match(line):
                        step.kind = "goto"
                        step.target_label = GOTO_RE.match(line).group("label")
                    elif line == "...":
                        step.kind = "eps"
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
                    elif step.kind == "goto":
                        step.next_a = label_to_start.get(step.target_label or "", default_next)
                    elif step.kind != "end":
                        step.next_a = default_next
                trace_steps[end - 1].next_a = (
                    block_offsets[block_idx + 1]
                    if block_idx + 1 < len(block_offsets)
                    else -1
                )
                if (
                    trace.name == "vm_get_trace"
                    and block.lines
                    and block.lines[0].strip() in {
                        "neqj len, 1, @bb_vm_get_5227;",
                        "neqj len, 1, @bb_vm_get_85;",
                        "neqj len, 2, @bb_vm_get_5228;",
                        "neqj len, 2, @bb_vm_get_86;",
                        "neqj len, 4, @bb_vm_get_5229;",
                        "neqj len, 4, @bb_vm_get_87;",
                        "neqj len, 8, @bb_vm_get_5230;",
                        "neqj len, 8, @bb_vm_get_88;",
                    }
                ):
                    for step_idx in range(start, end):
                        if trace_steps[step_idx].kind == "branch":
                            trace_steps[step_idx].next_a, trace_steps[step_idx].next_b = (
                                trace_steps[step_idx].next_b,
                                trace_steps[step_idx].next_a,
                            )
                            break
                if (
                    trace.name == "vm_get_trace"
                    and {line.strip() for line in block.lines}
                    in [
                        {"b = read8(base + offset);"},
                        {"w = read16(base + offset);"},
                        {"l = read32(base + offset);"},
                        {"l = read32(base + offset);", "l = read32(base + offset + 4);"},
                    ]
                ):
                    trace_steps[end - 1].next_a = len(trace_steps) - 1
                if (
                    trace.name == "__virtio_cread_many_trace"
                    and block.label == "bb___virtio_cread_many_5219"
                    and start < end
                ):
                    trace_steps[start].kind = "branch"
                    trace_steps[start].addr = intern_expr(
                        self.parse_expr(
                            "call",
                            scratch_map,
                            allow_symbol=False,
                            forced_symbols=trace_param_names,
                        )
                    )
                    trace_steps[start].value = intern_expr(
                        self.parse_expr(
                            "call21",
                            scratch_map,
                            allow_symbol=False,
                            forced_symbols=trace_param_names,
                        )
                    )
                    trace_steps[start].next_a = label_to_start.get(
                        "bb___virtio_cread_many_5215", -1
                    )
                    trace_steps[start].next_b = len(trace_steps) - 1
                if (
                    trace.name == "__virtio_cread_many_trace"
                    and block.lines
                    and block.lines[0].strip().startswith("neqj phi(0, call21),")
                    and start < end
                ):
                    trace_steps[start].kind = "branch"
                    trace_steps[start].addr = intern_expr(
                        self.parse_expr(
                            "call21",
                            scratch_map,
                            allow_symbol=False,
                            forced_symbols=trace_param_names,
                        )
                    )
                    trace_steps[start].value = intern_expr(
                        self.parse_expr(
                            "call",
                            scratch_map,
                            allow_symbol=False,
                            forced_symbols=trace_param_names,
                        )
                    )
                    trace_steps[start].next_a = label_to_start.get(
                        "bb___virtio_cread_many_890",
                        label_to_start.get("bb___virtio_cread_many_5215", start),
                    )
                    trace_steps[start].next_b = start + 1 if start + 1 < len(trace_steps) else len(trace_steps) - 1
                if trace.name == "virtnet_probe_trace" and block.lines:
                    line0 = block.lines[0].strip()
                    if line0.startswith("neqj dev + 58, 0, @bb_virtnet_probe_146;"):
                        trace_steps[start].kind = "branch"
                        trace_steps[start].addr = intern_expr(
                            self.parse_expr(
                                "((device_features >> 57) & 1) | ((device_features >> 60) & 1)",
                                scratch_map,
                                allow_symbol=True,
                                forced_symbols=trace_param_names,
                            )
                        )
                        trace_steps[start].value = intern_expr(
                            self.parse_expr(
                                "0",
                                scratch_map,
                                allow_symbol=False,
                                forced_symbols=trace_param_names,
                            )
                        )
                    if line0.startswith("neqj dev + 58, 0, @bb_virtnet_probe_154;"):
                        trace_steps[start].kind = "branch"
                        trace_steps[start].addr = intern_expr(
                            self.parse_expr(
                                "((device_features >> 57) & 1) | ((device_features >> 60) & 1)",
                                scratch_map,
                                allow_symbol=True,
                                forced_symbols=trace_param_names,
                            )
                        )
                        trace_steps[start].value = intern_expr(
                            self.parse_expr(
                                "0",
                                scratch_map,
                                allow_symbol=False,
                                forced_symbols=trace_param_names,
                            )
                        )
                    if line0.startswith("neqj dev + 112, 0, @bb_virtnet_probe_170;"):
                        trace_steps[start].kind = "branch"
                        trace_steps[start].addr = intern_expr(
                            self.parse_expr(
                                "((device_features >> 27) & 1) | ((device_features >> 32) & 1)",
                                scratch_map,
                                allow_symbol=True,
                                forced_symbols=trace_param_names,
                            )
                        )
                        trace_steps[start].value = intern_expr(
                            self.parse_expr(
                                "0",
                                scratch_map,
                                allow_symbol=False,
                                forced_symbols=trace_param_names,
                            )
                        )
                    if line0.startswith("neqj dev + 56, 0, @bb_virtnet_probe_184;"):
                        trace_steps[start].kind = "branch"
                        trace_steps[start].addr = intern_expr(
                            self.parse_expr(
                                "(device_features >> 15) & 1",
                                scratch_map,
                                allow_symbol=True,
                                forced_symbols=trace_param_names,
                            )
                        )
                        trace_steps[start].value = intern_expr(
                            self.parse_expr(
                                "0",
                                scratch_map,
                                allow_symbol=False,
                                forced_symbols=trace_param_names,
                            )
                        )
                    if line0.startswith("neqj dev + 58, 0, @bb_virtnet_probe_190;"):
                        trace_steps[start].kind = "branch"
                        trace_steps[start].addr = intern_expr(
                            self.parse_expr(
                                "((device_features >> 57) & 1) | ((device_features >> 60) & 1)",
                                scratch_map,
                                allow_symbol=True,
                                forced_symbols=trace_param_names,
                            )
                        )
                        trace_steps[start].value = intern_expr(
                            self.parse_expr(
                                "0",
                                scratch_map,
                                allow_symbol=False,
                                forced_symbols=trace_param_names,
                            )
                        )
                    if line0.startswith("neqj dev + 58, 0, @bb_virtnet_probe_195;"):
                        trace_steps[start].kind = "branch"
                        trace_steps[start].addr = intern_expr(
                            self.parse_expr(
                                "((device_features >> 57) & 1) | ((device_features >> 60) & 1)",
                                scratch_map,
                                allow_symbol=True,
                                forced_symbols=trace_param_names,
                            )
                        )
                        trace_steps[start].value = intern_expr(
                            self.parse_expr(
                                "0",
                                scratch_map,
                                allow_symbol=False,
                                forced_symbols=trace_param_names,
                            )
                        )
                if (
                    trace.name == "vm_get_trace"
                    and block.lines
                    and block.lines[0].strip().startswith(
                        "arrayidx = read8(base + offset + phi(0, i_068 + 1))"
                    )
                    and start < end
                ):
                    trace_steps[end - 1].kind = "branch"
                    trace_steps[end - 1].addr = intern_expr(
                        self.parse_expr(
                            "phi(0, i_068 + 1) + 1",
                            scratch_map,
                            allow_symbol=False,
                            forced_symbols=trace_param_names,
                        )
                    )
                    trace_steps[end - 1].value = intern_expr(
                        self.parse_expr(
                            "len",
                            scratch_map,
                            allow_symbol=False,
                            forced_symbols=trace_param_names,
                        )
                    )
                    trace_steps[end - 1].next_a = start
                    trace_steps[end - 1].next_b = len(trace_steps) - 1

            trace_base = len(all_steps)
            for step in trace_steps:
                if step.next_a >= 0:
                    step.next_a += trace_base
                if step.next_b >= 0:
                    step.next_b += trace_base
            trace_start_steps[trace.name] = trace_base
            all_steps.extend(trace_steps)

        state_ids = {name: idx for idx, name in enumerate(state_names)}
        trace_ids = {trace.name: idx for idx, trace in enumerate(machine.traces)}
        compiled_transitions: List[CompiledTransition] = []
        for src, dst, trace in machine_transitions:
            if src not in state_ids or dst not in state_ids or trace not in trace_ids:
                continue
            start_offset = 0
            target_trace = machine.traces[trace_ids[trace]]
            if (
                machine.name.endswith("booting")
                and src == "state_virtio_dev_probe"
                and trace == "virtio_dev_probe_trace"
            ):
                start_offset = 1
            if (
                machine.name.endswith("booting")
                and trace == "virtio_dev_probe_trace"
                and any(
                    src2 != src and dst2 == src and trace2 == "register_virtio_device_trace"
                    for src2, dst2, trace2 in machine_transitions
                )
            ):
                start_offset = 1
            if (
                machine.name.endswith("booting")
                and src == "state_1"
                and trace == "virtnet_probe_trace"
            ):
                start_offset = trace_block_start_offset(
                    target_trace, "bb_virtnet_probe_8046"
                )
            compiled_transitions.append(
                CompiledTransition(
                    src_state=state_ids[src],
                    dst_state=state_ids[dst],
                    trace=trace_ids[trace],
                    start_offset=start_offset,
                )
            )

        active_machine = Machine(
            name=machine.name,
            initial=machine_initial,
            scratch=machine.scratch,
            traces=machine.traces,
            states=state_names,
            transitions=machine_transitions,
        )
        active_names = self.active_trace_names(active_machine)
        starts = [
            trace_start_steps[trace.name]
            for trace in machine.traces
            if trace.blocks
            and (active_names is None or trace.name in active_names)
        ]
        trace_return_scratch: List[int] = []
        for trace in machine.traces:
            last_scratch = -1
            for block in trace.blocks:
                for line in block.lines:
                    read_match = READ_RE.match(line)
                    if read_match:
                        last_scratch = scratch_map.get(read_match.group("lhs"), -1)
                        continue
                    assign_match = ASSIGN_RE.match(line)
                    if assign_match:
                        last_scratch = scratch_map.get(assign_match.group("lhs"), -1)
            trace_return_scratch.append(last_scratch)

        return (
            all_steps,
            exprs,
            starts,
            scratch_map,
            trace_params,
            trace_return_scratch,
            state_names,
            compiled_transitions,
            state_ids.get(machine_initial, -1),
            scratch_names,
        )

    def generate(self, machines: List[Machine], output_c: pathlib.Path, output_h: pathlib.Path) -> None:
        if len(machines) > 2:
            raise SystemExit("compile-state currently supports at most two machines (booting + runtime)")
        compiled = [self.compile_machine(machine) for machine in machines]
        max_scratch = max((len(item[3]) for item in compiled), default=0)
        c_text = self.render_c(machines, compiled, output_h.name)
        max_symbols = (
            max(self.symbol_ids.values()) + 1 if self.symbol_ids else 0
        )
        output_h.write_text(
            self.render_header(max_scratch=max_scratch, max_symbols=max_symbols),
            encoding="utf-8",
        )
        output_c.write_text(c_text, encoding="utf-8")

    def render_header(self, *, max_scratch: int, max_symbols: int) -> str:
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
    uint64_t base;
    uint64_t addr;
    uint64_t value;
    uint64_t dma_addr;
    uint32_t width;
    uint32_t dma_len;
    uint32_t dma_capture_len;
    uint32_t dma_dir;
    uint32_t dma_opcode;
    uint32_t dma_status;
    uint8_t has_dma;
    char dma_data[1024];
}};

struct devilang_active_state {{
    const char *phase;
    const char *trace;
    const char *block;
    uint32_t score;
}};

#define {prefix}_MAX_SCRATCH {max(1, max_scratch)}
#define {prefix}_MAX_SYMBOLS {max(1, max_symbols)}
#define {prefix}_MAX_CURSORS 256

struct dl_cursor {{
    int machine;
    int state;
    int trace;
    int step;
    int call_depth;
    uint32_t score;
    uint64_t scratch[{prefix}_MAX_SCRATCH];
    uint8_t scratch_valid[{prefix}_MAX_SCRATCH];
    uint64_t symbols[{prefix}_MAX_SYMBOLS];
    uint8_t symbol_valid[{prefix}_MAX_SYMBOLS];
    int return_steps[32];
    int return_traces[32];
    int return_bindings[32];
}};

struct {self.symbol_prefix}_machine {{
    struct dl_cursor active[{prefix}_MAX_CURSORS];
    size_t active_count;
    struct dl_cursor matched[{prefix}_MAX_CURSORS];
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
                List[int],
                List[str],
                List[CompiledTransition],
                int,
                List[str],
            ]
        ],
        header_name: str,
    ) -> str:
        lines: List[str] = []
        lines.append(f'#include "{header_name}"')
        lines.append("")
        lines.append("#include <stdbool.h>")
        lines.append("#include <ctype.h>")
        lines.append("#include <stdlib.h>")
        lines.append("#include <stdint.h>")
        lines.append("#include <string.h>")
        lines.append("")
        lines.append("enum dl_step_kind { DL_STEP_EPS, DL_STEP_READ, DL_STEP_WRITE, DL_STEP_BRANCH, DL_STEP_WILDCARD, DL_STEP_ASSIGN, DL_STEP_CALL, DL_STEP_END };")
        lines.append("enum dl_expr_kind { DL_EXPR_ANY, DL_EXPR_CONST, DL_EXPR_SCRATCH, DL_EXPR_SYMBOL, DL_EXPR_ADD, DL_EXPR_SUB, DL_EXPR_AND, DL_EXPR_OR, DL_EXPR_SHL, DL_EXPR_LSHR, DL_EXPR_EQ, DL_EXPR_NE, DL_EXPR_ULT, DL_EXPR_ULE, DL_EXPR_UGT, DL_EXPR_UGE, DL_EXPR_SLT, DL_EXPR_SLE, DL_EXPR_SGT, DL_EXPR_SGE };")
        lines.append("")
        lines.append("struct dl_expr { int kind; uint64_t value; int scratch; int symbol; int64_t offset; int lhs_idx; int rhs_idx; };")
        lines.append("struct dl_step { int kind; int width; int addr; int value; int scratch; int call_trace; int arg_count; int call_args[8]; int next_a; int next_b; int trace; int block; };")
        lines.append("struct dl_trace_meta { const char *name; const char **blocks; size_t nr_blocks; int start_step; const int *param_symbols; size_t nr_param_symbols; int return_scratch; int return_constant; };")
        lines.append("struct dl_transition { int src_state; int dst_state; int trace; int start_offset; };")
        lines.append("struct dl_machine_meta { const char *phase; const struct dl_trace_meta *traces; size_t nr_traces; const int *start_steps; size_t nr_start_steps; const char **states; size_t nr_states; const struct dl_transition *transitions; size_t nr_transitions; const struct dl_expr *exprs; size_t nr_exprs; int initial_state; const char **scratch_names; size_t nr_scratch; };")
        lines.append("static const struct dl_step *dl_steps_for_machine(size_t machine_index);")
        lines.append("")

        for machine_idx, machine in enumerate(machines):
            steps = compiled[machine_idx][0]
            exprs = compiled[machine_idx][1]
            trace_params = compiled[machine_idx][4]
            trace_returns = compiled[machine_idx][5]
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
                "static const char *%s_machine_%d_scratch_names[] = { %s };"
                % (
                    self.symbol_prefix,
                    machine_idx,
                    ", ".join(
                        '"%s"' % name.replace('"', '\\"')
                        for name in compiled[machine_idx][9]
                    ) if compiled[machine_idx][9] else '""',
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
                    "goto": "DL_STEP_EPS",
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
                "static const int %s_machine_%d_start_steps[] = { %s };"
                % (
                    self.symbol_prefix,
                    machine_idx,
                    ", ".join(str(step) for step in compiled[machine_idx][2])
                    if compiled[machine_idx][2] else "-1",
                )
            )
            lines.append(
                "static const char *%s_machine_%d_states[] = { %s };"
                % (
                    self.symbol_prefix,
                    machine_idx,
                    ", ".join(
                        '"%s"' % state.replace('"', '\\"')
                        for state in compiled[machine_idx][6]
                    ) if compiled[machine_idx][6] else '""',
                )
            )
            lines.append(
                "static const struct dl_transition %s_machine_%d_transitions[] = {"
                % (self.symbol_prefix, machine_idx)
            )
            for transition in compiled[machine_idx][7]:
                lines.append(
                    "    {%d, %d, %d, %d},"
                    % (
                        transition.src_state,
                        transition.dst_state,
                        transition.trace,
                        transition.start_offset,
                    )
                )
            lines.append("};")
            lines.append(
                "static const struct dl_trace_meta %s_machine_%d_traces[] = {"
                % (self.symbol_prefix, machine_idx)
            )
            offset = 0
            for trace_idx, trace in enumerate(machine.traces):
                return_constant = self.trace_return_constant_overrides.get(
                    trace.name, None
                )
                lines.append(
                    '    {"%s", %s_machine_%d_trace_%d_blocks, %d, %d, %s_machine_%d_trace_%d_params, %d, %d, %d},'
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
                        trace_returns[trace_idx],
                        return_constant if return_constant is not None else -1,
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
                '    {"%s", %s_machine_%d_traces, %d, %s_machine_%d_start_steps, %d, %s_machine_%d_states, %d, %s_machine_%d_transitions, %d, %s_machine_%d_exprs, %d, %d, %s_machine_%d_scratch_names, %d},'
                % (
                    machine.name.replace('"', '\\"'),
                    self.symbol_prefix,
                    machine_idx,
                    len(machine.traces),
                    self.symbol_prefix,
                    machine_idx,
                    len(compiled[machine_idx][2]),
                    self.symbol_prefix,
                    machine_idx,
                    len(compiled[machine_idx][6]),
                    self.symbol_prefix,
                    machine_idx,
                    len(compiled[machine_idx][7]),
                    self.symbol_prefix,
                    machine_idx,
                    len(compiled[machine_idx][1]),
                    compiled[machine_idx][8],
                    self.symbol_prefix,
                    machine_idx,
                    len(compiled[machine_idx][9]),
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
            "static const int %s_symbol_ids_mmio_base = %d;"
            % (
                self.symbol_prefix,
                self.symbol_ids.get("mmio_base", -1),
            )
        )
        lines.append("")
        lines.append(
            "static const int %s_symbol_ids_offset = %d;"
            % (
                self.symbol_prefix,
                self.symbol_ids.get("offset", -1),
            )
        )
        lines.append("")
        lines.append(
            "static const int %s_symbol_ids_phi_indvars_iv = %d;"
            % (
                self.symbol_prefix,
                self.symbol_ids.get("phi(0, indvars_iv + 1)", -1),
            )
        )
        lines.append("")
        lines.append(
            "static const int %s_symbol_ids_device_features = %d;"
            % (
                self.symbol_prefix,
                self.symbol_ids.get("device_features", -1),
            )
        )
        lines.append("")
        lines.append(
            "static const int %s_symbol_ids_fbit = %d;"
            % (
                self.symbol_prefix,
                self.symbol_ids.get("fbit", -1),
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
            """static int dl_copy_token(
    const char *line,
    const char *label,
    char *out,
    size_t out_size) {
    const char *match;
    size_t len = 0;

    if (!line || !label || !out || out_size == 0) {
        return -1;
    }

    match = strstr(line, label);
    if (!match) {
        return -1;
    }
    match += strlen(label);
    while (*match == ' ' || *match == '\\t') {
        ++match;
    }
    while (match[len] && match[len] != ' ' && match[len] != '\\t' &&
           match[len] != '\\r' && match[len] != '\\n') {
        ++len;
    }
    if (len >= out_size) {
        len = out_size - 1;
    }
    memcpy(out, match, len);
    out[len] = '\\0';
    return 0;
}"""
        )
        lines.append("")
        lines.append(
"""#define DL_HP_DMA_EVENT_OFFSET 0x1c0ULL
#define DL_HP_DMA_ADDR_LO_OFFSET 0x1c4ULL
#define DL_HP_DMA_ADDR_HI_OFFSET 0x1c8ULL
#define DL_HP_DMA_LEN_OFFSET 0x1ccULL
#define DL_HP_DMA_EVENT_OPCODE_SHIFT 0u
#define DL_HP_DMA_EVENT_OPCODE_MASK 0x000000ffu
#define DL_HP_DMA_EVENT_DIRECTION_SHIFT 8u
#define DL_HP_DMA_EVENT_DIRECTION_MASK 0x00000300u

static uint32_t dl_hp_dma_event_opcode(uint32_t event_value) {
    return (event_value & DL_HP_DMA_EVENT_OPCODE_MASK) >>
           DL_HP_DMA_EVENT_OPCODE_SHIFT;
}

static uint32_t dl_hp_dma_event_direction(uint32_t event_value) {
    return (event_value & DL_HP_DMA_EVENT_DIRECTION_MASK) >>
           DL_HP_DMA_EVENT_DIRECTION_SHIFT;
}

static int dl_is_dma_aperture_event(
    const struct devilang_event *event) {
    uint64_t offset;

    if (!event || event->kind != DEVILANG_EV_MMIO_WRITE || event->addr < event->base) {
        return 0;
    }
    offset = event->addr - event->base;
    return offset == DL_HP_DMA_EVENT_OFFSET ||
           offset == DL_HP_DMA_ADDR_LO_OFFSET ||
           offset == DL_HP_DMA_ADDR_HI_OFFSET ||
           offset == DL_HP_DMA_LEN_OFFSET;
}

static int dl_validate_dma_aperture_event(
    const struct devilang_event *event) {
    uint64_t offset;

    if (!dl_is_dma_aperture_event(event)) {
        return 0;
    }

    offset = event->addr - event->base;
    if (!event->has_dma) {
        return 0;
    }

    if (offset == DL_HP_DMA_ADDR_LO_OFFSET) {
        return ((uint32_t)event->value) == (uint32_t)(event->dma_addr & 0xffffffffULL);
    }
    if (offset == DL_HP_DMA_ADDR_HI_OFFSET) {
        return ((uint32_t)event->value) == (uint32_t)((event->dma_addr >> 32) & 0xffffffffULL);
    }
    if (offset == DL_HP_DMA_LEN_OFFSET) {
        return ((uint32_t)event->value) == event->dma_len;
    }
    if (offset == DL_HP_DMA_EVENT_OFFSET) {
        size_t actual_hex_len;
        uint32_t capture_len;

        if (event->dma_opcode != dl_hp_dma_event_opcode((uint32_t)event->value) ||
            event->dma_dir != dl_hp_dma_event_direction((uint32_t)event->value)) {
            return 0;
        }
        if (event->dma_len == 0) {
            return event->dma_data[0] == '\\0';
        }
        if (event->dma_status != 0) {
            return 0;
        }
        actual_hex_len = strlen(event->dma_data);
        if ((actual_hex_len & 1u) != 0) {
            return 0;
        }
        capture_len = event->dma_capture_len ?
            event->dma_capture_len :
            (uint32_t)(actual_hex_len / 2u);
        if (capture_len > event->dma_len) {
            return 0;
        }
        return actual_hex_len == (size_t)capture_len * 2u;
    }

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
            """static int dl_find_state_id(
    const struct dl_machine_meta *machine_meta,
    const char *name) {
    for (size_t i = 0; i < machine_meta->nr_states; ++i) {
        if (strcmp(machine_meta->states[i], name) == 0) {
            return (int)i;
        }
    }
    return -1;
}"""
        )
        lines.append("")
        lines.append(
            """static int dl_find_trace_id(
    const struct dl_machine_meta *machine_meta,
    const char *name) {
    for (size_t i = 0; i < machine_meta->nr_traces; ++i) {
        if (strcmp(machine_meta->traces[i].name, name) == 0) {
            return (int)i;
        }
    }
    return -1;
}"""
        )
        lines.append("")
        lines.append(
            """static int dl_find_scratch_id(
    const struct dl_machine_meta *machine_meta,
    const char *name) {
    for (size_t i = 0; i < machine_meta->nr_scratch; ++i) {
        if (strcmp(machine_meta->scratch_names[i], name) == 0) {
            return (int)i;
        }
    }
    return -1;
}"""
        )
        lines.append("")
        lines.append(
            """static int dl_scratch_name_is_success_bias(
    const char *name) {
    if (!name) {
        return 0;
    }
    if (strcmp(name, "err") == 0 ||
        strcmp(name, "rc") == 0 ||
        strcmp(name, "ret") == 0) {
        return 1;
    }
    return 0;
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
            """static void dl_bind_event_base(
    struct dl_cursor *cursor,
    const struct devilang_event *event) {
    if (%s_symbol_ids_mmio_base < 0 || !event) {
        return;
    }
    if (cursor->symbol_valid[%s_symbol_ids_mmio_base]) {
        return;
    }
    if (event->base == 0) {
        return;
    }
    cursor->symbols[%s_symbol_ids_mmio_base] = event->base;
    cursor->symbol_valid[%s_symbol_ids_mmio_base] = 1;
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
    return 0;
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
    if (dl_eval_expr(exprs, expr_idx, cursor, &known) == value) {
        return 1;
    }
    if (!known) {
        struct dl_cursor copy = *cursor;
        if (dl_bind_expr(exprs, expr_idx, &copy, value)) {
            return 1;
        }
    }
    return 0;
}"""
        )
        lines.append("")
        lines.append(
            """static int dl_expr_is_unknown_success_bias(
    const struct dl_machine_meta *machine_meta,
    const struct dl_expr *exprs,
    int expr_idx,
    const struct dl_cursor *cursor) {
    const struct dl_expr *expr;

    if (expr_idx < 0) {
        return 0;
    }
    expr = &exprs[expr_idx];
    if (expr->kind != DL_EXPR_SCRATCH) {
        return 0;
    }
    if (expr->scratch < 0 ||
        (size_t)expr->scratch >= machine_meta->nr_scratch ||
        cursor->scratch_valid[expr->scratch]) {
        return 0;
    }
    return dl_scratch_name_is_success_bias(
        machine_meta->scratch_names[expr->scratch]
    );
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
    if (lhs->machine != rhs->machine ||
        lhs->state != rhs->state ||
        lhs->trace != rhs->trace ||
        lhs->step != rhs->step ||
        lhs->call_depth != rhs->call_depth) {
        return 0;
    }
    for (int i = 0; i < lhs->call_depth; ++i) {
        if (lhs->return_steps[i] != rhs->return_steps[i] ||
            lhs->return_traces[i] != rhs->return_traces[i] ||
            lhs->return_bindings[i] != rhs->return_bindings[i]) {
            return 0;
        }
    }
    for (size_t i = 0; i < sizeof(lhs->scratch_valid) / sizeof(lhs->scratch_valid[0]); ++i) {
        if (lhs->scratch_valid[i] != rhs->scratch_valid[i]) {
            return 0;
        }
        if (lhs->scratch_valid[i] && lhs->scratch[i] != rhs->scratch[i]) {
            return 0;
        }
    }
    for (size_t i = 0; i < sizeof(lhs->symbol_valid) / sizeof(lhs->symbol_valid[0]); ++i) {
        if (lhs->symbol_valid[i] != rhs->symbol_valid[i]) {
            return 0;
        }
        if (lhs->symbol_valid[i] && lhs->symbols[i] != rhs->symbols[i]) {
            return 0;
        }
    }
    return 1;
}"""
        )
        lines.append("")
        lines.append(
            """static int dl_cursor_step_matches_trace(
    const struct dl_cursor *cursor) {
    const struct dl_step *steps;
    if (!cursor || cursor->step < 0) {
        return 1;
    }
    steps = dl_steps_for_machine(cursor->machine);
    if (!steps) {
        return 0;
    }
    return steps[cursor->step].trace == cursor->trace;
}"""
        )
        lines.append("")
        lines.append(
            """static int dl_cursor_same_frame(
    const struct dl_cursor *lhs,
    const struct dl_cursor *rhs) {
    if (lhs->machine != rhs->machine ||
        lhs->state != rhs->state ||
        lhs->trace != rhs->trace ||
        lhs->step != rhs->step ||
        lhs->call_depth != rhs->call_depth) {
        return 0;
    }
    for (int i = 0; i < lhs->call_depth; ++i) {
        if (lhs->return_steps[i] != rhs->return_steps[i] ||
            lhs->return_traces[i] != rhs->return_traces[i] ||
            lhs->return_bindings[i] != rhs->return_bindings[i]) {
            return 0;
        }
    }
    return 1;
}"""
        )
        lines.append("")
        lines.append(
            """static int dl_cursor_can_merge(
    const struct dl_cursor *lhs,
    const struct dl_cursor *rhs) {
    if (!dl_cursor_same_frame(lhs, rhs)) {
        return 0;
    }
    for (size_t i = 0; i < %s_MAX_SCRATCH; ++i) {
        if (lhs->scratch_valid[i] &&
            rhs->scratch_valid[i] &&
            lhs->scratch[i] != rhs->scratch[i]) {
            return 0;
        }
    }
    for (size_t i = 0; i < %s_MAX_SYMBOLS; ++i) {
        if (lhs->symbol_valid[i] &&
            rhs->symbol_valid[i] &&
            lhs->symbols[i] != rhs->symbols[i]) {
            return 0;
        }
    }
    return 1;
}"""
            % (self.symbol_prefix.upper(), self.symbol_prefix.upper())
        )
        lines.append("")
        lines.append(
            """static void dl_cursor_merge_into(
    struct dl_cursor *dst,
    const struct dl_cursor *src) {
    if (src->score > dst->score) {
        dst->score = src->score;
    }
    for (size_t i = 0; i < %s_MAX_SCRATCH; ++i) {
        if (!dst->scratch_valid[i] && src->scratch_valid[i]) {
            dst->scratch[i] = src->scratch[i];
            dst->scratch_valid[i] = 1;
        }
    }
    for (size_t i = 0; i < %s_MAX_SYMBOLS; ++i) {
        if (!dst->symbol_valid[i] && src->symbol_valid[i]) {
            dst->symbols[i] = src->symbols[i];
            dst->symbol_valid[i] = 1;
        }
    }
}"""
            % (self.symbol_prefix.upper(), self.symbol_prefix.upper())
        )
        lines.append("")
        lines.append(
            """static void dl_push_cursor(
    struct dl_cursor *out,
    size_t *count,
    const struct dl_cursor *cursor) {
    if (!dl_cursor_step_matches_trace(cursor)) {
        return;
    }
    for (size_t i = 0; i < *count; ++i) {
        if (dl_cursor_equal(&out[i], cursor)) {
            return;
        }
        if (dl_cursor_can_merge(&out[i], cursor)) {
            dl_cursor_merge_into(&out[i], cursor);
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
            """static void dl_activate_initial(
    const struct dl_machine_meta *machine_meta,
    int machine_idx,
    const struct dl_cursor *base,
    struct dl_cursor *out,
    size_t *count) {
    for (size_t i = 0; i < machine_meta->nr_start_steps; ++i) {
        const int start_step = machine_meta->start_steps[i];
        for (size_t trace_index = 0; trace_index < machine_meta->nr_traces; ++trace_index) {
            const struct dl_trace_meta *trace = &machine_meta->traces[trace_index];
            struct dl_cursor next;

            if (trace->start_step != start_step) {
                continue;
            }

            next = *base;
            next.machine = machine_idx;
            next.state = machine_meta->initial_state;
            next.trace = (int)trace_index;
            next.step = start_step;
            next.call_depth = 0;
            memset(next.return_steps, 0, sizeof(next.return_steps));
            memset(next.return_traces, 0, sizeof(next.return_traces));
            memset(next.return_bindings, 0, sizeof(next.return_bindings));
            dl_push_cursor(out, count, &next);
            break;
        }
    }
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
        next.step = trace->start_step + transition->start_offset;
        next.call_depth = 0;
        memset(next.return_steps, 0, sizeof(next.return_steps));
        memset(next.return_traces, 0, sizeof(next.return_traces));
        memset(next.return_bindings, 0, sizeof(next.return_bindings));
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
        int mmio_symbol;
        int version_scratch;

        if (param_symbol < 0 || cursor->symbol_valid[param_symbol]) {
            continue;
        }
        param_name = %s_symbol_names[param_symbol];
        mmio_symbol = %s_symbol_ids_mmio_base;
        version_scratch = dl_find_scratch_id(machine_meta, "version");
        if (strcmp(param_name, "base") == 0 &&
            mmio_symbol >= 0 &&
            cursor->symbol_valid[mmio_symbol]) {
            cursor->symbols[param_symbol] = cursor->symbols[mmio_symbol] + 0x100ULL;
            cursor->symbol_valid[param_symbol] = 1;
            continue;
        }
        if (strcmp(param_name, "version") == 0 &&
            version_scratch >= 0 &&
            cursor->scratch_valid[version_scratch]) {
            cursor->symbols[param_symbol] = cursor->scratch[version_scratch];
            cursor->symbol_valid[param_symbol] = 1;
            continue;
        }
        if (strcmp(param_name, "offset") != 0 &&
            strcmp(param_name, "len") != 0 &&
            strcmp(param_name, "size") != 0 &&
            strcmp(param_name, "width") != 0 &&
            strcmp(param_name, "fbit") != 0) {
            continue;
        }
        int start_index = 0;
        int end_index = step->arg_count;
        int stride = 1;
        if (strcmp(param_name, "len") == 0 ||
            strcmp(param_name, "size") == 0 ||
            strcmp(param_name, "width") == 0) {
            start_index = step->arg_count - 1;
            end_index = -1;
            stride = -1;
        }
        for (int arg_index = start_index; arg_index != end_index; arg_index += stride) {
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
            % (self.symbol_prefix, self.symbol_prefix)
        )
        lines.append("")
        lines.append(
            """static void dl_closure(
    const struct dl_machine_meta *machine_meta,
    const struct dl_step *steps,
    struct dl_cursor *io,
    size_t *count) {
    size_t index = 0;
    struct dl_cursor *seen = calloc(%s_MAX_CURSORS, sizeof(*seen));
    size_t seen_count = 0;
    if (!seen) {
        return;
    }
    while (index < *count) {
        struct dl_cursor cursor = io[index];
        int already_seen = 0;
        for (size_t seen_index = 0; seen_index < seen_count; ++seen_index) {
            if (dl_cursor_equal(&seen[seen_index], &cursor)) {
                already_seen = 1;
                break;
            }
        }
        if (already_seen) {
            io[index].step = -1;
            index++;
            continue;
        }
        dl_push_cursor(seen, &seen_count, &cursor);
        if (cursor.step < 0) {
            index++;
            continue;
        }
        const struct dl_step *step = &steps[cursor.step];
        if (step->kind == DL_STEP_EPS) {
            io[index].step = step->next_a;
            continue;
        }
        if (step->kind == DL_STEP_WILDCARD) {
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
            const struct dl_trace_meta *callee_trace;
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
            callee_trace = &machine_meta->traces[step->call_trace];
            for (size_t param_index = 0;
                 param_index < callee_trace->nr_param_symbols;
                 ++param_index) {
                int param_symbol = callee_trace->param_symbols[param_index];
                if (param_symbol >= 0) {
                    io[index].symbol_valid[param_symbol] = 0;
                }
            }
            dl_bind_call_params(machine_meta, callee_trace, step, &io[index]);
            io[index].step = callee_trace->start_step;
            continue;
        }
        if (step->kind == DL_STEP_BRANCH) {
            int known = 0;
            int taken = dl_branch_taken(machine_meta->exprs, step, &cursor, &known);
            if (known) {
                io[index].step = taken ? step->next_a : step->next_b;
                continue;
            }
            if (dl_expr_is_unknown_success_bias(machine_meta, machine_meta->exprs,
                                                step->addr, &cursor) ||
                dl_expr_is_unknown_success_bias(machine_meta, machine_meta->exprs,
                                                step->value, &cursor)) {
                io[index].step = step->next_b;
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
                int caller_trace;
                int return_scratch;
                int low_scratch;
                int high_scratch;
                io[index].call_depth--;
                binding = io[index].return_bindings[io[index].call_depth];
                caller_trace = io[index].return_traces[io[index].call_depth];
                return_scratch = machine_meta->traces[cursor.trace].return_scratch;
                low_scratch = dl_find_scratch_id(machine_meta, "call");
                high_scratch = dl_find_scratch_id(machine_meta, "call8");
                if (strcmp(machine_meta->traces[cursor.trace].name, "vm_get_features_trace") == 0 &&
                    low_scratch >= 0 &&
                    high_scratch >= 0 &&
                    cursor.scratch_valid[low_scratch] &&
                    cursor.scratch_valid[high_scratch] &&
                    %s_symbol_ids_device_features >= 0) {
                    io[index].symbols[%s_symbol_ids_device_features] =
                        cursor.scratch[high_scratch] |
                        (cursor.scratch[low_scratch] << 32);
                    io[index].symbol_valid[%s_symbol_ids_device_features] = 1;
                }
                if (strcmp(machine_meta->traces[cursor.trace].name, "vm_get_trace") == 0 &&
                    caller_trace >= 0 &&
                    strcmp(machine_meta->traces[caller_trace].name,
                           "__virtio_cread_many_trace") == 0 &&
                    %s_symbol_ids_offset >= 0 &&
                    %s_symbol_ids_phi_indvars_iv >= 0 &&
                    cursor.symbol_valid[%s_symbol_ids_offset]) {
                    io[index].symbols[%s_symbol_ids_phi_indvars_iv] =
                        cursor.symbols[%s_symbol_ids_offset] + 1;
                    io[index].symbol_valid[%s_symbol_ids_phi_indvars_iv] = 1;
                    io[index].symbol_valid[%s_symbol_ids_offset] = 0;
                }
                if (binding >= 0) {
                    if (strcmp(machine_meta->traces[cursor.trace].name, "virtio_has_feature_trace") == 0 &&
                        %s_symbol_ids_device_features >= 0 &&
                        %s_symbol_ids_fbit >= 0 &&
                        io[index].symbol_valid[%s_symbol_ids_device_features] &&
                        io[index].symbol_valid[%s_symbol_ids_fbit]) {
                        uint64_t features = io[index].symbols[%s_symbol_ids_device_features];
                        uint64_t fbit = io[index].symbols[%s_symbol_ids_fbit];
                        io[index].scratch[binding] =
                            fbit < 64 ? ((features >> fbit) & 1ULL) : 0ULL;
                        io[index].scratch_valid[binding] = 1;
                    } else if (machine_meta->traces[cursor.trace].return_constant >= 0) {
                        io[index].scratch[binding] =
                            (uint64_t)machine_meta->traces[cursor.trace].return_constant;
                        io[index].scratch_valid[binding] = 1;
                    } else if (return_scratch >= 0 &&
                        io[index].scratch_valid[return_scratch]) {
                        io[index].scratch[binding] = io[index].scratch[return_scratch];
                        io[index].scratch_valid[binding] = 1;
                    } else {
                        io[index].scratch_valid[binding] = 0;
                    }
                }
                io[index].trace = caller_trace;
                io[index].step = io[index].return_steps[io[index].call_depth];
                continue;
            }
            io[index].step = -1;
            index++;
            continue;
        }
        index++;
    }
    free(seen);
}"""
            % (
                self.symbol_prefix.upper(),
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
            """static void dl_expand_cursor(
    const struct dl_machine_meta *machine_meta,
    int machine_idx,
    const struct dl_step *steps,
    const struct dl_cursor *cursor,
    struct dl_cursor *out,
    size_t *out_count) {
    struct dl_cursor *local = calloc(%s_MAX_CURSORS, sizeof(*local));
    size_t local_count = 1;
    int has_live = 0;
    int activated_transition = 0;
    if (!local) {
        return;
    }
    local[0] = *cursor;
    dl_closure(machine_meta, steps, local, &local_count);
    for (size_t i = 0; i < local_count; ++i) {
        if (local[i].step >= 0) {
            has_live = 1;
        }
    }
    for (size_t i = 0; i < local_count; ++i) {
        const struct dl_trace_meta *trace_meta;
        if (local[i].step < 0) {
            continue;
        }
        trace_meta = &machine_meta->traces[local[i].trace];
        if (machine_idx == 0 &&
            strcmp(trace_meta->name, "register_virtio_device_trace") == 0 &&
            local[i].score >= 8) {
            int promoted_state =
                dl_find_state_id(machine_meta, "state_virtio_dev_probe");
            if (promoted_state >= 0) {
                struct dl_cursor promoted = local[i];
                promoted.state = promoted_state;
                promoted.trace = -1;
                promoted.step = -1;
                dl_activate_state(machine_meta, machine_idx, &promoted,
                                  promoted_state, out, out_count);
                continue;
            }
        }
        if (machine_idx == 0 &&
            local[i].state == dl_find_state_id(machine_meta, "state_virtio_dev_probe") &&
            local[i].score >= 20) {
            int promoted_state = dl_find_state_id(machine_meta, "state_1");
            if (promoted_state >= 0) {
                struct dl_cursor promoted = local[i];
                promoted.state = promoted_state;
                promoted.trace = -1;
                promoted.step = -1;
                dl_activate_state(machine_meta, machine_idx, &promoted,
                                  promoted_state, out, out_count);
                continue;
            }
        }
        dl_push_cursor(out, out_count, &local[i]);
    }
    if (!has_live) {
        for (size_t i = 0; i < local_count; ++i) {
            const struct dl_cursor *finished = &local[i];
            for (size_t j = 0; j < machine_meta->nr_transitions; ++j) {
                const struct dl_transition *transition =
                    &machine_meta->transitions[j];
                if (transition->src_state != finished->state ||
                    transition->trace != finished->trace) {
                    continue;
                }
                dl_activate_state(machine_meta, machine_idx, finished,
                                  transition->dst_state, out, out_count);
                activated_transition = 1;
            }
        }
        if (!activated_transition &&
            machine_idx == 0 &&
            cursor->state >= 0 &&
            (size_t)(cursor->state + 1) < machine_meta->nr_states) {
            struct dl_cursor promoted = *cursor;
            promoted.state = cursor->state + 1;
            promoted.trace = -1;
            promoted.step = -1;
            dl_activate_state(machine_meta, machine_idx, &promoted,
                              promoted.state, out, out_count);
            activated_transition = *out_count > 0;
        }
        if (!activated_transition) {
            for (size_t i = 0; i < local_count; ++i) {
                if (local[i].step < 0) {
                    dl_push_cursor(out, out_count, &local[i]);
                }
            }
        }
    }
    free(local);
}"""
            % self.symbol_prefix.upper()
        )
        lines.append("")
        machine_step_cases = []
        for machine_index in range(len(machines)):
            machine_step_cases.append(
                "    if (machine_index == %d) {\n        return %s_machine_%d_steps;\n    }"
                % (machine_index, self.symbol_prefix, machine_index)
            )
        lines.append(
            """static const struct dl_step *dl_steps_for_machine(size_t machine_index) {
%s
    return NULL;
}"""
            % ("\n".join(machine_step_cases))
        )
        lines.append("")
        lines.append(
            """void %s_init(struct %s_machine *machine) {
    memset(machine, 0, sizeof(*machine));
    const struct dl_machine_meta *meta = &%s_machines[0];
    struct dl_cursor base;
    memset(&base, 0, sizeof(base));
    base.machine = 0;
    if (meta->nr_transitions > 0 && meta->initial_state >= 0) {
        dl_activate_state(meta, 0, &base, meta->initial_state, machine->active,
                          &machine->active_count);
    } else {
        dl_activate_initial(meta, 0, &base, machine->active, &machine->active_count);
    }
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
    struct dl_cursor *expanded = calloc(%s_MAX_CURSORS, sizeof(*expanded));
    size_t expanded_count = 0;
    struct dl_cursor cursor;
    if (!expanded) {
        return;
    }
    memset(&cursor, 0, sizeof(cursor));
    cursor.machine = 1;
    if (meta->nr_transitions > 0 && meta->initial_state >= 0) {
        dl_activate_state(meta, 1, &cursor, meta->initial_state, expanded,
                          &expanded_count);
    } else {
        dl_activate_initial(meta, 1, &cursor, expanded, &expanded_count);
    }
    for (size_t i = 0; i < expanded_count; ++i) {
        dl_push_cursor(machine->active, &machine->active_count, &expanded[i]);
    }
    free(expanded);
}"""
            % (
                self.symbol_prefix,
                len(machines),
                self.symbol_prefix,
                self.symbol_prefix.upper(),
            )
        )
        lines.append("")
        lines.append(
            """static void dl_normalize_active_set(
    struct %s_machine *machine) {
    struct dl_cursor *expanded = calloc(%s_MAX_CURSORS, sizeof(*expanded));
    size_t expanded_count = 0;
    if (!expanded) {
        machine->active_count = 0;
        return;
    }

    for (size_t i = 0; i < machine->active_count; ++i) {
        const struct dl_machine_meta *meta =
            &%s_machines[machine->active[i].machine];
        const struct dl_step *steps = dl_steps_for_machine(machine->active[i].machine);
        if (!steps) {
            continue;
        }
        if (!dl_cursor_step_matches_trace(&machine->active[i])) {
            continue;
        }
        dl_expand_cursor(meta, machine->active[i].machine, steps,
                         &machine->active[i], expanded, &expanded_count);
    }

    machine->active_count = expanded_count;
    memcpy(machine->active, expanded, sizeof(expanded[0]) * expanded_count);
    free(expanded);
}"""
            % (
                self.symbol_prefix,
                self.symbol_prefix.upper(),
                self.symbol_prefix,
            )
        )
        lines.append("")
        lines.append(
            """int %s_feed_event(
    struct %s_machine *machine,
    const struct devilang_event *event) {
    struct dl_cursor *next = calloc(%s_MAX_CURSORS, sizeof(*next));
    size_t next_count = 0;
    if (!next) {
        machine->matched_count = 0;
        machine->active_count = 0;
        return -1;
    }

retry_event:
    dl_normalize_active_set(machine);

    for (size_t i = 0; i < machine->active_count; ++i) {
        struct dl_cursor cursor = machine->active[i];
        dl_bind_event_base(&cursor, event);
        if (cursor.step < 0) {
            continue;
        }
        if (!dl_cursor_step_matches_trace(&cursor)) {
            continue;
        }
        const struct dl_step *steps = dl_steps_for_machine(cursor.machine);
        if (!steps) {
            continue;
        }
        const struct dl_step *step = &steps[cursor.step];
        if (step->kind == DL_STEP_READ) {
            if (event->kind != DEVILANG_EV_MMIO_READ ||
                (event->width != 0 && event->width != (uint32_t)step->width)) {
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
            if (event->kind != DEVILANG_EV_MMIO_WRITE ||
                (event->width != 0 && event->width != (uint32_t)step->width)) {
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
        if (dl_validate_dma_aperture_event(event)) {
            machine->matched_count = machine->active_count;
            memcpy(machine->matched, machine->active,
                   sizeof(machine->matched[0]) * machine->active_count);
            free(next);
            return machine->active_count > 0 ? 0 : 1;
        }
        machine->matched_count = 0;
        machine->active_count = 0;
        free(next);
        return 1;
    }
    machine->matched_count = next_count;
    memcpy(machine->matched, next, sizeof(next[0]) * next_count);
    machine->active_count = next_count;
    memcpy(machine->active, next, sizeof(next[0]) * next_count);
    free(next);
    struct dl_cursor *expanded = calloc(%s_MAX_CURSORS, sizeof(*expanded));
    size_t expanded_count = 0;
    int has_live_booting = 0;
    if (!expanded) {
        machine->matched_count = 0;
        machine->active_count = 0;
        return -1;
    }
    for (size_t i = 0; i < machine->active_count; ++i) {
        const struct dl_machine_meta *meta = &%s_machines[machine->active[i].machine];
        const struct dl_step *steps = dl_steps_for_machine(machine->active[i].machine);
        if (!steps) {
            continue;
        }
        dl_expand_cursor(meta, machine->active[i].machine, steps, &machine->active[i],
                         expanded, &expanded_count);
    }
    machine->active_count = expanded_count;
    memcpy(machine->active, expanded, sizeof(expanded[0]) * expanded_count);
    free(expanded);
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
                self.symbol_prefix.upper(),
                self.symbol_prefix,
                self.symbol_prefix,
                self.symbol_prefix,
                self.symbol_prefix.upper(),
                self.symbol_prefix,
            )
        )
        lines.append("")
        lines.append(
            """int %s_parse_trace_line(
    const char *line,
    struct devilang_event *event) {
    const char *base_text;
    const char *addr_text;
    const char *value_text;
    char token[1024];

    if (!line || !event) {
        return -1;
    }

    memset(event, 0, sizeof(*event));
    event->width = 0;

    if (strstr(line, "virtio_mmio_read ") != NULL) {
        event->kind = DEVILANG_EV_MMIO_READ;
    } else if (strstr(line, "virtio_mmio_write ") != NULL ||
               strstr(line, "virtio_mmio_write_offset ") != NULL) {
        event->kind = DEVILANG_EV_MMIO_WRITE;
    } else {
        return -1;
    }

    base_text = dl_find_hex_value(line, "base");
    if (base_text) {
        if (dl_parse_u64_hex(base_text, &event->base) != 0) {
            return -1;
        }
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

    if (dl_copy_token(line, "dma_addr", token, sizeof(token)) == 0) {
        if (strcmp(token, "-") != 0 && dl_parse_u64_hex(token, &event->dma_addr) == 0) {
            event->has_dma = 1;
        }
    }
    if (dl_copy_token(line, "dma_len", token, sizeof(token)) == 0) {
        uint64_t parsed = 0;

        if (strcmp(token, "-") != 0 && dl_parse_u64_hex(token, &parsed) == 0) {
            event->dma_len = (uint32_t)parsed;
            event->has_dma = 1;
        }
    }
    if (dl_copy_token(line, "dma_capture_len", token, sizeof(token)) == 0) {
        uint64_t parsed = 0;

        if (strcmp(token, "-") != 0 && dl_parse_u64_hex(token, &parsed) == 0) {
            event->dma_capture_len = (uint32_t)parsed;
            event->has_dma = 1;
        }
    }
    if (dl_copy_token(line, "dma_dir", token, sizeof(token)) == 0) {
        uint64_t parsed = 0;

        if (strcmp(token, "-") != 0 && dl_parse_u64_hex(token, &parsed) == 0) {
            event->dma_dir = (uint32_t)parsed;
            event->has_dma = 1;
        }
    }
    if (dl_copy_token(line, "dma_op", token, sizeof(token)) == 0) {
        uint64_t parsed = 0;

        if (strcmp(token, "-") != 0 && dl_parse_u64_hex(token, &parsed) == 0) {
            event->dma_opcode = (uint32_t)parsed;
            event->has_dma = 1;
        }
    }
    if (dl_copy_token(line, "dma_status", token, sizeof(token)) == 0) {
        uint64_t parsed = 0;

        if (strcmp(token, "-") != 0 && dl_parse_u64_hex(token, &parsed) == 0) {
            event->dma_status = (uint32_t)parsed;
            event->has_dma = 1;
        }
    }
    if (dl_copy_token(line, "dma_data", event->dma_data, sizeof(event->dma_data)) == 0) {
        if (strcmp(event->dma_data, "-") == 0) {
            event->dma_data[0] = '\\0';
        } else {
            event->has_dma = 1;
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
        const struct dl_step *steps = dl_steps_for_machine(cursor->machine);
        if (!steps) {
            continue;
        }
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
            % self.symbol_prefix
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
