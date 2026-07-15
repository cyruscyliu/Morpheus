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
READ_CALL_RE = re.compile(
    r"^(?P<name>read(?:8|16|32|64|b|w|l|q))\((?P<addr>.+)\)$"
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
STRUCT_RE = re.compile(r"^struct\s+([A-Za-z0-9_]+)\s*\{$")
HEAD_RE = re.compile(r"^head(?:\s+[A-Za-z0-9_]+)?\s*\{$")
POINTER_RE = re.compile(r"^pointer\s*\{$")
LIST_RE = re.compile(r"^(?:dlist|list|ring|ringbuf)\b.*\{$")
OP_RE = re.compile(r"^op\s+(?P<name>[A-Za-z0-9_]+)\s*\{$")
MMIO_SCHEMA_RE = re.compile(r"^mmio\s+(?P<name>[A-Za-z0-9_]+)\s*\{$")
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
DMA_EVENT_RE = re.compile(r"^dma_event\((?P<body>.*)\)$")
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
    "DMA_NONE": 0,
    "DMA_TO_DEVICE": 1,
    "DMA_FROM_DEVICE": 2,
    "DMA_BIDIRECTIONAL": 3,
    "VRING_DESC_F_WRITE": 2,
}

DMA_OP_IDS: Dict[str, int] = {
    "alloc": 0x01,
    "alloc_fail": 0x02,
    "free": 0x03,
    "map": 0x04,
    "map_fail": 0x05,
    "unmap": 0x06,
    "sync_for_cpu": 0x07,
    "sync_for_device": 0x08,
    "vq_poll_hit": 0x09,
    "vq_poll_miss": 0x0A,
    "vq_get_buf": 0x0B,
    "vq_get_buf_empty": 0x0C,
}

DMA_DIR_IDS: Dict[str, int] = {
    "none": 0x0,
    "to_device": 0x1,
    "from_device": 0x2,
    "bidirectional": 0x3,
}

DMA_PATH_IDS: Dict[str, int] = {
    "dma_api": 0x0,
    "phys": 0x1,
}

DMA_DATA_KIND_IDS: Dict[str, int] = {
    "any": 0,
    "sg_buffer": 1,
    "virtq_desc_table": 2,
    "virtio_net_hdr": 3,
    "ethernet_frame": 4,
    "zero_buffer": 5,
    "control_buf": 6,
    "virtio_net_hdr_mrg_rxbuf": 7,
    "virtio_net_hdr_v1_hash_tunnel": 8,
    "virtnet_rq_dma": 9,
    "xdp_frame": 10,
    "arp_packet": 11,
    "ipv4_tcp_packet": 12,
    "ipv4_udp_packet": 13,
    "ipv4_icmp_packet": 14,
    "ipv6_tcp_packet": 15,
    "ipv6_udp_packet": 16,
    "ipv6_icmpv6_packet": 17,
    "ipv6_fragment_packet": 18,
    "vlan_arp_packet": 19,
    "vlan_ipv4_packet": 20,
    "vlan_ipv6_packet": 21,
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
class SchemaImmediate:
    kind: str
    start: int
    end: int


@dataclasses.dataclass
class SchemaBitConstraint:
    start: int
    end: int
    value: Optional[int] = None


@dataclasses.dataclass
class SchemaField:
    name: str
    type_name: str
    size: int
    offset: int
    immediate_values: Tuple[int, ...] = ()
    immediate_ranges: Tuple[Tuple[int, int], ...] = ()
    bit_constraints: Tuple[SchemaBitConstraint, ...] = ()


@dataclasses.dataclass
class StructSchema:
    name: str
    fields: List[SchemaField]
    size: int


@dataclasses.dataclass
class PointerSchema:
    source_type: str
    source_field: str
    target_types: Tuple[str, ...]
    align: int = 0


@dataclasses.dataclass
class MmioOp:
    name: str
    direction: str
    region: int
    address: int
    size: int
    data: Optional[int] = None


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
    dma_op: int = -1
    dma_dir: int = -1
    dma_path: int = -1
    dma_data_kind: int = 0
    dma_data_type_name: str = ""
    dma_field_names: Tuple[str, ...] = ()
    dma_field_start: int = -1
    dma_field_count: int = 0
    mmio_signature_mask: int = 0
    reachable_mask: int = 0
    reachable_signature_mask: int = 0


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


def normalize_read_call_name(name: str) -> Optional[str]:
    aliases = {
        "read8": "read8",
        "read16": "read16",
        "read32": "read32",
        "read64": "read64",
        "readb": "read8",
        "readw": "read16",
        "readl": "read32",
        "readq": "read64",
    }
    return aliases.get(name)


def parse_read_call_expr(expr: str) -> Optional[Tuple[str, str]]:
    match = READ_CALL_RE.match(strip_outer_parens(expr))
    if not match:
        return None
    name = normalize_read_call_name(match.group("name"))
    if name is None:
        return None
    return name, strip_outer_parens(match.group("addr"))


def parse_named_fields(text: str) -> Dict[str, str]:
    fields: Dict[str, str] = {}
    for item in split_args(text):
        if "=" not in item:
            raise ParseError(f"malformed named field: {item}")
        key, value = item.split("=", 1)
        fields[key.strip()] = value.strip()
    return fields


def parse_named_field_lists(text: str) -> Dict[str, List[str]]:
    fields: Dict[str, List[str]] = {}
    for item in split_args(text):
        if "=" not in item:
            raise ParseError(f"malformed named field: {item}")
        key, value = item.split("=", 1)
        fields.setdefault(key.strip(), []).append(value.strip())
    return fields


FIELD_DECL_RE = re.compile(r"^(?P<name>[A-Za-z0-9_]+)\s*:\s*(?P<body>.+)$")
INT_RE = re.compile(r"^-?(?:0x[0-9a-fA-F]+|\d+)$")
TYPE_PREFIX_RE = re.compile(
    r"^(?P<type>ptr<[^>]+>|bytes\[[^\]]+\]|u8|u16|u32|u64)(?P<rest>\s+.*|)$"
)


def parse_int_literal(text: str) -> int:
    return int(text, 0)


def split_bracket_blocks(text: str) -> Tuple[str, List[str]]:
    prefix_parts: List[str] = []
    blocks: List[str] = []
    i = 0
    while i < len(text):
        if text[i] != "[":
            prefix_parts.append(text[i])
            i += 1
            continue
        depth = 1
        start = i + 1
        i += 1
        while i < len(text) and depth > 0:
            if text[i] == "[":
                depth += 1
            elif text[i] == "]":
                depth -= 1
                if depth == 0:
                    blocks.append(text[start:i].strip())
                    i += 1
                    break
            i += 1
    return "".join(prefix_parts).strip(), blocks


def type_size_bytes(type_name: str) -> int:
    if type_name == "u8":
        return 1
    if type_name == "u16":
        return 2
    if type_name == "u32":
        return 4
    if type_name == "u64":
        return 8
    if type_name.startswith("bytes[") and type_name.endswith("]"):
        return int(type_name[6:-1], 0)
    if type_name.startswith("ptr<") and type_name.endswith(">"):
        return type_size_bytes(type_name[4:-1].strip())
    raise ParseError(f"unsupported field type: {type_name}")


def parse_struct_field(text: str, offset: int) -> SchemaField:
    field_match = FIELD_DECL_RE.match(text.strip())
    if not field_match:
        raise ParseError(f"malformed struct field: {text}")
    name = field_match.group("name")
    body = field_match.group("body").strip().removesuffix(";").strip()
    type_match = TYPE_PREFIX_RE.match(body)
    if not type_match:
        raise ParseError(f"missing field type in: {text}")
    type_name = type_match.group("type").strip()
    prefix, blocks = split_bracket_blocks(type_match.group("rest").strip())
    modifiers = prefix.split()
    size = type_size_bytes(type_name)
    immediate_values: List[int] = []
    immediate_ranges: List[Tuple[int, int]] = []
    bit_constraints: List[SchemaBitConstraint] = []
    for block in blocks:
        entries = [entry.strip() for entry in re.split(r"[;,]", block) if entry.strip()]
        if not entries:
            continue
        if any(entry.startswith("imm ") or entry.startswith("range ") for entry in entries):
            for entry in entries:
                if entry.startswith("imm "):
                    immediate_values.append(parse_int_literal(entry[4:].strip()))
                    continue
                if entry.startswith("range "):
                    lo_text, hi_text = [item.strip() for item in entry[6:].split("..", 1)]
                    immediate_ranges.append((parse_int_literal(lo_text), parse_int_literal(hi_text)))
                    continue
                if ".." in entry:
                    lo_text, hi_text = [item.strip() for item in entry.split("..", 1)]
                    immediate_ranges.append((parse_int_literal(lo_text), parse_int_literal(hi_text)))
                    continue
                if INT_RE.match(entry):
                    immediate_values.append(parse_int_literal(entry))
            continue
        for entry in entries:
            if entry.startswith("bits "):
                entry = entry[5:].strip()
            value: Optional[int] = None
            if "=" in entry:
                entry, value_text = [item.strip() for item in entry.split("=", 1)]
                value = parse_int_literal(value_text)
            lo_text, hi_text = [item.strip() for item in entry.split("..", 1)]
            bit_constraints.append(
                SchemaBitConstraint(
                    start=parse_int_literal(lo_text),
                    end=parse_int_literal(hi_text),
                    value=value,
                )
            )
    return SchemaField(
        name=name,
        type_name=type_name,
        size=size,
        offset=offset,
        immediate_values=tuple(immediate_values),
        immediate_ranges=tuple(immediate_ranges),
        bit_constraints=tuple(bit_constraints),
    )


def parse_pointer_block(lines: Sequence[str]) -> PointerSchema:
    fields: Dict[str, str] = {}
    for raw in lines:
        text = raw.strip().removesuffix(";").strip()
        if "=" not in text:
            continue
        key, value = [item.strip() for item in text.split("=", 1)]
        fields[key] = value
    source = fields.get("from", "")
    targets = fields.get("to", "")
    align = parse_int_literal(fields.get("align", "0"))
    if "." not in source or not targets:
        raise ParseError(f"malformed pointer block: from={source!r} to={targets!r}")
    source_type, source_field = [item.strip() for item in source.split(".", 1)]
    target_types = tuple(item.strip() for item in targets.split("|") if item.strip())
    return PointerSchema(
        source_type=source_type,
        source_field=source_field,
        target_types=target_types,
        align=align,
    )


def parse_mmio_op_block(name: str, lines: Sequence[str]) -> MmioOp:
    fields: Dict[str, str] = {}
    for raw in lines:
        text = raw.strip().removesuffix(";").strip()
        if "=" not in text:
            continue
        key, value = [item.strip() for item in text.split("=", 1)]
        fields[key] = value
    direction = fields.get("direction", "")
    if direction not in {"r", "w"}:
        raise ParseError(f"malformed mmio op direction in {name}: {direction!r}")
    if "address" not in fields or "size" not in fields:
        raise ParseError(f"malformed mmio op {name}: missing address or size")
    region = parse_int_literal(fields.get("region", "0"))
    data = parse_int_literal(fields["data"]) if "data" in fields else None
    return MmioOp(
        name=name,
        direction=direction,
        region=region,
        address=parse_int_literal(fields["address"]),
        size=parse_int_literal(fields["size"]),
        data=data,
    )


class StateCompiler:
    def __init__(self, symbol_prefix: str) -> None:
        self.symbol_prefix = symbol_prefix
        self.symbol_ids: Dict[str, int] = {}
        self.symbol_names: List[str] = []
        self.struct_schemas: Dict[str, StructSchema] = {}
        self.pointer_schemas: List[PointerSchema] = []
        self.mmio_ops: List[MmioOp] = []
        self.trace_return_constant_overrides: Dict[str, int] = {
            "virtio_features_ok_trace": 0,
        }

    def resolve_mmio_schema_name(self, op_name: str) -> Optional[str]:
        candidates = [op_name]
        current = op_name
        for suffix in ("_read", "_write"):
            if current.endswith(suffix):
                current = current[: -len(suffix)]
                candidates.append(current)
                break
        for candidate in candidates:
            if candidate in self.struct_schemas:
                return candidate
        return None

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
                if DMA_EVENT_RE.match(line):
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
        current_struct_name: Optional[str] = None
        current_struct_fields: List[SchemaField] = []
        current_field_parts: List[str] = []
        current_field_brackets = 0
        current_pointer_lines: List[str] = []
        current_op_name: Optional[str] = None
        current_mmio_name: Optional[str] = None
        current_mmio_lines: List[str] = []
        current_topology_depth = 0
        stack: List[str] = []

        for lineno, raw in enumerate(text.splitlines(), start=1):
            line = raw.strip()
            if not line:
                continue

            if stack and stack[-1] in {
                "struct",
                "head",
                "pointer",
                "topology",
                "op",
                "mmio_schema",
            }:
                struct_match = STRUCT_RE.match(line)
                if struct_match:
                    current_struct_name = struct_match.group(1)
                    current_struct_fields = []
                    current_field_parts = []
                    current_field_brackets = 0
                    stack.append("struct")
                    continue
                if HEAD_RE.match(line):
                    stack.append("head")
                    continue
                if POINTER_RE.match(line):
                    current_pointer_lines = []
                    stack.append("pointer")
                    continue
                if LIST_RE.match(line):
                    current_topology_depth += 1
                    stack.append("topology")
                    continue
                op_match = OP_RE.match(line)
                if op_match:
                    current_op_name = op_match.group("name")
                    stack.append("op")
                    continue
                mmio_match = MMIO_SCHEMA_RE.match(line)
                if mmio_match:
                    current_mmio_name = mmio_match.group("name")
                    current_mmio_lines = []
                    stack.append("mmio_schema")
                    continue
                if stack[-1] == "pointer":
                    if line == "}":
                        self.pointer_schemas.append(
                            parse_pointer_block(list(current_pointer_lines))
                        )
                        current_pointer_lines = []
                        stack.pop()
                        continue
                    current_pointer_lines.append(line)
                    continue
                if stack[-1] == "struct":
                    if line == "}":
                        if current_struct_name is not None:
                            self.struct_schemas[current_struct_name] = StructSchema(
                                name=current_struct_name,
                                fields=list(current_struct_fields),
                                size=sum(field.size for field in current_struct_fields),
                            )
                            current_struct_name = None
                            current_struct_fields = []
                            current_field_parts = []
                            current_field_brackets = 0
                        stack.pop()
                        continue
                    current_field_parts.append(line)
                    current_field_brackets += line.count("[") - line.count("]")
                    if current_field_brackets <= 0 and line.endswith(";"):
                        field_text = " ".join(part.strip() for part in current_field_parts)
                        field = parse_struct_field(
                            field_text,
                            sum(item.size for item in current_struct_fields),
                        )
                        current_struct_fields.append(field)
                        current_field_parts = []
                        current_field_brackets = 0
                    continue
                if stack[-1] == "mmio_schema":
                    if line == "}":
                        if current_op_name and current_mmio_name:
                            self.mmio_ops.append(
                                parse_mmio_op_block(
                                    current_mmio_name,
                                    list(current_mmio_lines),
                                )
                            )
                        current_mmio_name = None
                        current_mmio_lines = []
                        stack.pop()
                        continue
                    current_mmio_lines.append(line)
                    continue
                if line == "}":
                    if stack[-1] == "op":
                        current_op_name = None
                    if stack[-1] == "topology" and current_topology_depth > 0:
                        current_topology_depth -= 1
                    stack.pop()
                    continue
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

            struct_match = STRUCT_RE.match(line)
            if struct_match:
                current_struct_name = struct_match.group(1)
                current_struct_fields = []
                current_field_parts = []
                current_field_brackets = 0
                stack.append("struct")
                continue

            if HEAD_RE.match(line):
                stack.append("head")
                continue

            if POINTER_RE.match(line):
                current_pointer_lines = []
                stack.append("pointer")
                continue

            if LIST_RE.match(line):
                current_topology_depth = 1
                stack.append("topology")
                continue

            op_match = OP_RE.match(line)
            if op_match:
                current_op_name = op_match.group("name")
                stack.append("op")
                continue

            mmio_match = MMIO_SCHEMA_RE.match(line)
            if mmio_match:
                current_mmio_name = mmio_match.group("name")
                current_mmio_lines = []
                stack.append("mmio_schema")
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
            self.symbol_ids[raw] = len(self.symbol_names)
            self.symbol_names.append(raw)
        return self.symbol_ids[raw]

    def symbol_name(self, symbol: Optional[int]) -> str:
        if symbol is None or symbol < 0 or symbol >= len(self.symbol_names):
            return ""
        return self.symbol_names[symbol]

    @staticmethod
    def is_transport_mmio_base_symbol(name: str) -> bool:
        return name == "mmio_base"

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
        if "." in expr and re.fullmatch(r"[A-Za-z_][A-Za-z0-9_.]*", expr):
            return Expr(kind="symbol", symbol=self.symbol_id(expr), offset=0)
        if not allow_symbol and expr.startswith("phi(") and expr.endswith(")"):
            phi_args = split_args(expr[4:-1])
            if len(phi_args) == 2:
                lhs = self.parse_expr(
                    phi_args[0],
                    scratch_map,
                    allow_symbol=False,
                    forced_symbols=forced_symbols,
                )
                rhs = self.parse_expr(
                    phi_args[1],
                    scratch_map,
                    allow_symbol=True,
                    forced_symbols=forced_symbols,
                )
                if lhs.kind == "const" and lhs.value == 0 and rhs.kind != "any":
                    return rhs

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

    def expr_mmio_offset_hint(self, expr: Optional[Expr]) -> Optional[int]:
        if expr is None or expr.kind != "symbol":
            return None
        name = self.symbol_name(expr.symbol)
        if not self.is_transport_mmio_base_symbol(name):
            return None
        if expr.offset < 0 or expr.offset > 0xffff:
            return None
        return expr.offset

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
            "dma_event",
            "op",
            "dir",
            "path",
            "data_kind",
            "data_type",
            "data_field",
            "map",
            "unmap",
            "sync_for_cpu",
            "sync_for_device",
            "vq_poll_hit",
            "vq_poll_miss",
            "vq_get_buf",
            "vq_get_buf_empty",
            "to_device",
            "from_device",
            "bidirectional",
            "none",
            "dma_api",
            "phys",
            "sg_buffer",
            "virtq_desc_table",
            "virtio_net_hdr",
            "virtio_net_hdr_mrg_rxbuf",
            "virtio_net_hdr_v1_hash_tunnel",
            "ethernet_frame",
            "zero_buffer",
            "control_buf",
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
        List[Tuple[str, int, int]],
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
                block_read_aliases: Dict[Tuple[str, str], str] = {}
                for line in block.lines:
                    step = Step(kind="eps", trace=trace_idx, block=len(block_offsets) - 1)
                    read_match = READ_RE.match(line)
                    write_call = parse_write_call(line)
                    dma_event_match = DMA_EVENT_RE.match(line)
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
                        block_read_aliases[
                            (
                                f"read{read_match.group('width')}",
                                strip_outer_parens(read_match.group("addr")),
                            )
                        ] = read_match.group("lhs")
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
                    elif dma_event_match:
                        field_lists = parse_named_field_lists(dma_event_match.group("body"))
                        fields = {
                            key: values[-1]
                            for key, values in field_lists.items()
                            if values
                        }
                        op_name = fields.get("op")
                        dir_name = fields.get("dir")
                        path_name = fields.get("path")
                        addr_expr = fields.get("addr")
                        len_expr = fields.get("len")
                        data_kind_name = fields.get("data_kind", "any")
                        data_type_name = fields.get("data_type", "")
                        data_field_names = tuple(field_lists.get("data_field", []))
                        if op_name not in DMA_OP_IDS:
                            raise ParseError(
                                f"unknown dma_event op in {machine.name}/{trace.name}: {op_name}"
                            )
                        if dir_name not in DMA_DIR_IDS:
                            raise ParseError(
                                f"unknown dma_event dir in {machine.name}/{trace.name}: {dir_name}"
                            )
                        if path_name not in DMA_PATH_IDS:
                            raise ParseError(
                                f"unknown dma_event path in {machine.name}/{trace.name}: {path_name}"
                            )
                        if data_kind_name not in DMA_DATA_KIND_IDS:
                            raise ParseError(
                                f"unknown dma_event data_kind in {machine.name}/{trace.name}: {data_kind_name}"
                            )
                        if addr_expr is None or len_expr is None:
                            raise ParseError(
                                f"dma_event requires addr and len in {machine.name}/{trace.name}"
                            )
                        step.kind = "dma"
                        step.addr = intern_expr(
                            self.parse_expr(
                                addr_expr,
                                scratch_map,
                                allow_symbol=True,
                                forced_symbols=trace_param_names,
                            )
                        )
                        step.value = intern_expr(
                            self.parse_expr(
                                len_expr,
                                scratch_map,
                                allow_symbol=False,
                                forced_symbols=trace_param_names,
                            )
                        )
                        step.dma_op = DMA_OP_IDS[op_name]
                        step.dma_dir = DMA_DIR_IDS[dir_name]
                        step.dma_path = DMA_PATH_IDS[path_name]
                        step.dma_data_kind = DMA_DATA_KIND_IDS[data_kind_name]
                        step.dma_data_type_name = data_type_name
                        step.dma_field_names = data_field_names
                    elif neqj_match:
                        lhs_text = neqj_match.group("lhs")
                        rhs_text = neqj_match.group("rhs")
                        lhs_read = parse_read_call_expr(lhs_text)
                        rhs_read = parse_read_call_expr(rhs_text)
                        if lhs_read is not None:
                            lhs_text = block_read_aliases.get(lhs_read, lhs_text)
                        if rhs_read is not None:
                            rhs_text = block_read_aliases.get(rhs_read, rhs_text)
                        step.kind = "branch"
                        step.next_b = -2
                        step.next_a = -2
                        step.addr = intern_expr(
                            self.parse_expr(
                                lhs_text,
                                scratch_map,
                                allow_symbol=False,
                                forced_symbols=trace_param_names,
                            )
                        )
                        step.value = intern_expr(
                            self.parse_expr(
                                rhs_text,
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
                next_block_start = -1
                for lookahead in range(block_idx + 1, len(block_offsets)):
                    candidate = block_offsets[lookahead]
                    if candidate > end - 1:
                        next_block_start = candidate
                        break
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
                    next_block_start
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
                if (
                    trace.name == "__virtio_cread_many_trace"
                    and block.lines
                    and start < end
                ):
                    line0 = block.lines[0].strip()
                    generation_retry_match = re.match(
                        r"neqj phi\(0, (?P<new>[A-Za-z_][A-Za-z0-9_]*)\), "
                        r"phi\(phi\(0, (?P<old>[A-Za-z_][A-Za-z0-9_]*)\), "
                        r"phi\(0, (?P=new)\)\), @(?P<label>[A-Za-z0-9_]+);",
                        line0,
                    )
                    if generation_retry_match is not None:
                        trace_steps[start].kind = "branch"
                        trace_steps[start].addr = intern_expr(
                            self.parse_expr(
                                generation_retry_match.group("new"),
                                scratch_map,
                                allow_symbol=False,
                                forced_symbols=trace_param_names,
                            )
                        )
                        trace_steps[start].value = intern_expr(
                            self.parse_expr(
                                generation_retry_match.group("old"),
                                scratch_map,
                                allow_symbol=False,
                                forced_symbols=trace_param_names,
                            )
                        )
                        trace_steps[start].next_a = label_to_start.get(
                            generation_retry_match.group("label"),
                            default_next,
                        )
                        trace_steps[start].next_b = default_next
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

        observable_mask_by_kind = {
            "read": 1,
            "write": 2,
            "dma": 4,
        }
        mmio_signature_ids: Dict[Tuple[str, int], int] = {}

        for step in all_steps:
            if step.kind not in {"read", "write"} or step.addr < 0:
                continue
            addr_expr = exprs[step.addr]
            offset = self.expr_mmio_offset_hint(addr_expr)
            if offset is None:
                continue
            key = (step.kind, offset)
            if key not in mmio_signature_ids:
                mmio_signature_ids[key] = len(mmio_signature_ids)
            step.mmio_signature_mask = 1 << mmio_signature_ids[key]

        def step_base_reachable_mask(step: Step) -> int:
            return observable_mask_by_kind.get(step.kind, 0)

        def step_base_reachable_signature_mask(step: Step) -> int:
            if step.kind in {"read", "write"}:
                return step.mmio_signature_mask
            return 0

        for step in all_steps:
            step.reachable_mask = step_base_reachable_mask(step)
            step.reachable_signature_mask = step_base_reachable_signature_mask(
                step
            )

        changed = True
        while changed:
            changed = False
            for step in reversed(all_steps):
                mask = step_base_reachable_mask(step)
                signature_mask = step_base_reachable_signature_mask(step)

                if step.kind in {"eps", "goto", "wildcard", "assign"}:
                    if 0 <= step.next_a < len(all_steps):
                        mask |= all_steps[step.next_a].reachable_mask
                        signature_mask |= (
                            all_steps[step.next_a].reachable_signature_mask
                        )
                elif step.kind == "call":
                    if 0 <= step.next_a < len(all_steps):
                        mask |= all_steps[step.next_a].reachable_mask
                        signature_mask |= (
                            all_steps[step.next_a].reachable_signature_mask
                        )
                    if 0 <= step.call_trace < len(machine.traces):
                        callee_name = machine.traces[step.call_trace].name
                        callee_start = trace_start_steps.get(callee_name, -1)
                        if 0 <= callee_start < len(all_steps):
                            mask |= all_steps[callee_start].reachable_mask
                            signature_mask |= (
                                all_steps[callee_start].reachable_signature_mask
                            )
                elif step.kind == "branch":
                    if 0 <= step.next_a < len(all_steps):
                        mask |= all_steps[step.next_a].reachable_mask
                        signature_mask |= (
                            all_steps[step.next_a].reachable_signature_mask
                        )
                    if 0 <= step.next_b < len(all_steps):
                        mask |= all_steps[step.next_b].reachable_mask
                        signature_mask |= (
                            all_steps[step.next_b].reachable_signature_mask
                        )

                if mask != step.reachable_mask:
                    step.reachable_mask = mask
                    changed = True
                if signature_mask != step.reachable_signature_mask:
                    step.reachable_signature_mask = signature_mask
                    changed = True

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
            sorted(
                ((kind, offset, sig_id)
                 for (kind, offset), sig_id in mmio_signature_ids.items()),
                key=lambda item: item[2],
            ),
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
    DEVILANG_EV_DMA = 3,
}};

struct devilang_event {{
    enum devilang_event_kind kind;
    uint64_t base;
    uint64_t addr;
    uint64_t value;
    uint64_t dma_addr;
    uint32_t dma_queue;
    uint32_t width;
    uint32_t dma_len;
    uint32_t dma_capture_len;
    uint32_t dma_dir;
    uint32_t dma_opcode;
    uint32_t dma_path;
    uint32_t dma_status;
    uint8_t has_dma;
    char dma_view[32];
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
#define {prefix}_MAX_POINTER_HINTS 256
/* Async DMA recovery never needs the full trace frontier at once; keep a
 * bounded working set here to avoid speculative state explosion. */
#define {prefix}_MAX_PENDING_ASYNC 256
/* Raw DMA aperture records are short-lived duplicates keyed by event tuple. */
#define {prefix}_MAX_PENDING_DMA 256
/* Semantic DMA context snapshots live longer than raw duplicates and are
 * reused by follow-up DMA events. */
#define {prefix}_MAX_PENDING_DMA_CONTEXT 64
#define {prefix}_MAX_PENDING_DMA_CONTEXT_CURSORS 64
/* Keep only a small best-first slice of the async DMA frontier when probing. */
#define {prefix}_PENDING_ASYNC_BEAM_WIDTH 16
/* Collapse same-trace async families only after the frontier grows past this
 * threshold, so small frontiers keep their original detail. */
#define {prefix}_PENDING_ASYNC_TRACE_COMPACT_THRESHOLD 32

struct dl_pointer_hint {{
    uint64_t addr;
    int target_type;
    uint32_t score;
}};

struct dl_pending_dma {{
    /* Duplicate aperture-complete records are consumed once and discarded. */
    uint64_t addr;
    uint32_t len;
    uint32_t dir;
    uint32_t op;
    uint32_t path;
    uint32_t status;
    char data[1024];
}};

struct dl_cursor {{
    int machine;
    int state;
    int trace;
    int step;
    int call_depth;
    uint32_t score;
    uint8_t probe_mode;
    uint8_t probe_budget;
    uint64_t scratch[{prefix}_MAX_SCRATCH];
    uint8_t scratch_valid[{prefix}_MAX_SCRATCH];
    uint64_t symbols[{prefix}_MAX_SYMBOLS];
    uint8_t symbol_valid[{prefix}_MAX_SYMBOLS];
    int return_steps[32];
    int return_traces[32];
    int return_bindings[32];
}};

struct dl_pending_dma_context {{
    /* Successful DMA map recovery snapshots live here until the matching
     * follow-up event arrives, so later unmap/complete events do not need to
     * rebuild state from the full async frontier. */
    uint64_t addr;
    uint32_t len;
    uint32_t dir;
    uint32_t path;
    uint32_t next_op;
    struct dl_cursor active[{prefix}_MAX_PENDING_DMA_CONTEXT_CURSORS];
    size_t active_count;
    struct dl_cursor matched[{prefix}_MAX_PENDING_DMA_CONTEXT_CURSORS];
    size_t matched_count;
}};

struct {self.symbol_prefix}_machine {{
    struct dl_cursor active[{prefix}_MAX_CURSORS];
    size_t active_count;
    struct dl_cursor matched[{prefix}_MAX_CURSORS];
    size_t matched_count;
    int booting_complete;
    struct dl_cursor booting_resume;
    int booting_resume_state;
    int booting_resume_valid;
    int runtime_started;
    int probe_mode;
    struct dl_pointer_hint pointer_hints[{prefix}_MAX_POINTER_HINTS];
    size_t pointer_hint_count;
    /* Queue-notify builds an async frontier here; DMA replay may probe it. */
    struct dl_cursor pending_async[{prefix}_MAX_PENDING_ASYNC];
    size_t pending_async_count;
    /* Prevent a speculative DMA probe from recursively re-entering the same
     * async fallback on one event. */
    int pending_async_reentry;
    /* Raw duplicate DMA records from the aperture path. */
    struct dl_pending_dma pending_dma[{prefix}_MAX_PENDING_DMA];
    size_t pending_dma_count;
    /* Reusable semantic DMA contexts keyed by tuple. */
    struct dl_pending_dma_context
        pending_dma_contexts[{prefix}_MAX_PENDING_DMA_CONTEXT];
    size_t pending_dma_context_count;
    uint32_t queue_desc_lo;
    uint32_t queue_desc_hi;
    uint8_t queue_desc_lo_valid;
    uint8_t queue_desc_hi_valid;
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
                List[Tuple[str, int, int]],
            ]
        ],
        header_name: str,
    ) -> str:
        def find_mmio_signature_mask(
            kind: str,
            offset: int,
        ) -> int:
            for steps, exprs, *_rest in compiled:
                for step in steps:
                    if step.kind != kind or step.addr < 0:
                        continue
                    if self.expr_mmio_offset_hint(exprs[step.addr]) == offset:
                        return step.mmio_signature_mask
            return 0

        status_read_signature = find_mmio_signature_mask("read", 112)
        status_write_signature = find_mmio_signature_mask("write", 112)
        queue_notify_write_signature = find_mmio_signature_mask("write", 80)

        lines: List[str] = []
        lines.append(f'#include "{header_name}"')
        lines.append("")
        lines.append("#include <stdbool.h>")
        lines.append("#include <ctype.h>")
        lines.append("#include <stdio.h>")
        lines.append("#include <stdlib.h>")
        lines.append("#include <stdint.h>")
        lines.append("#include <string.h>")
        lines.append("")
        lines.append("enum dl_step_kind { DL_STEP_EPS, DL_STEP_READ, DL_STEP_WRITE, DL_STEP_DMA, DL_STEP_BRANCH, DL_STEP_WILDCARD, DL_STEP_ASSIGN, DL_STEP_CALL, DL_STEP_END };")
        lines.append("enum dl_expr_kind { DL_EXPR_ANY, DL_EXPR_CONST, DL_EXPR_SCRATCH, DL_EXPR_SYMBOL, DL_EXPR_ADD, DL_EXPR_SUB, DL_EXPR_AND, DL_EXPR_OR, DL_EXPR_SHL, DL_EXPR_LSHR, DL_EXPR_EQ, DL_EXPR_NE, DL_EXPR_ULT, DL_EXPR_ULE, DL_EXPR_UGT, DL_EXPR_UGE, DL_EXPR_SLT, DL_EXPR_SLE, DL_EXPR_SGT, DL_EXPR_SGE };")
        lines.append("")
        lines.append("struct dl_expr { int kind; uint64_t value; int scratch; int symbol; int64_t offset; int lhs_idx; int rhs_idx; };")
        lines.append("struct dl_step { int kind; int width; int addr; int value; int scratch; int call_trace; int arg_count; int call_args[8]; int next_a; int next_b; int trace; int block; int dma_op; int dma_dir; int dma_path; int dma_data_kind; int dma_data_type; int dma_field_start; int dma_field_count; uint64_t mmio_signature_mask; int reachable_mask; uint64_t reachable_signature_mask; };")
        lines.append("struct dl_trace_meta { const char *name; const char **blocks; size_t nr_blocks; int start_step; int first_dma_step; const int *param_symbols; size_t nr_param_symbols; int return_scratch; int return_constant; };")
        lines.append("struct dl_transition { int src_state; int dst_state; int trace; int start_offset; };")
        lines.append("struct dl_machine_meta { const char *phase; const struct dl_trace_meta *traces; size_t nr_traces; const int *start_steps; size_t nr_start_steps; const char **states; size_t nr_states; const struct dl_transition *transitions; size_t nr_transitions; const struct dl_expr *exprs; size_t nr_exprs; int initial_state; const char **scratch_names; size_t nr_scratch; const char **dma_type_names; size_t nr_dma_types; };")
        lines.append("struct dl_schema_range { uint64_t lo; uint64_t hi; };")
        lines.append("struct dl_schema_bit { int start; int end; int has_value; uint64_t value; };")
        lines.append("struct dl_schema_field_meta { const char *name; int offset; int size; const struct dl_schema_range *imm_values; size_t nr_imm_values; const struct dl_schema_range *imm_ranges; size_t nr_imm_ranges; const struct dl_schema_bit *bits; size_t nr_bits; };")
        lines.append("struct dl_schema_meta { const char *name; int size; const struct dl_schema_field_meta *fields; size_t nr_fields; };")
        lines.append("struct dl_mmio_meta { int event_kind; uint64_t offset; int size; const char *schema_name; };")
        lines.append("struct dl_pointer_meta { const char *source_type; const char *source_field; int align; const char **target_types; size_t nr_targets; };")
        lines.append("static const struct dl_step *dl_steps_for_machine(size_t machine_index);")
        lines.append("static size_t dl_nr_steps_for_machine(size_t machine_index);")
        lines.append("static int dl_find_dma_type_id(const struct dl_machine_meta *machine_meta, const char *name);")
        lines.append("static int dl_find_symbol_id(const char *name);")
        lines.append("static int dl_find_matching_dma_step_in_trace(const struct dl_machine_meta *machine_meta, int machine_index, int trace_idx, const struct dl_cursor *seed, const struct devilang_event *event);")
        lines.append("static int dl_schema_matches_bytes(const struct dl_schema_meta *schema, const uint8_t *bytes, size_t len);")
        lines.append("static int dl_step_kind_mask(const struct dl_step *step);")
        lines.append("static int dl_trace_pause_unknown_post_event_branch(const char *trace_name);")
        lines.append("static int dl_trace_prefers_status_distance_guidance(const char *trace_name);")
        lines.append("static void dl_activate_booting_resume(struct %s_machine *machine);" % self.symbol_prefix)
        lines.append("static void dl_pointer_hint_add(struct %s_machine *machine, uint64_t addr, int target_type, uint32_t score);" % self.symbol_prefix)
        lines.append("static int dl_observable_step_matches_event(const struct dl_machine_meta *machine_meta, const struct dl_step *step, const struct dl_cursor *cursor, const struct devilang_event *event);")
        lines.append("static void dl_expand_cursor(const struct dl_machine_meta *machine_meta, int machine_idx, const struct dl_step *steps, const struct dl_cursor *cursor, struct dl_cursor *out, size_t *out_count, int target_event_kind, uint64_t target_event_signature, const struct devilang_event *event);")
        lines.append("static int dl_dma_path_matches(uint32_t step_path, uint32_t event_path);")
        lines.append("static int dl_debug_dma_enabled(void);")
        lines.append("static int dl_symbol_name_has_suffix(const char *name, const char *suffix);")
        lines.append("static void dl_seed_cursor_from_dma_event(const struct dl_machine_meta *machine_meta, struct dl_cursor *cursor, const struct devilang_event *event);")
        lines.append("static int dl_trace_runtime_queue_hint(const char *trace_name);")
        lines.append("static int dl_find_matching_mmio_step_in_trace(int machine_index, int trace_idx, const struct dl_cursor *seed, const struct devilang_event *event);")
        lines.append("static void dl_record_pending_async_notify(struct %s_machine *machine, const struct dl_cursor *cursors, size_t count, int queue_hint);" % self.symbol_prefix)
        lines.append("static void dl_append_pending_async_returns(struct %s_machine *machine, const struct dl_cursor *cursors, size_t count, int queue_hint);" % self.symbol_prefix)
        lines.append("static void dl_build_pending_async_dma_frontiers(struct %s_machine *machine);" % self.symbol_prefix)
        lines.append("static void dl_compact_pending_async_by_trace_name(struct %s_machine *machine);" % self.symbol_prefix)
        lines.append("static void dl_push_pending_async_seed(struct %s_machine *machine, const struct dl_cursor *cursor);" % self.symbol_prefix)
        lines.append("static int dl_try_pending_async_dma(struct %s_machine *machine, const struct devilang_event *event);" % self.symbol_prefix)
        lines.append("static int dl_trace_probe_supports_event(const struct dl_machine_meta *machine_meta, size_t machine_index, int trace_idx, const struct devilang_event *event);")
        lines.append("static size_t dl_count_active_followup_dma_support(const struct dl_machine_meta *machine_meta, size_t machine_index, const struct %s_machine *machine, const struct devilang_event *event);" % self.symbol_prefix)
        lines.append("static void dl_filter_active_to_followup_dma_support(const struct dl_machine_meta *machine_meta, size_t machine_index, struct %s_machine *machine, const struct devilang_event *event);" % self.symbol_prefix)
        lines.append("static void dl_record_pending_dma_duplicate(struct %s_machine *machine, const struct devilang_event *event);" % self.symbol_prefix)
        lines.append("static int dl_consume_pending_dma_duplicate(struct %s_machine *machine, const struct devilang_event *event);" % self.symbol_prefix)
        lines.append("static void dl_record_pending_dma_context(struct %s_machine *machine, const struct devilang_event *event);" % self.symbol_prefix)
        lines.append("static int dl_resume_pending_dma_context(struct %s_machine *machine, const struct devilang_event *event);" % self.symbol_prefix)
        lines.append("")

        schema_names = sorted(self.struct_schemas)
        for schema_name in schema_names:
            schema = self.struct_schemas[schema_name]
            for field_idx, field in enumerate(schema.fields):
                lines.append(
                    "static const struct dl_schema_range %s_schema_%s_field_%d_imm_values[] = { %s };"
                    % (
                        self.symbol_prefix,
                        schema_name,
                        field_idx,
                        ", ".join(
                            "{%s, %s}" % (
                                self.render_u64_literal(value),
                                self.render_u64_literal(value),
                            )
                            for value in field.immediate_values
                        ) if field.immediate_values else "{0ULL, 0ULL}",
                    )
                )
                lines.append(
                    "static const struct dl_schema_range %s_schema_%s_field_%d_imm_ranges[] = { %s };"
                    % (
                        self.symbol_prefix,
                        schema_name,
                        field_idx,
                        ", ".join(
                            "{%s, %s}" % (
                                self.render_u64_literal(lo),
                                self.render_u64_literal(hi),
                            )
                            for lo, hi in field.immediate_ranges
                        ) if field.immediate_ranges else "{0ULL, 0ULL}",
                    )
                )
                lines.append(
                    "static const struct dl_schema_bit %s_schema_%s_field_%d_bits[] = { %s };"
                    % (
                        self.symbol_prefix,
                        schema_name,
                        field_idx,
                        ", ".join(
                            "{%d, %d, %d, %s}" % (
                                bit.start,
                                bit.end,
                                1 if bit.value is not None else 0,
                                self.render_u64_literal(bit.value or 0),
                            )
                            for bit in field.bit_constraints
                        ) if field.bit_constraints else "{0, 0, 0, 0ULL}",
                    )
                )
            lines.append(
                "static const struct dl_schema_field_meta %s_schema_%s_fields[] = {"
                % (self.symbol_prefix, schema_name)
            )
            for field_idx, field in enumerate(schema.fields):
                lines.append(
                    '    {"%s", %d, %d, %s_schema_%s_field_%d_imm_values, %d, %s_schema_%s_field_%d_imm_ranges, %d, %s_schema_%s_field_%d_bits, %d},'
                    % (
                        field.name.replace('"', '\\"'),
                        field.offset,
                        field.size,
                        self.symbol_prefix,
                        schema_name,
                        field_idx,
                        len(field.immediate_values),
                        self.symbol_prefix,
                        schema_name,
                        field_idx,
                        len(field.immediate_ranges),
                        self.symbol_prefix,
                        schema_name,
                        field_idx,
                        len(field.bit_constraints),
                    )
                )
            lines.append("};")
        lines.append(
            "static const struct dl_schema_meta %s_schemas[] = {"
            % self.symbol_prefix
        )
        for schema_name in schema_names:
            schema = self.struct_schemas[schema_name]
            lines.append(
                '    {"%s", %d, %s_schema_%s_fields, %d},'
                % (
                    schema_name.replace('"', '\\"'),
                    schema.size,
                    self.symbol_prefix,
                    schema_name,
                    len(schema.fields),
                )
            )
        lines.append("};")
        lines.append(
            "static const size_t %s_nr_schemas = sizeof(%s_schemas) / sizeof(%s_schemas[0]);"
            % (self.symbol_prefix, self.symbol_prefix, self.symbol_prefix)
        )
        lines.append("")
        mmio_entries: List[Tuple[str, int, int, str]] = []
        seen_mmio_entries: set[Tuple[str, int, int, str]] = set()
        for op in self.mmio_ops:
            schema_name = self.resolve_mmio_schema_name(op.name)
            if op.region != 0 or schema_name is None or schema_name not in self.struct_schemas:
                continue
            key = (op.direction, op.address, op.size, schema_name)
            if key in seen_mmio_entries:
                continue
            seen_mmio_entries.add(key)
            mmio_entries.append(key)
        lines.append(
            "static const struct dl_mmio_meta %s_mmio_ops[] = {"
            % self.symbol_prefix
        )
        for direction, address, size, schema_name in mmio_entries:
            lines.append(
                '    {%s, %s, %d, "%s"},'
                % (
                    "DEVILANG_EV_MMIO_READ"
                    if direction == "r"
                    else "DEVILANG_EV_MMIO_WRITE",
                    self.render_u64_literal(address),
                    size,
                    schema_name.replace('"', '\\"'),
                )
            )
        if not mmio_entries:
            lines.append('    {0, 0ULL, 0, ""},')
        lines.append("};")
        lines.append(
            "static const size_t %s_nr_mmio_ops = sizeof(%s_mmio_ops) / sizeof(%s_mmio_ops[0]);"
            % (self.symbol_prefix, self.symbol_prefix, self.symbol_prefix)
        )
        lines.append("")
        for idx, pointer in enumerate(self.pointer_schemas):
            lines.append(
                "static const char *%s_pointer_%d_targets[] = { %s };"
                % (
                    self.symbol_prefix,
                    idx,
                    ", ".join(
                        '"%s"' % target.replace('"', '\\"')
                        for target in pointer.target_types
                    ) if pointer.target_types else '""',
                )
            )
        lines.append(
            "static const struct dl_pointer_meta %s_pointers[] = {"
            % self.symbol_prefix
        )
        for idx, pointer in enumerate(self.pointer_schemas):
            lines.append(
                '    {"%s", "%s", %d, %s_pointer_%d_targets, %d},'
                % (
                    pointer.source_type.replace('"', '\\"'),
                    pointer.source_field.replace('"', '\\"'),
                    pointer.align,
                    self.symbol_prefix,
                    idx,
                    len(pointer.target_types),
                )
            )
        lines.append("};")
        lines.append(
            "static const size_t %s_nr_pointers = sizeof(%s_pointers) / sizeof(%s_pointers[0]);"
            % (self.symbol_prefix, self.symbol_prefix, self.symbol_prefix)
        )
        lines.append("")

        machine_dma_type_counts: List[int] = [0 for _ in machines]
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
            dma_field_values: List[str] = []
            dma_type_values: List[str] = []
            dma_type_ids: Dict[str, int] = {}
            for step in steps:
                if step.dma_data_type_name:
                    if step.dma_data_type_name not in dma_type_ids:
                        dma_type_ids[step.dma_data_type_name] = len(dma_type_values)
                        dma_type_values.append(step.dma_data_type_name)
                if step.dma_field_names:
                    step.dma_field_start = len(dma_field_values)
                    step.dma_field_count = len(step.dma_field_names)
                    dma_field_values.extend(step.dma_field_names)
                else:
                    step.dma_field_start = -1
                    step.dma_field_count = 0
            lines.append(
                "static const char *%s_machine_%d_dma_type_names[] = { %s };"
                % (
                    self.symbol_prefix,
                    machine_idx,
                    ", ".join(
                        '\"%s\"' % value.replace('\"', '\\\"')
                        for value in dma_type_values
                    ) if dma_type_values else '""',
                )
            )
            machine_dma_type_counts[machine_idx] = len(dma_type_values)
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
                    "dma": "DL_STEP_DMA",
                    "branch": "DL_STEP_BRANCH",
                    "wildcard": "DL_STEP_WILDCARD",
                    "assign": "DL_STEP_ASSIGN",
                    "call": "DL_STEP_CALL",
                    "end": "DL_STEP_END",
                }
                lines.append(
                    "    {%s, %d, %d, %d, %d, %d, %d, {%s}, %d, %d, %d, %d, %d, %d, %d, %d, %d, %d, %d, %s, %d, %s},"
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
                        step.dma_op,
                        step.dma_dir,
                        step.dma_path,
                        step.dma_data_kind,
                        dma_type_ids.get(step.dma_data_type_name, -1),
                        step.dma_field_start,
                        step.dma_field_count,
                        self.render_u64_literal(step.mmio_signature_mask),
                        step.reachable_mask,
                        self.render_u64_literal(step.reachable_signature_mask),
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
                first_dma_step = -1
                local_offset = 0
                for block in trace.blocks:
                    for line_idx, line in enumerate(block.lines):
                        if "dma_event(" in line:
                            first_dma_step = offset + local_offset + line_idx
                            break
                    if first_dma_step >= 0:
                        break
                    local_offset += len(block.lines) + 1
                lines.append(
                    '    {"%s", %s_machine_%d_trace_%d_blocks, %d, %d, %d, %s_machine_%d_trace_%d_params, %d, %d, %d},'
                    % (
                        trace.name.replace('"', '\\"'),
                        self.symbol_prefix,
                        machine_idx,
                        trace_idx,
                        len(trace.blocks),
                        offset,
                        first_dma_step,
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
                '    {"%s", %s_machine_%d_traces, %d, %s_machine_%d_start_steps, %d, %s_machine_%d_states, %d, %s_machine_%d_transitions, %d, %s_machine_%d_exprs, %d, %d, %s_machine_%d_scratch_names, %d, %s_machine_%d_dma_type_names, %d},'
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
                    self.symbol_prefix,
                    machine_idx,
                    machine_dma_type_counts[machine_idx],
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
            "static const int %s_symbol_ids_indvars_iv_next = %d;"
            % (
                self.symbol_prefix,
                self.symbol_ids.get("indvars_iv_next", -1),
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
            "static const int %s_symbol_ids_index = %d;"
            % (
                self.symbol_prefix,
                self.symbol_ids.get("index", -1),
            )
        )
        lines.append("")
        lines.append(
            "static const int %s_symbol_ids_inc30 = %d;"
            % (
                self.symbol_prefix,
                self.symbol_ids.get("inc30", -1),
            )
        )
        lines.append("")
        lines.append(
            "static const int %s_symbol_ids_queue_idx_067 = %d;"
            % (
                self.symbol_prefix,
                self.symbol_ids.get("queue_idx_067", -1),
            )
        )
        lines.append("")
        lines.append(
            "static const int %s_symbol_ids_queue_idx_phi = %d;"
            % (
                self.symbol_prefix,
                self.symbol_ids.get("phi(0, phi(queue_idx_067, queue_idx_067 + 1))", -1),
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
            "static const uint64_t %s_status_read_signature = %s;"
            % (
                self.symbol_prefix,
                self.render_u64_literal(status_read_signature),
            )
        )
        lines.append("")
        lines.append(
            "static const uint64_t %s_status_write_signature = %s;"
            % (
                self.symbol_prefix,
                self.render_u64_literal(status_write_signature),
            )
        )
        lines.append("")
        lines.append(
            "static const uint64_t %s_queue_notify_write_signature = %s;"
            % (
                self.symbol_prefix,
                self.render_u64_literal(queue_notify_write_signature),
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
"""#define DL_VM_QUEUE_NOTIFY_OFFSET 0x50ULL
#define DL_HP_DMA_EVENT_OFFSET 0x1c0ULL
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

static int dl_is_queue_notify_event(
    const struct devilang_event *event) {
    if (!event || event->kind != DEVILANG_EV_MMIO_WRITE ||
        event->addr < event->base) {
        return 0;
    }
    return (event->addr - event->base) == DL_VM_QUEUE_NOTIFY_OFFSET;
}

static int dl_queue_notify_queue_hint(
    const struct devilang_event *event) {
    if (!dl_is_queue_notify_event(event)) {
        return -1;
    }
    return (int)(event->value & 0xffffULL);
}

static int dl_trace_matches_runtime_queue_hint(
    const struct dl_cursor *cursor,
    int queue_hint) {
    const struct dl_machine_meta *meta;
    const char *trace_name;
    int trace_queue_hint;

    if (!cursor || queue_hint < 0) {
        return 1;
    }
    if (cursor->machine != 1 || cursor->trace < 0) {
        return 1;
    }
    meta = &%s_machines[cursor->machine];
    if ((size_t)cursor->trace >= meta->nr_traces) {
        return 1;
    }
    trace_name = meta->traces[cursor->trace].name;
    trace_queue_hint = dl_trace_runtime_queue_hint(trace_name);
    if (trace_queue_hint < 0) {
        return 1;
    }
    return trace_queue_hint == queue_hint;
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
        if (event->dma_path > 1u) {
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
            % self.symbol_prefix
        )
        lines.append("")
        lines.append(
            """static int dl_dma_hex_nibble(char ch) {
    if (ch >= '0' && ch <= '9') {
        return ch - '0';
    }
    if (ch >= 'a' && ch <= 'f') {
        return ch - 'a' + 10;
    }
    if (ch >= 'A' && ch <= 'F') {
        return ch - 'A' + 10;
    }
    return -1;
}"""
        )
        lines.append("")
        lines.append(
            """static size_t dl_dma_decode_bytes(
    const char *hex,
    uint8_t *out,
    size_t cap) {
    size_t len = 0;

    if (!hex || !out || cap == 0) {
        return 0;
    }
    while (hex[0] && hex[1] && len < cap) {
        int hi = dl_dma_hex_nibble(hex[0]);
        int lo = dl_dma_hex_nibble(hex[1]);
        if (hi < 0 || lo < 0) {
            break;
        }
        out[len++] = (uint8_t)((hi << 4) | lo);
        hex += 2;
    }
    return len;
}"""
        )
        lines.append("")
        lines.append(
            """static int dl_dma_all_zero(
    const uint8_t *bytes,
    size_t len) {
    for (size_t i = 0; i < len; ++i) {
        if (bytes[i] != 0) {
            return 0;
        }
    }
    return 1;
}"""
        )
        lines.append("")
        lines.append(
            """static uint64_t dl_load_le_value(
    const uint8_t *bytes,
    size_t size) {
    uint64_t value = 0;
    size_t limit = size > 8 ? 8 : size;
    for (size_t i = 0; i < limit; ++i) {
        value |= ((uint64_t)bytes[i]) << (i * 8u);
    }
    return value;
}"""
        )
        lines.append("")
        lines.append(
            """static int dl_value_in_ranges(
    uint64_t value,
    const struct dl_schema_range *ranges,
    size_t nr_ranges) {
    if (!ranges || nr_ranges == 0) {
        return 1;
    }
    for (size_t i = 0; i < nr_ranges; ++i) {
        if (value >= ranges[i].lo && value <= ranges[i].hi) {
            return 1;
        }
    }
    return 0;
}"""
        )
        lines.append("")
        lines.append(
            """static int dl_schema_field_matches_bytes(
    const struct dl_schema_field_meta *field,
    const uint8_t *field_bytes,
    size_t len) {
    uint64_t value;

    if (!field || !field_bytes) {
        return 0;
    }
    if ((size_t)field->size > len) {
        return 0;
    }
    value = dl_load_le_value(field_bytes, (size_t)field->size);
    if (field->nr_imm_values &&
        !dl_value_in_ranges(value, field->imm_values, field->nr_imm_values)) {
        return 0;
    }
    if (field->nr_imm_ranges &&
        !dl_value_in_ranges(value, field->imm_ranges, field->nr_imm_ranges)) {
        return 0;
    }
    for (size_t i = 0; i < field->nr_bits; ++i) {
        const struct dl_schema_bit *bit = &field->bits[i];
        uint64_t width;
        uint64_t mask;
        uint64_t actual;
        if (!bit->has_value) {
            continue;
        }
        if (bit->start < 0 || bit->end < bit->start) {
            continue;
        }
        width = (uint64_t)(bit->end - bit->start + 1);
        if (width >= 64) {
            mask = ~(uint64_t)0;
        } else {
            mask = ((uint64_t)1 << width) - 1u;
        }
        actual = (value >> bit->start) & mask;
        if (actual != (bit->value & mask)) {
            return 0;
        }
    }
    return 1;
}"""
        )
        lines.append("")
        lines.append(
            """static int dl_schema_field_matches(
    const struct dl_schema_field_meta *field,
    const uint8_t *bytes,
    size_t len) {
    if (!field || !bytes) {
        return 0;
    }
    if ((size_t)field->offset + (size_t)field->size > len) {
        return 0;
    }
    return dl_schema_field_matches_bytes(
        field, bytes + field->offset, len - (size_t)field->offset);
}"""
        )
        lines.append("")
        lines.append(
            """static const struct dl_schema_meta *dl_find_schema(
    const char *name) {
    if (!name || name[0] == '\\0') {
        return NULL;
    }
    for (size_t i = 0; i < """
            + f"{self.symbol_prefix}_nr_schemas"
            + """; ++i) {
        if (strcmp("""
            + f"{self.symbol_prefix}_schemas"
            + """[i].name, name) == 0) {
            return &"""
            + f"{self.symbol_prefix}_schemas"
            + """[i];
        }
    }
    return NULL;
}"""
        )
        lines.append("")
        lines.append(
            """static int dl_store_le_value_bytes(
    uint64_t value,
    uint8_t *out,
    size_t len,
    size_t cap) {
    if (!out || len == 0 || len > cap || len > sizeof(uint64_t)) {
        return 0;
    }
    for (size_t i = 0; i < len; ++i) {
        out[i] = (uint8_t)((value >> (i * 8U)) & 0xffU);
    }
    return 1;
}"""
        )
        lines.append("")
        lines.append(
            """static const struct dl_schema_meta *dl_find_mmio_schema_for_event(
    const struct devilang_event *event,
    size_t *out_size) {
    uint64_t offset;

    if (!event ||
        (event->kind != DEVILANG_EV_MMIO_READ &&
         event->kind != DEVILANG_EV_MMIO_WRITE) ||
        event->addr < event->base) {
        return NULL;
    }
    offset = event->addr - event->base;
    for (size_t i = 0; i < """
            + f"{self.symbol_prefix}_nr_mmio_ops"
            + """; ++i) {
        const struct dl_mmio_meta *meta = &"""
            + f"{self.symbol_prefix}_mmio_ops"
            + """[i];
        if (meta->event_kind != (int)event->kind ||
            meta->offset != offset) {
            continue;
        }
        if (event->width != 0 && meta->size != 0 &&
            event->width != (uint32_t)meta->size) {
            continue;
        }
        if (out_size) {
            *out_size = meta->size > 0 ? (size_t)meta->size : 0U;
        }
        return dl_find_schema(meta->schema_name);
    }
    return NULL;
}"""
        )
        lines.append("")
        lines.append(
            """static int dl_mmio_event_schema_matches(
    const struct devilang_event *event) {
    const struct dl_schema_meta *schema;
    uint8_t bytes[8];
    size_t len = 0;

    schema = dl_find_mmio_schema_for_event(event, &len);
    if (!schema) {
        return 1;
    }
    if (len == 0) {
        len = (size_t)schema->size;
    }
    if (!dl_store_le_value_bytes(event->value, bytes, len, sizeof(bytes))) {
        /* If the event cannot be encoded into the schema-width scratch
         * buffer, do not turn that limitation into a hard mismatch. */
        return 1;
    }
    if ((size_t)schema->size > len) {
        int matched_overlay = 0;
        for (size_t i = 0; i < schema->nr_fields; ++i) {
            if (dl_schema_field_matches_bytes(&schema->fields[i], bytes, len)) {
                matched_overlay = 1;
            }
        }
        return matched_overlay;
    }
    if ((size_t)schema->size != len) {
        return 0;
    }
    return dl_schema_matches_bytes(schema, bytes, len);
}"""
        )
        lines.append("")
        lines.append(
            """static int dl_find_dma_type_id(
    const struct dl_machine_meta *machine_meta,
    const char *name) {
    if (!machine_meta || !name || name[0] == '\\0') {
        return -1;
    }
    for (size_t i = 0; i < machine_meta->nr_dma_types; ++i) {
        if (strcmp(machine_meta->dma_type_names[i], name) == 0) {
            return (int)i;
        }
    }
    return -1;
}"""
        )
        lines.append("")
        lines.append(
            """static int dl_schema_matches_bytes(
    const struct dl_schema_meta *schema,
    const uint8_t *bytes,
    size_t len) {
    if (!schema || !bytes) {
        return 0;
    }
    if ((size_t)schema->size != len) {
        return 0;
    }
    for (size_t i = 0; i < schema->nr_fields; ++i) {
        if (!dl_schema_field_matches(&schema->fields[i], bytes, len)) {
            return 0;
        }
    }
    return 1;
}"""
        )
        lines.append("")
        lines.append(
            """static int dl_schema_read_field_u64(
    const struct dl_schema_meta *schema,
    const char *field_name,
    const uint8_t *bytes,
    size_t len,
    uint64_t *out) {
    if (!schema || !field_name || !bytes || !out) {
        return 0;
    }
    for (size_t i = 0; i < schema->nr_fields; ++i) {
        const struct dl_schema_field_meta *field = &schema->fields[i];
        if (strcmp(field->name, field_name) != 0) {
            continue;
        }
        if ((size_t)field->offset + (size_t)field->size > len) {
            return 0;
        }
        *out = dl_load_le_value(bytes + field->offset, (size_t)field->size);
        return 1;
    }
    return 0;
}"""
        )
        lines.append("")
        lines.append(
            """static void dl_pointer_hint_add(
    struct """
            + f"{self.symbol_prefix}_machine"
            + """ *machine,
    uint64_t addr,
    int target_type,
    uint32_t score) {
    if (!machine || target_type < 0 || addr == 0) {
        return;
    }
    for (size_t i = 0; i < machine->pointer_hint_count; ++i) {
        if (machine->pointer_hints[i].addr == addr &&
            machine->pointer_hints[i].target_type == target_type) {
            if (score > machine->pointer_hints[i].score) {
                machine->pointer_hints[i].score = score;
            }
            return;
        }
    }
    if (machine->pointer_hint_count >= """
            + self.symbol_prefix.upper()
            + """_MAX_POINTER_HINTS) {
        return;
    }
    machine->pointer_hints[machine->pointer_hint_count].addr = addr;
    machine->pointer_hints[machine->pointer_hint_count].target_type = target_type;
    machine->pointer_hints[machine->pointer_hint_count].score = score;
    machine->pointer_hint_count += 1;
}"""
        )
        lines.append("")
        lines.append(
            """static uint32_t dl_pointer_hint_score(
    const struct """
            + f"{self.symbol_prefix}_machine"
            + """ *machine,
    uint64_t addr,
    int target_type) {
    uint32_t best = 0;
    if (!machine || target_type < 0 || addr == 0) {
        return 0;
    }
    for (size_t i = 0; i < machine->pointer_hint_count; ++i) {
        if (machine->pointer_hints[i].addr == addr &&
            machine->pointer_hints[i].target_type == target_type &&
            machine->pointer_hints[i].score > best) {
            best = machine->pointer_hints[i].score;
        }
    }
    return best;
}"""
        )
        lines.append("")
        lines.append(
            """/* Pointer hints are a pruning aid, not a hard prerequisite:
 * if no hints have been recovered yet, keep typed-DMA traces alive rather
 * than treating "no hint" as a definitive mismatch. */
static int dl_trace_has_pointer_hint_target(
    const struct """
            + f"{self.symbol_prefix}_machine"
            + """ *machine,
    const struct dl_machine_meta *machine_meta,
    int machine_idx,
    int trace_index,
    int start_step,
    uint64_t dma_addr) {
    const struct dl_step *steps = dl_steps_for_machine((size_t)machine_idx);
    int end_step = -1;
    int saw_addr_hint = 0;
    int saw_typed_dma = 0;
    if (!machine || !machine_meta || !steps ||
        trace_index < 0 ||
        (size_t)trace_index >= machine_meta->nr_traces ||
        start_step < 0) {
        return 0;
    }
    for (size_t i = 0; i < machine->pointer_hint_count; ++i) {
        if (machine->pointer_hints[i].addr == dma_addr) {
            saw_addr_hint = 1;
            break;
        }
    }
    if ((size_t)(trace_index + 1) < machine_meta->nr_traces) {
        end_step = machine_meta->traces[trace_index + 1].start_step;
    }
    for (int step_index = start_step;
         step_index >= 0 && (end_step < 0 || step_index < end_step);
         ++step_index) {
        const struct dl_step *step = &steps[step_index];
        if (step->trace != trace_index) {
            break;
        }
        if (step->kind != DL_STEP_DMA || step->dma_data_type < 0) {
            continue;
        }
        saw_typed_dma = 1;
        if (dl_pointer_hint_score(machine, dma_addr, step->dma_data_type) > 0) {
            return 1;
        }
    }
    if (!saw_addr_hint && saw_typed_dma) {
        return 1;
    }
    return 0;
}"""
        )
        lines.append("")
        lines.append(
            """static void dl_record_pointer_hints(
    struct """
            + f"{self.symbol_prefix}_machine"
            + """ *machine,
    const struct dl_machine_meta *machine_meta,
    const char *type_name,
    const uint8_t *bytes,
    size_t len,
    uint32_t score) {
    const struct dl_schema_meta *schema;
    if (!machine || !machine_meta || !type_name || !bytes) {
        return;
    }
    schema = dl_find_schema(type_name);
    if (!schema) {
        return;
    }
    for (size_t i = 0; i < """
            + f"{self.symbol_prefix}_nr_pointers"
            + """; ++i) {
        const struct dl_pointer_meta *pointer = &"""
            + f"{self.symbol_prefix}_pointers"
            + """[i];
        uint64_t addr = 0;
        if (strcmp(pointer->source_type, type_name) != 0) {
            continue;
        }
        if (!dl_schema_read_field_u64(schema, pointer->source_field, bytes, len, &addr)) {
            continue;
        }
        if (pointer->align > 0) {
            uint64_t mask = ((uint64_t)1 << pointer->align) - 1u;
            addr &= ~mask;
        }
        for (size_t target = 0; target < pointer->nr_targets; ++target) {
            int target_type = dl_find_dma_type_id(machine_meta, pointer->target_types[target]);
            if (target_type >= 0) {
                dl_pointer_hint_add(machine, addr, target_type, score);
            }
        }
    }
}"""
        )
        lines.append("")
        lines.append(
            """static void dl_record_pointer_hints_from_event(
    struct """
            + f"{self.symbol_prefix}_machine"
            + """ *machine,
    const struct dl_machine_meta *machine_meta,
    int data_type,
    const struct devilang_event *event,
    uint32_t score) {
    uint8_t bytes[512];
    size_t actual_len;
    const char *type_name;

    if (!machine_meta || !event || data_type < 0 ||
        (size_t)data_type >= machine_meta->nr_dma_types ||
        event->dma_status != 0) {
        return;
    }
    type_name = machine_meta->dma_type_names[data_type];
    if (!type_name || type_name[0] == '\\0') {
        return;
    }
    /* The DMA buffer address itself is a typed pointer to this payload. */
    dl_pointer_hint_add(machine, event->dma_addr, data_type, score);
    actual_len = dl_dma_decode_bytes(event->dma_data, bytes, sizeof(bytes));
    if (actual_len == 0 && event->dma_len != 0) {
        return;
    }
    dl_record_pointer_hints(machine, machine_meta, type_name, bytes, actual_len, score);
}"""
        )
        lines.append("")
        lines.append(
            """static int dl_dma_kind_matches(
    int data_kind,
    const struct devilang_event *event) {
    uint8_t bytes[512];
    size_t actual_len;

    if (data_kind <= 0) {
        return 1;
    }
    if (!event || event->dma_status != 0) {
        return 0;
    }
    actual_len = dl_dma_decode_bytes(event->dma_data, bytes, sizeof(bytes));
    if (actual_len == 0 && event->dma_len != 0) {
        /* If the DMA payload cannot be decoded, do not turn that transport
         * limitation into a hard kind mismatch. */
        return 1;
    }

    switch (data_kind) {
    case 1:
        return actual_len > 0 || event->dma_len == 0;
    case 2:
        if (event->dma_len < 16 || (event->dma_len % 16) != 0 || actual_len < 16) {
            return 0;
        }
        return (bytes[12] & 0xfc) == 0;
    case 3:
        if (event->dma_len < 10 || actual_len < 10) {
            return 0;
        }
        return (bytes[1] & 0xf0) == 0;
    case 4:
        return event->dma_len >= 14 && actual_len >= 14;
    case 5:
        return dl_dma_all_zero(bytes, actual_len);
    case 6:
        return actual_len > 0 || event->dma_len == 0;
    case 7:
        if (event->dma_len < 12 || actual_len < 12) {
            return 0;
        }
        return (bytes[1] & 0xf0) == 0;
    case 8:
        if (event->dma_len < 20 || actual_len < 20) {
            return 0;
        }
        return (bytes[1] & 0xf0) == 0;
    case 9:
    case 10:
        return actual_len > 0 || event->dma_len == 0;
    case 11:
    case 12:
    case 13:
    case 14:
    case 15:
    case 16:
    case 17:
    case 18:
    case 19:
    case 20:
    case 21:
        return event->dma_len >= 14 && actual_len >= 14;
    default:
        return 0;
    }
}"""
        )
        lines.append("")
        lines.append(
            """static int dl_dma_type_matches(
    int data_type,
    const struct dl_machine_meta *machine_meta,
    const struct devilang_event *event) {
    const struct dl_schema_meta *schema;
    const char *type_name;
    uint8_t bytes[512];
    size_t actual_len;

    if (data_type < 0 || !machine_meta ||
        (size_t)data_type >= machine_meta->nr_dma_types) {
        return 1;
    }
    if (!event || event->dma_status != 0) {
        return 0;
    }
    type_name = machine_meta->dma_type_names[data_type];
    if (!type_name || type_name[0] == '\\0') {
        return 1;
    }
    actual_len = dl_dma_decode_bytes(event->dma_data, bytes, sizeof(bytes));
    if (actual_len == 0 && event->dma_len != 0) {
        /* If the DMA payload cannot be decoded, do not turn that transport
         * limitation into a hard type mismatch. */
        return 1;
    }
    schema = dl_find_schema(type_name);
    if (schema) {
        return dl_schema_matches_bytes(schema, bytes, actual_len);
    }
    return 1;
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
        strcmp(name, "ret") == 0 ||
        strncmp(name, "IS_ERR", 6) == 0) {
        return 1;
    }
    if (strncmp(name, "call", 4) == 0) {
        const char *suffix = name + 4;
        if (*suffix != 0) {
            while (*suffix != 0) {
                if (!isdigit((unsigned char)*suffix)) {
                    return 0;
                }
                ++suffix;
            }
            return 1;
        }
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
        dl_symbol_name_has_suffix(name, "_index") ||
        dl_symbol_name_has_suffix(name, ".offset") ||
        dl_symbol_name_has_suffix(name, ".len") ||
        dl_symbol_name_has_suffix(name, ".size") ||
        dl_symbol_name_has_suffix(name, ".width") ||
        dl_symbol_name_has_suffix(name, ".idx") ||
        dl_symbol_name_has_suffix(name, ".index")) {
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

    if (expr->kind == DL_EXPR_OR) {
        const struct dl_expr *lhs_expr = &exprs[expr->lhs_idx];
        const struct dl_expr *rhs_expr = &exprs[expr->rhs_idx];
        int shifted_expr = -1;
        int low_expr = -1;
        uint64_t shift_amount = 0;
        uint64_t low_mask;

        if (lhs_expr->kind == DL_EXPR_SHL &&
            lhs_expr->rhs_idx >= 0 &&
            exprs[lhs_expr->rhs_idx].kind == DL_EXPR_CONST) {
            shifted_expr = lhs_expr->lhs_idx;
            low_expr = expr->rhs_idx;
            shift_amount = exprs[lhs_expr->rhs_idx].value;
        } else if (rhs_expr->kind == DL_EXPR_SHL &&
                   rhs_expr->rhs_idx >= 0 &&
                   exprs[rhs_expr->rhs_idx].kind == DL_EXPR_CONST) {
            shifted_expr = rhs_expr->lhs_idx;
            low_expr = expr->lhs_idx;
            shift_amount = exprs[rhs_expr->rhs_idx].value;
        }

        if (shifted_expr >= 0 && low_expr >= 0 &&
            shift_amount > 0 && shift_amount < 64) {
            low_mask = (1ULL << shift_amount) - 1ULL;
            if (!dl_bind_expr(exprs, low_expr, cursor, target & low_mask)) {
                return 0;
            }
            return dl_bind_expr(exprs, shifted_expr, cursor, target >> shift_amount);
        }
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
            """static int dl_expr_is_unresolved_projection(
    const struct dl_expr *exprs,
    int expr_idx,
    const struct dl_cursor *cursor) {
    const struct dl_expr *expr;
    int lhs_known = 0;
    int rhs_known = 0;
    int lhs_unknown = 0;
    int rhs_unknown = 0;

    if (expr_idx < 0) {
        return 0;
    }
    expr = &exprs[expr_idx];
    switch (expr->kind) {
    case DL_EXPR_SYMBOL:
        return expr->symbol >= 0 &&
            !cursor->symbol_valid[expr->symbol];
    case DL_EXPR_CONST:
        return 1;
    case DL_EXPR_ADD:
    case DL_EXPR_SUB:
    case DL_EXPR_AND:
    case DL_EXPR_OR:
    case DL_EXPR_SHL:
    case DL_EXPR_LSHR:
        lhs_unknown = dl_expr_is_unresolved_projection(
            exprs, expr->lhs_idx, cursor);
        rhs_unknown = dl_expr_is_unresolved_projection(
            exprs, expr->rhs_idx, cursor);
        if (!lhs_unknown) {
            (void)dl_eval_expr(exprs, expr->lhs_idx, cursor, &lhs_known);
        }
        if (!rhs_unknown) {
            (void)dl_eval_expr(exprs, expr->rhs_idx, cursor, &rhs_known);
        }
        if (!lhs_unknown && !lhs_known) {
            return 0;
        }
        if (!rhs_unknown && !rhs_known) {
            return 0;
        }
        return lhs_unknown || rhs_unknown;
    default:
        return 0;
    }
}"""
        )
        lines.append("")
        lines.append(
            """static int dl_match_write_value(
    const struct dl_expr *exprs,
    int expr_idx,
    const struct dl_cursor *cursor,
    uint64_t value) {
    if (dl_match_value(exprs, expr_idx, cursor, value)) {
        return 1;
    }
    return dl_expr_is_unresolved_projection(exprs, expr_idx, cursor);
}"""
        )
        lines.append("")
        lines.append(
            """static int dl_match_dma_addr(
    const struct dl_expr *exprs,
    int expr_idx,
    struct dl_cursor *cursor,
    uint64_t addr) {
    int known = 0;

    if (dl_match_addr(exprs, expr_idx, cursor, addr)) {
        return 1;
    }
    (void)dl_eval_expr(exprs, expr_idx, cursor, &known);
    return !known;
}"""
        )
        lines.append("")
        lines.append(
            """static int dl_match_dma_len(
    const struct dl_expr *exprs,
    int expr_idx,
    const struct dl_cursor *cursor,
    uint64_t value) {
    int known = 0;

    if (dl_match_value(exprs, expr_idx, cursor, value)) {
        return 1;
    }
    (void)dl_eval_expr(exprs, expr_idx, cursor, &known);
    return !known;
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
    if (expr->kind == DL_EXPR_SYMBOL) {
        const char *name;
        if (expr->symbol < 0 ||
            cursor->symbol_valid[expr->symbol]) {
            return 0;
        }
        name = %s_symbol_names[expr->symbol];
        return strncmp(name, "IS_ERR", 6) == 0;
    }
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
            % self.symbol_prefix
        )
        lines.append("")
        lines.append(
            """static int dl_branch_backedge_is_pure_symbolic_loop(
    const struct dl_step *steps,
    const struct dl_cursor *cursor,
    const struct dl_step *step,
    int backedge_step) {
    int idx = backedge_step;
    int saw_assign = 0;

    if (!steps || !cursor || !step) {
        return 0;
    }
    if (backedge_step < 0 || backedge_step > cursor->step) {
        return 0;
    }

    for (int budget = 0; budget < 8; ++budget) {
        const struct dl_step *loop_step = &steps[idx];

        if (loop_step->trace != cursor->trace) {
            return 0;
        }
        if (idx == cursor->step) {
            return saw_assign;
        }
        if (loop_step->kind == DL_STEP_ASSIGN) {
            saw_assign = 1;
            idx = loop_step->next_a;
            continue;
        }
        if (loop_step->kind == DL_STEP_EPS ||
            loop_step->kind == DL_STEP_WILDCARD) {
            idx = loop_step->next_a;
            continue;
        }
        return 0;
    }

    return 0;
}"""
        )
        lines.append("")
        lines.append(
            """static int dl_expr_is_unknown_zero_field_flag(
    const struct dl_expr *exprs,
    int expr_idx,
    const struct dl_cursor *cursor) {
    const struct dl_expr *expr;

    if (expr_idx < 0) {
        return 0;
    }
    expr = &exprs[expr_idx];
    if (expr->kind != DL_EXPR_SYMBOL) {
        return 0;
    }
    if (expr->offset == 0) {
        return 0;
    }
    if (expr->symbol < 0 ||
        (size_t)expr->symbol >= %s_MAX_SYMBOLS) {
        return 0;
    }
    if (cursor->symbol_valid[expr->symbol]) {
        return 0;
    }
    return 1;
}"""
            % self.symbol_prefix.upper()
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
            """static int dl_cursor_shape_valid(
    const struct dl_cursor *cursor) {
    if (!cursor) {
        return 0;
    }
    if (cursor->call_depth < 0 || cursor->call_depth > 32) {
        return 0;
    }
    if (cursor->machine < 0 || (size_t)cursor->machine >= %d) {
        return 0;
    }
    return 1;
}"""
            % len(machines)
        )
        lines.append("")
        lines.append(
            """static int dl_cursor_equal(
    const struct dl_cursor *lhs,
    const struct dl_cursor *rhs) {
    if (!dl_cursor_shape_valid(lhs) || !dl_cursor_shape_valid(rhs)) {
        return 0;
    }
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
    const size_t nr_steps =
        cursor && cursor->machine >= 0
            ? dl_nr_steps_for_machine((size_t)cursor->machine)
            : 0;
    if (!dl_cursor_shape_valid(cursor) || cursor->step < 0) {
        return 1;
    }
    steps = dl_steps_for_machine(cursor->machine);
    if (!steps || nr_steps == 0 || (size_t)cursor->step >= nr_steps) {
        return 0;
    }
    return cursor->trace < 0 || steps[cursor->step].trace == cursor->trace;
}"""
        )
        lines.append("")
        lines.append(
            """static int dl_cursor_same_frame(
    const struct dl_cursor *lhs,
    const struct dl_cursor *rhs) {
    if (!dl_cursor_shape_valid(lhs) || !dl_cursor_shape_valid(rhs)) {
        return 0;
    }
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
            """static void dl_cursor_merge_relaxed_into(
    struct dl_cursor *dst,
    const struct dl_cursor *src) {
    if (src->score > dst->score) {
        dst->score = src->score;
    }
    for (size_t i = 0; i < %s_MAX_SCRATCH; ++i) {
        if (!dst->scratch_valid[i] && src->scratch_valid[i]) {
            dst->scratch[i] = src->scratch[i];
            dst->scratch_valid[i] = 1;
            continue;
        }
        if (dst->scratch_valid[i] && src->scratch_valid[i] &&
            dst->scratch[i] != src->scratch[i]) {
            dst->scratch_valid[i] = 0;
        }
    }
    for (size_t i = 0; i < %s_MAX_SYMBOLS; ++i) {
        if (!dst->symbol_valid[i] && src->symbol_valid[i]) {
            dst->symbols[i] = src->symbols[i];
            dst->symbol_valid[i] = 1;
            continue;
        }
        if (dst->symbol_valid[i] && src->symbol_valid[i] &&
            dst->symbols[i] != src->symbols[i]) {
            dst->symbol_valid[i] = 0;
        }
    }
}"""
            % (self.symbol_prefix.upper(), self.symbol_prefix.upper())
        )
        lines.append("")
        lines.append(
            """static void dl_compact_cursor_set_relaxed(
    struct dl_cursor *cursors,
    size_t *count) {
    size_t out_count = 0;

    if (!cursors || !count) {
        return;
    }
    for (size_t i = 0; i < *count; ++i) {
        int merged = 0;
        if (cursors[i].step < 0) {
            continue;
        }
        for (size_t j = 0; j < out_count; ++j) {
            if (!dl_cursor_same_frame(&cursors[j], &cursors[i])) {
                continue;
            }
            dl_cursor_merge_relaxed_into(&cursors[j], &cursors[i]);
            merged = 1;
            break;
        }
        if (!merged) {
            cursors[out_count++] = cursors[i];
        }
    }
    *count = out_count;
}"""
        )
        lines.append("")
        lines.append(
            """static void dl_push_cursor(
    struct dl_cursor *out,
    size_t *count,
    const struct dl_cursor *cursor) {
    if (!dl_cursor_shape_valid(cursor)) {
        return;
    }
    if (!dl_cursor_step_matches_trace(cursor)) {
        return;
    }
    for (size_t i = 0; i < *count; ++i) {
        if (dl_cursor_equal(&out[i], cursor)) {
            return;
        }
        if (dl_cursor_same_frame(&out[i], cursor)) {
            dl_cursor_merge_relaxed_into(&out[i], cursor);
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
            """/* Copy at most `cap` cursors and return the retained count. */
static size_t dl_copy_cursor_array(
    struct dl_cursor *dst,
    size_t cap,
    const struct dl_cursor *src,
    size_t count) {
    if (!dst || !src || cap == 0 || count == 0) {
        return 0;
    }
    if (count > cap) {
        count = cap;
    }
    memcpy(dst, src, sizeof(dst[0]) * count);
    return count;
}"""
        )
        lines.append("")
        lines.append(
            """/* Match semantic DMA context snapshots by the observed DMA
 * tuple plus the expected follow-up opcode. */
static int dl_pending_dma_context_matches_event(
    const struct dl_pending_dma_context *context,
    const struct devilang_event *event,
    uint32_t next_op) {
    if (!context || !event) {
        return 0;
    }
    return context->addr == event->dma_addr &&
           context->len == event->dma_len &&
           context->dir == event->dma_dir &&
           context->path == event->dma_path &&
           context->next_op == next_op;
}"""
        )
        lines.append("")
        lines.append(
            """/* DMA aperture submit/complete writes are observed before the
 * corresponding synthesized DMA event. Keep the raw record here so the later
 * event can be consumed without rebuilding it from MMIO state. */
static void dl_record_pending_dma_duplicate(
    struct %s_machine *machine,
    const struct devilang_event *event) {
    struct dl_pending_dma *slot;

    if (!machine || !event || event->kind != DEVILANG_EV_DMA) {
        return;
    }
    if (machine->pending_dma_count >= %s_MAX_PENDING_DMA) {
        return;
    }
    slot = &machine->pending_dma[machine->pending_dma_count++];
    memset(slot, 0, sizeof(*slot));
    slot->addr = event->dma_addr;
    slot->len = event->dma_len;
    slot->dir = event->dma_dir;
    slot->op = event->dma_opcode;
    slot->path = event->dma_path;
    slot->status = event->dma_status;
    strncpy(slot->data, event->dma_data, sizeof(slot->data) - 1);
    slot->data[sizeof(slot->data) - 1] = '\\0';
}"""
            % (
                self.symbol_prefix,
                self.symbol_prefix.upper(),
            )
        )
        lines.append("")
        lines.append(
            """/* Raw duplicate records are cheaper than semantic contexts:
 * if the synthesized DMA event is literally the aperture record we already
 * captured, consume it directly and advance matching cursors in place. */
static int dl_consume_pending_dma_duplicate(
    struct %s_machine *machine,
    const struct devilang_event *event) {
    if (!machine || !event || event->kind != DEVILANG_EV_DMA) {
        return 0;
    }
    for (size_t i = 0; i < machine->pending_dma_count; ++i) {
        struct dl_pending_dma *slot = &machine->pending_dma[i];
        if (slot->addr != event->dma_addr ||
            slot->len != event->dma_len ||
            slot->dir != event->dma_dir ||
            slot->op != event->dma_opcode ||
            !dl_dma_path_matches(slot->path, event->dma_path) ||
            slot->status != event->dma_status) {
            continue;
        }
        if (strcmp(slot->data, event->dma_data) != 0) {
            continue;
        }
        if (machine->active_count > 0) {
            struct dl_cursor *next = calloc(%s_MAX_CURSORS, sizeof(*next));
            size_t next_count = 0;

            if (!next) {
                /* Keep the duplicate pending so the generic DMA path can
                 * still reason about this event without consuming state. */
                return 0;
            }

            for (size_t active_index = 0;
                 active_index < machine->active_count;
                 ++active_index) {
                struct dl_cursor cursor = machine->active[active_index];
                const struct dl_machine_meta *meta;
                const struct dl_step *steps;
                const struct dl_step *step;
                if (cursor.machine < 0 || cursor.step < 0) {
                    dl_push_cursor(next, &next_count, &cursor);
                    continue;
                }
                meta = &%s_machines[cursor.machine];
                steps = dl_steps_for_machine((size_t)cursor.machine);
                if (!steps) {
                    dl_push_cursor(next, &next_count, &cursor);
                    continue;
                }
                step = &steps[cursor.step];
                if (step->kind == DL_STEP_DMA &&
                    dl_observable_step_matches_event(meta, step, &cursor, event)) {
                    cursor.step = step->next_a;
                    cursor.score += 2;
                }
                dl_push_cursor(next, &next_count, &cursor);
            }
            dl_compact_cursor_set_relaxed(next, &next_count);
            machine->active_count = next_count;
            memcpy(machine->active, next,
                   sizeof(machine->active[0]) * next_count);
            machine->matched_count = next_count;
            memcpy(machine->matched, next,
                   sizeof(machine->matched[0]) * next_count);
            free(next);
        } else {
            machine->matched_count = 0;
        }
        memmove(slot, slot + 1,
                sizeof(*slot) * (machine->pending_dma_count - i - 1));
        machine->pending_dma_count--;
        return 1;
    }
    return 0;
}"""
            % (
                self.symbol_prefix,
                self.symbol_prefix.upper(),
                self.symbol_prefix,
            )
        )
        lines.append("")
        lines.append(
            """static int dl_find_symbol_id(const char *name) {
    if (!name) {
        return -1;
    }
    for (size_t i = 0; i < %s_MAX_SYMBOLS; ++i) {
        if (strcmp(%s_symbol_names[i], name) == 0) {
            return (int)i;
        }
    }
    return -1;
}"""
            % (
                self.symbol_prefix.upper(),
                self.symbol_prefix,
            )
        )
        lines.append("")
        lines.append(
            """/* Successful DMA replay seeds a semantic context snapshot here.
 * Matching follow-up DMA events can resume directly from this snapshot.
 * This is the richer sibling of raw pending_dma duplicate records above. */
static void dl_record_pending_dma_context(
    struct %s_machine *machine,
    const struct devilang_event *event) {
    struct dl_pending_dma_context *slot;
    size_t active_count;
    size_t matched_count;

    if (!machine || !event || event->kind != DEVILANG_EV_DMA ||
        event->dma_opcode != %d ||
        machine->active_count == 0) {
        return;
    }
    slot = NULL;
    for (size_t i = 0; i < machine->pending_dma_context_count; ++i) {
        struct dl_pending_dma_context *candidate =
            &machine->pending_dma_contexts[i];
        if (dl_pending_dma_context_matches_event(
                candidate,
                event,
                %d)) {
            /* Refresh the existing tuple entry instead of stacking duplicate
             * semantic contexts for the same DMA lifecycle. */
            slot = candidate;
            break;
        }
    }
    if (!slot) {
        if (machine->pending_dma_context_count >= %s_MAX_PENDING_DMA_CONTEXT) {
            /* Keep older in-flight contexts intact on overflow instead of
             * silently evicting one and risking a later resume miss. */
            return;
        }
        slot =
            &machine->pending_dma_contexts[machine->pending_dma_context_count++];
    }
    memset(slot, 0, sizeof(*slot));
    slot->addr = event->dma_addr;
    slot->len = event->dma_len;
    slot->dir = event->dma_dir;
    slot->path = event->dma_path;
    slot->next_op = %d;
    active_count = dl_copy_cursor_array(
        slot->active,
        %s_MAX_PENDING_DMA_CONTEXT_CURSORS,
        machine->active,
        machine->active_count);
    matched_count = dl_copy_cursor_array(
        slot->matched,
        %s_MAX_PENDING_DMA_CONTEXT_CURSORS,
        machine->matched,
        machine->matched_count);
    slot->active_count = active_count;
    slot->matched_count = matched_count;
}"""
            % (
                self.symbol_prefix,
                DMA_OP_IDS["map"],
                DMA_OP_IDS["unmap"],
                self.symbol_prefix.upper(),
                DMA_OP_IDS["unmap"],
                self.symbol_prefix.upper(),
                self.symbol_prefix.upper(),
            )
        )
        lines.append("")
        lines.append(
            """/* Rehydrate a previously recorded semantic DMA snapshot when
 * the matching follow-up DMA event arrives. The snapshot is consumed once so
 * stale contexts do not accumulate across repeated DMA cycles. */
static int dl_resume_pending_dma_context(
    struct %s_machine *machine,
    const struct devilang_event *event) {
    if (!machine || !event || event->kind != DEVILANG_EV_DMA) {
        return 0;
    }
    for (size_t i = 0; i < machine->pending_dma_context_count; ++i) {
        struct dl_pending_dma_context *slot =
            &machine->pending_dma_contexts[i];
        if (!dl_pending_dma_context_matches_event(
                slot,
                event,
                event->dma_opcode)) {
            continue;
        }
        machine->active_count = dl_copy_cursor_array(
            machine->active,
            %s_MAX_CURSORS,
            slot->active,
            slot->active_count);
        machine->matched_count = dl_copy_cursor_array(
            machine->matched,
            %s_MAX_CURSORS,
            slot->matched,
            slot->matched_count);
        memmove(slot,
                slot + 1,
                sizeof(*slot) * (machine->pending_dma_context_count - i - 1));
        machine->pending_dma_context_count--;
        return 1;
    }
    return 0;
}"""
            % (
                self.symbol_prefix,
                self.symbol_prefix.upper(),
                self.symbol_prefix.upper(),
            )
        )
        lines.append("")
        lines.append(
            """static int dl_find_matching_mmio_step_in_trace(
    int machine_index,
    int trace_idx,
    const struct dl_cursor *seed,
    const struct devilang_event *event) {
    const struct dl_machine_meta *machine_meta;
    const struct dl_step *steps;
    const struct dl_trace_meta *trace_meta;
    size_t nr_steps;

    if (!seed || !event || machine_index < 0 || trace_idx < 0) {
        return -1;
    }
    if (event->kind != DEVILANG_EV_MMIO_READ &&
        event->kind != DEVILANG_EV_MMIO_WRITE) {
        return -1;
    }
    machine_meta = &%s_machines[machine_index];
    if ((size_t)trace_idx >= machine_meta->nr_traces) {
        return -1;
    }
    steps = dl_steps_for_machine((size_t)machine_index);
    nr_steps = dl_nr_steps_for_machine((size_t)machine_index);
    trace_meta = &machine_meta->traces[trace_idx];
    if (!steps || nr_steps == 0 || trace_meta->start_step < 0 ||
        (size_t)trace_meta->start_step >= nr_steps) {
        return -1;
    }
    for (size_t step_idx = (size_t)trace_meta->start_step;
         step_idx < nr_steps;
         ++step_idx) {
        struct dl_cursor local = *seed;
        if (steps[step_idx].trace != trace_idx) {
            if ((int)step_idx > trace_meta->start_step) {
                break;
            }
            continue;
        }
        if (steps[step_idx].kind != DL_STEP_READ &&
            steps[step_idx].kind != DL_STEP_WRITE) {
            continue;
        }
        local.step = (int)step_idx;
        dl_bind_event_base(&local, event);
        if (dl_observable_step_matches_event(
                machine_meta,
                &steps[step_idx],
                &local,
                event)) {
            return (int)step_idx;
        }
    }
    return -1;
}"""
            % self.symbol_prefix
        )
        lines.append("")
        lines.append(
            """static int dl_find_matching_dma_step_in_trace(
    const struct dl_machine_meta *machine_meta,
    int machine_index,
    int trace_idx,
    const struct dl_cursor *seed,
    const struct devilang_event *event) {
    const struct dl_step *steps;
    const struct dl_trace_meta *trace_meta;
    size_t nr_steps;

    if (!machine_meta || !seed || !event || trace_idx < 0 ||
        (size_t)trace_idx >= machine_meta->nr_traces) {
        return -1;
    }
    steps = dl_steps_for_machine((size_t)machine_index);
    nr_steps = dl_nr_steps_for_machine((size_t)machine_index);
    trace_meta = &machine_meta->traces[trace_idx];
    if (!steps || nr_steps == 0 || trace_meta->start_step < 0 ||
        (size_t)trace_meta->start_step >= nr_steps) {
        return -1;
    }
    for (size_t step_idx = (size_t)trace_meta->start_step;
         step_idx < nr_steps;
         ++step_idx) {
        struct dl_cursor local = *seed;
        if (steps[step_idx].trace != trace_idx) {
            if ((int)step_idx > trace_meta->start_step) {
                break;
            }
            continue;
        }
        if (steps[step_idx].kind != DL_STEP_DMA) {
            continue;
        }
        local.step = (int)step_idx;
        if (dl_observable_step_matches_event(
                machine_meta,
                &steps[step_idx],
                &local,
                event)) {
            return (int)step_idx;
        }
    }
    return -1;
}"""
        )
        lines.append("")
        lines.append(
            """/* All replay-side DMA/MMIO diagnostics must stay behind this
 * explicit env-gated switch so normal workflow output remains quiet. */
static int dl_debug_dma_enabled(void) {
    static int cached = -1;
    if (cached == -1) {
        cached = getenv("MORPHEUS_DEVILANG_DEBUG_DMA") != NULL ? 1 : 0;
    }
    return cached;
}"""
        )
        lines.append("")
        lines.append(
            """static int dl_trace_index_from_step(
    const struct dl_machine_meta *machine_meta,
    int step);"""
        )
        lines.append("")
        lines.append(
            """static const char *dl_debug_trace_name(
    const struct dl_cursor *cursor) {
    const struct dl_machine_meta *meta;
    int trace_index;
    if (!cursor || cursor->machine < 0 ||
        (size_t)cursor->machine >= %d) {
        return "-";
    }
    meta = &%s_machines[cursor->machine];
    trace_index = cursor->trace;
    if (trace_index < 0 || (size_t)trace_index >= meta->nr_traces) {
        trace_index = dl_trace_index_from_step(meta, cursor->step);
    }
    if (trace_index < 0 || (size_t)trace_index >= meta->nr_traces) {
        return "-";
    }
    return meta->traces[trace_index].name;
}"""
            % (
                len(machines),
                self.symbol_prefix,
            )
        )
        lines.append("")
        lines.append(
            """static int dl_dma_path_matches(
    uint32_t step_path,
    uint32_t event_path) {
    return event_path == 0xffffffffu || step_path == event_path;
}"""
        )
        lines.append("")
        lines.append(
            """static int dl_name_is_dma_local(const char *name) {
    if (!name) {
        return 0;
    }
    return strcmp(name, "len") == 0 ||
           strcmp(name, "addr") == 0 ||
           strcmp(name, "direction") == 0 ||
           strcmp(name, "premapped") == 0 ||
           strcmp(name, "map_addr") == 0 ||
           strcmp(name, "dma_addr") == 0 ||
           strcmp(name, "dma_len") == 0 ||
           strcmp(name, "sg") == 0 ||
           dl_symbol_name_has_suffix(name, "_len") ||
           dl_symbol_name_has_suffix(name, "_addr") ||
           dl_symbol_name_has_suffix(name, "_direction") ||
           dl_symbol_name_has_suffix(name, "_premapped") ||
           dl_symbol_name_has_suffix(name, "_map_addr") ||
           dl_symbol_name_has_suffix(name, ".len") ||
           dl_symbol_name_has_suffix(name, ".addr") ||
           dl_symbol_name_has_suffix(name, ".direction") ||
           dl_symbol_name_has_suffix(name, ".premapped") ||
           dl_symbol_name_has_suffix(name, ".map_addr");
}"""
        )
        lines.append("")
        lines.append(
            """static void dl_seed_cursor_from_dma_event(
    const struct dl_machine_meta *machine_meta,
    struct dl_cursor *cursor,
    const struct devilang_event *event) {
    int symbol_id;
    if (!machine_meta || !cursor || !event || event->kind != DEVILANG_EV_DMA) {
        return;
    }
    for (size_t i = 0; i < machine_meta->nr_scratch; ++i) {
        const char *name = machine_meta->scratch_names[i];
        if (!name) {
            continue;
        }
        if (strcmp(name, "addr") == 0 ||
            strcmp(name, "dma_addr") == 0 ||
            strcmp(name, "map_addr") == 0) {
            cursor->scratch[i] = event->dma_addr;
            cursor->scratch_valid[i] = 1;
        } else if (strcmp(name, "len") == 0 ||
                   strcmp(name, "dma_len") == 0) {
            cursor->scratch[i] = event->dma_len;
            cursor->scratch_valid[i] = 1;
        } else if (strcmp(name, "direction") == 0) {
            cursor->scratch[i] = event->dma_dir;
            cursor->scratch_valid[i] = 1;
        }
    }
    symbol_id = dl_find_symbol_id("addr");
    if (symbol_id >= 0) {
        cursor->symbols[symbol_id] = event->dma_addr;
        cursor->symbol_valid[symbol_id] = 1;
    }
    symbol_id = dl_find_symbol_id("dma_addr");
    if (symbol_id >= 0) {
        cursor->symbols[symbol_id] = event->dma_addr;
        cursor->symbol_valid[symbol_id] = 1;
    }
    symbol_id = dl_find_symbol_id("map_addr");
    if (symbol_id >= 0) {
        cursor->symbols[symbol_id] = event->dma_addr;
        cursor->symbol_valid[symbol_id] = 1;
    }
    symbol_id = dl_find_symbol_id("len");
    if (symbol_id >= 0) {
        cursor->symbols[symbol_id] = event->dma_len;
        cursor->symbol_valid[symbol_id] = 1;
    }
    symbol_id = dl_find_symbol_id("dma_len");
    if (symbol_id >= 0) {
        cursor->symbols[symbol_id] = event->dma_len;
        cursor->symbol_valid[symbol_id] = 1;
    }
    symbol_id = dl_find_symbol_id("direction");
    if (symbol_id >= 0) {
        cursor->symbols[symbol_id] = event->dma_dir;
        cursor->symbol_valid[symbol_id] = 1;
    }
}"""
        )
        lines.append("")
        lines.append(
            """static void dl_clear_cursor_values(
    const struct dl_machine_meta *machine_meta,
    struct dl_cursor *cursor) {
    if (!cursor) {
        return;
    }
    for (size_t i = 0; i < %s_MAX_SCRATCH; ++i) {
        const char *name =
            machine_meta && i < machine_meta->nr_scratch
                ? machine_meta->scratch_names[i]
                : NULL;
        if (dl_name_is_dma_local(name)) {
            cursor->scratch_valid[i] = 0;
        }
    }
    for (size_t i = 0; i < %s_MAX_SYMBOLS; ++i) {
        const char *name = %s_symbol_names[i];
        if (dl_name_is_dma_local(name)) {
            cursor->symbol_valid[i] = 0;
        }
    }
}"""
            % (
                self.symbol_prefix.upper(),
                self.symbol_prefix.upper(),
                self.symbol_prefix,
            )
        )
        lines.append("")
        lines.append(
            """static int dl_event_kind_mask(int event_kind) {
    if (event_kind == DEVILANG_EV_MMIO_READ) {
        return 1;
    }
    if (event_kind == DEVILANG_EV_MMIO_WRITE) {
        return 2;
    }
    if (event_kind == DEVILANG_EV_DMA) {
        return 4;
    }
    return 0;
}"""
        )
        lines.append("")
        lines.append(
            """static int dl_trace_index_from_step(
    const struct dl_machine_meta *machine_meta,
    int step) {
    int best_trace = -1;
    int best_start = -1;

    if (!machine_meta || step < 0) {
        return -1;
    }
    for (size_t trace_index = 0; trace_index < machine_meta->nr_traces; ++trace_index) {
        const struct dl_trace_meta *trace = &machine_meta->traces[trace_index];
        if (trace->start_step < 0 || trace->start_step > step) {
            continue;
        }
        if (trace->start_step >= best_start) {
            best_start = trace->start_step;
            best_trace = (int)trace_index;
        }
    }
    return best_trace;
}"""
        )
        lines.append("")
        lines.append(
            """static void dl_sync_cursor_trace_from_step(
    const struct dl_machine_meta *machine_meta,
    struct dl_cursor *cursor) {
    int best_trace;

    if (!machine_meta || !cursor) {
        return;
    }
    best_trace = dl_trace_index_from_step(machine_meta, cursor->step);
    if (best_trace >= 0) {
        cursor->trace = best_trace;
    }
}"""
        )
        lines.append("")
        lines.append(
            """static const struct dl_machine_meta *dl_machine_meta_for_index(
    int machine_index) {
    if (machine_index < 0 || (size_t)machine_index >= %d) {
        return NULL;
    }
    return &%s_machines[machine_index];
}"""
            % (
                len(machines),
                self.symbol_prefix,
            )
        )
        lines.append("")
        lines.append(
            """static int dl_trace_name_is_notify_impl(const char *trace_name) {
    if (!trace_name) {
        return 0;
    }
    return strcmp(trace_name, "vm_notify_trace") == 0 ||
           strcmp(trace_name, "vm_notify_with_data_trace") == 0;
}"""
        )
        lines.append("")
        lines.append(
            """static void dl_compact_cursor_set_by_trace_step(
    struct dl_cursor *cursors,
    size_t *count) {
    struct dl_cursor *compacted = NULL;
    size_t compacted_count = 0;

    if (!cursors || !count) {
        return;
    }
    compacted = calloc(%s_MAX_CURSORS, sizeof(*compacted));
    if (!compacted) {
        return;
    }
    for (size_t i = 0; i < *count; ++i) {
        const struct dl_cursor *cursor = &cursors[i];
        size_t slot = compacted_count;

        for (size_t j = 0; j < compacted_count; ++j) {
            if (compacted[j].machine == cursor->machine &&
                compacted[j].trace == cursor->trace &&
                compacted[j].step == cursor->step) {
                slot = j;
                break;
            }
        }
        if (slot == compacted_count) {
            compacted[compacted_count++] = *cursor;
            continue;
        }
        if (cursor->score > compacted[slot].score ||
            (cursor->score == compacted[slot].score &&
             cursor->call_depth < compacted[slot].call_depth)) {
            compacted[slot] = *cursor;
        }
    }
    memcpy(cursors, compacted, sizeof(compacted[0]) * compacted_count);
    *count = compacted_count;
    free(compacted);
}"""
            % self.symbol_prefix.upper()
        )
        lines.append("")
        lines.append(
            """static void dl_filter_cursor_set_to_notify_impl(
    struct dl_cursor *cursors,
    size_t *count) {
    size_t write_index = 0;

    if (!cursors || !count) {
        return;
    }
    for (size_t i = 0; i < *count; ++i) {
        if (!dl_trace_name_is_notify_impl(
                dl_debug_trace_name(&cursors[i]))) {
            continue;
        }
        cursors[write_index++] = cursors[i];
    }
    *count = write_index;
}"""
        )
        lines.append("")
        lines.append(
            """static void dl_filter_cursor_set_by_runtime_queue_hint(
    struct dl_cursor *cursors,
    size_t *count,
    int queue_hint) {
    size_t write_index = 0;

    if (!cursors || !count || queue_hint < 0) {
        return;
    }
    for (size_t i = 0; i < *count; ++i) {
        if (!dl_trace_matches_runtime_queue_hint(&cursors[i], queue_hint)) {
            continue;
        }
        cursors[write_index++] = cursors[i];
    }
    *count = write_index;
}"""
        )
        lines.append("")
        lines.append(
            """/* Normalize one cursor into a replayable async seed by
 * stripping probe-only state and local scratch bindings. */
static void dl_push_pending_async_seed(
    struct %s_machine *machine,
    const struct dl_cursor *cursor) {
    struct dl_cursor copy;

    if (!machine || !cursor || cursor->machine < 0) {
        return;
    }
    copy = *cursor;
    copy.probe_mode = 0;
    copy.probe_budget = 0;
    dl_clear_cursor_values(&%s_machines[copy.machine], &copy);
    dl_push_cursor(machine->pending_async,
                   &machine->pending_async_count,
                   &copy);
}"""
            % (
                self.symbol_prefix,
                self.symbol_prefix,
            )
        )
        lines.append("")
        lines.append(
            """/* Queue notify snapshots the currently active notify-side
 * cursors. Later DMA replay starts from these snapshots instead of rebuilding
 * from every runtime entry surface. */
static void dl_record_pending_async_notify(
    struct %s_machine *machine,
    const struct dl_cursor *cursors,
    size_t count,
    int queue_hint) {
    if (!machine) {
        return;
    }
    if (!cursors) {
        return;
    }
    machine->pending_async_count = 0;
    for (size_t i = 0; i < count; ++i) {
        struct dl_cursor copy;
        if (cursors[i].step < 0) {
            continue;
        }
        if (!dl_trace_matches_runtime_queue_hint(&cursors[i], queue_hint)) {
            continue;
        }
        copy = cursors[i];
        dl_push_pending_async_seed(machine, &copy);
        if (machine->pending_async_count >= %s_MAX_PENDING_ASYNC) {
            break;
        }
    }
    dl_compact_cursor_set_relaxed(machine->pending_async,
                                  &machine->pending_async_count);
}"""
            % (
                self.symbol_prefix,
                self.symbol_prefix.upper(),
            )
        )
        lines.append("")
        lines.append(
            """/* Coarse trace-name filter used before more expensive probe
 * matching. This is intentionally broad and only separates map vs unmap
 * families. */
static int dl_trace_name_matches_dma_opcode(
    const char *trace_name,
    uint32_t dma_opcode) {
    if (!trace_name) {
        return 0;
    }
    if (dma_opcode == %d) {
        return strstr(trace_name, "vring_map") != NULL;
    }
    if (dma_opcode == %d) {
        return strstr(trace_name, "vring_unmap") != NULL;
    }
    return 0;
}"""
            % (
                DMA_OP_IDS["map"],
                DMA_OP_IDS["unmap"],
            )
        )
        lines.append("")
        lines.append(
            """/* Async DMA replay only needs traces that can plausibly
 * approach a later vring map/unmap operation. */
static int dl_trace_async_dma_seed_candidate(
    const char *trace_name) {
    if (!trace_name) {
        return 0;
    }
    return strstr(trace_name, "virtqueue_add") != NULL ||
           strstr(trace_name, "virtqueue_add_sgs") != NULL ||
           strstr(trace_name, "vring_map_one_sg") != NULL ||
           strstr(trace_name, "vring_map_single") != NULL ||
           strstr(trace_name, "vring_unmap") != NULL;
}"""
        )
        lines.append("")
        lines.append(
            """/* Reduce the async frontier to traces that can plausibly lead
 * to DMA, then collapse oversized same-trace families before probing. */
static void dl_filter_pending_async_to_dma_candidates(
    struct %s_machine *machine) {
    struct dl_cursor *filtered = calloc(%s_MAX_PENDING_ASYNC, sizeof(*filtered));
    size_t filtered_count = 0;
    int have_dma_seed = 0;

    if (!machine) {
        free(filtered);
        return;
    }
    if (!filtered) {
        return;
    }
    for (size_t i = 0; i < machine->pending_async_count; ++i) {
        if (dl_trace_async_dma_seed_candidate(
                dl_debug_trace_name(&machine->pending_async[i]))) {
            have_dma_seed = 1;
            break;
        }
    }
    if (dl_debug_dma_enabled()) {
        fprintf(stderr,
                "queue-notify filter-dma stage=seed-scan pending=%%zu have=%%d\\n",
                machine->pending_async_count,
                have_dma_seed);
    }
    if (!have_dma_seed) {
        free(filtered);
        return;
    }
    for (size_t i = 0; i < machine->pending_async_count; ++i) {
        if (!dl_trace_async_dma_seed_candidate(
                dl_debug_trace_name(&machine->pending_async[i]))) {
            continue;
        }
        dl_push_cursor(filtered, &filtered_count, &machine->pending_async[i]);
    }
    if (dl_debug_dma_enabled()) {
        fprintf(stderr,
                "queue-notify filter-dma stage=after-push filtered=%%zu\\n",
                filtered_count);
    }
    dl_compact_cursor_set_relaxed(filtered, &filtered_count);
    if (dl_debug_dma_enabled()) {
        fprintf(stderr,
                "queue-notify filter-dma stage=after-compact filtered=%%zu\\n",
                filtered_count);
    }
    memcpy(machine->pending_async,
           filtered,
           sizeof(filtered[0]) * filtered_count);
    machine->pending_async_count = filtered_count;
    if (dl_debug_dma_enabled()) {
        fprintf(stderr,
                "queue-notify filter-dma stage=after-copy pending=%%zu threshold=%%d\\n",
                machine->pending_async_count,
                %s_PENDING_ASYNC_TRACE_COMPACT_THRESHOLD);
    }
    /* Small frontiers keep their full per-trace detail. Once the frontier is
     * larger, collapse same-trace families before later trace-name compaction
     * and beam limiting run inside the probe path. */
    if (machine->pending_async_count <=
        %s_PENDING_ASYNC_TRACE_COMPACT_THRESHOLD) {
        free(filtered);
        return;
    }
    {
        struct dl_cursor *compacted =
            calloc(%s_MAX_PENDING_ASYNC, sizeof(*compacted));
        size_t compacted_count = 0;

        if (!compacted) {
            free(filtered);
            return;
        }

        for (size_t i = 0; i < machine->pending_async_count; ++i) {
            const struct dl_cursor *cursor = &machine->pending_async[i];
            size_t slot = compacted_count;

            for (size_t j = 0; j < compacted_count; ++j) {
                if (compacted[j].machine == cursor->machine &&
                    compacted[j].trace == cursor->trace) {
                    slot = j;
                    break;
                }
            }
            if (slot == compacted_count) {
                compacted[compacted_count++] = *cursor;
                continue;
            }
            if (cursor->score > compacted[slot].score ||
                (cursor->score == compacted[slot].score &&
                 cursor->call_depth < compacted[slot].call_depth) ||
                (cursor->score == compacted[slot].score &&
                 cursor->call_depth == compacted[slot].call_depth &&
                 cursor->step > compacted[slot].step)) {
                compacted[slot] = *cursor;
            }
        }
        dl_compact_cursor_set_relaxed(compacted, &compacted_count);
        if (dl_debug_dma_enabled()) {
            fprintf(stderr,
                    "queue-notify filter-dma stage=after-trace-compact compacted=%%zu\\n",
                    compacted_count);
        }
        memcpy(machine->pending_async,
               compacted,
               sizeof(compacted[0]) * compacted_count);
        machine->pending_async_count = compacted_count;
        free(compacted);
    }
    free(filtered);
}"""
            % (
                self.symbol_prefix,
                self.symbol_prefix.upper(),
                self.symbol_prefix.upper(),
                self.symbol_prefix.upper(),
                self.symbol_prefix.upper(),
            )
        )
        lines.append("")
        lines.append(
            """/* Some async frontiers contain many equivalent trace families.
 * Keep only the shallowest / highest-score representative per trace name
 * before the later beam limit runs.
 *
 * This intentionally stays as a helper instead of being inlined into
 * dl_try_pending_async_dma(): that probe path is stack-sensitive, and a past
 * inlining attempt caused the generated replay binary to crash. */
static void dl_compact_pending_async_by_trace_name(
    struct %s_machine *machine) {
    struct dl_cursor *compacted = NULL;
    size_t compacted_count = 0;

    if (!machine) {
        return;
    }
    compacted = calloc(%s_MAX_PENDING_ASYNC, sizeof(*compacted));
    if (!compacted) {
        return;
    }
    for (size_t i = 0; i < machine->pending_async_count; ++i) {
        const struct dl_cursor *cursor = &machine->pending_async[i];
        const char *trace_name = dl_debug_trace_name(cursor);
        size_t slot = compacted_count;

        for (size_t j = 0; j < compacted_count; ++j) {
            if (strcmp(dl_debug_trace_name(&compacted[j]), trace_name) == 0) {
                slot = j;
                break;
            }
        }
        if (slot == compacted_count) {
            compacted[compacted_count++] = *cursor;
            continue;
        }
        if (cursor->call_depth < compacted[slot].call_depth ||
            (cursor->call_depth == compacted[slot].call_depth &&
             cursor->score > compacted[slot].score) ||
            (cursor->call_depth == compacted[slot].call_depth &&
             cursor->score == compacted[slot].score &&
             cursor->step < compacted[slot].step)) {
            compacted[slot] = *cursor;
        }
    }
    memcpy(machine->pending_async,
           compacted,
           sizeof(compacted[0]) * compacted_count);
    machine->pending_async_count = compacted_count;
    free(compacted);
}"""
            % (
                self.symbol_prefix,
                self.symbol_prefix.upper(),
            )
        )
        lines.append("")
        lines.append(
            """/* Seed the async frontier with both the current frame and
 * caller-return frames so DMA replay can resume from the nearest useful
 * observable step. */
static void dl_append_pending_async_returns(
    struct %s_machine *machine,
    const struct dl_cursor *cursors,
    size_t count,
    int queue_hint) {
    if (!machine || !cursors) {
        return;
    }
    for (size_t i = 0; i < count; ++i) {
        struct dl_cursor frame = cursors[i];
        const struct dl_machine_meta *meta;
        if (frame.machine < 0) {
            continue;
        }
        if (!dl_trace_matches_runtime_queue_hint(&frame, queue_hint)) {
            continue;
        }
        meta = &%s_machines[frame.machine];
        if (frame.trace >= 0 &&
            (size_t)frame.trace < meta->nr_traces) {
            if (meta->traces[frame.trace].start_step >= 0 &&
                dl_trace_async_dma_seed_candidate(
                    meta->traces[frame.trace].name)) {
                struct dl_cursor start_frame = frame;
                start_frame.step = meta->traces[start_frame.trace].start_step;
                dl_push_pending_async_seed(machine, &start_frame);
            }
            if (frame.step >= 0) {
                dl_push_pending_async_seed(machine, &frame);
            }
        }
        while (frame.call_depth > 0 &&
               machine->pending_async_count < %s_MAX_PENDING_ASYNC) {
            frame.call_depth--;
            frame.trace = frame.return_traces[frame.call_depth];
            if (frame.trace < 0 ||
                (size_t)frame.trace >= meta->nr_traces) {
                continue;
            }
            if (meta->traces[frame.trace].start_step >= 0 &&
                dl_trace_async_dma_seed_candidate(
                    meta->traces[frame.trace].name)) {
                struct dl_cursor start_frame = frame;
                start_frame.step = meta->traces[start_frame.trace].start_step;
                dl_push_pending_async_seed(machine, &start_frame);
            }
            frame.step = frame.return_steps[frame.call_depth];
            if (frame.step >= 0) {
                dl_push_pending_async_seed(machine, &frame);
            }
        }
    }
    dl_compact_cursor_set_relaxed(machine->pending_async,
                                  &machine->pending_async_count);
}"""
            % (
                self.symbol_prefix,
                self.symbol_prefix,
                self.symbol_prefix.upper(),
            )
        )
        lines.append("")
        lines.append(
            """/* Expand the saved async seeds toward their next observable
 * DMA step. This keeps the later probe search local to likely continuations. */
static void dl_build_pending_async_dma_frontiers(
    struct %s_machine *machine) {
    struct dl_cursor *frontier = NULL;
    size_t frontier_count = 0;
    struct dl_cursor *original = NULL;
    size_t original_count = 0;

    if (!machine) {
        return;
    }
    frontier = calloc(%s_MAX_PENDING_ASYNC, sizeof(*frontier));
    if (!frontier) {
        return;
    }
    original = calloc(%s_MAX_PENDING_ASYNC, sizeof(*original));
    if (!original) {
        free(frontier);
        return;
    }
    original_count = machine->pending_async_count;
    if (original_count > %s_MAX_PENDING_ASYNC) {
        original_count = %s_MAX_PENDING_ASYNC;
    }
    if (original_count > 0) {
        memcpy(original,
               machine->pending_async,
               sizeof(original[0]) * original_count);
    }
    for (size_t i = 0; i < machine->pending_async_count; ++i) {
        const struct dl_cursor *base = &machine->pending_async[i];
        const struct dl_machine_meta *meta;
        const struct dl_step *steps;
        struct dl_cursor *out = NULL;
        size_t out_count = 0;

        if (base->machine < 0) {
            continue;
        }
        meta = &%s_machines[base->machine];
        steps = dl_steps_for_machine((size_t)base->machine);
        if (!steps) {
            continue;
        }
        out = calloc(%s_MAX_PENDING_ASYNC, sizeof(*out));
        if (!out) {
            continue;
        }
        if (base->machine == 1 &&
            base->call_depth == 0 &&
            !dl_trace_async_dma_seed_candidate(
                dl_debug_trace_name(base))) {
            free(out);
            continue;
        }
        dl_expand_cursor(meta, base->machine, steps, base,
                         out, &out_count, DEVILANG_EV_DMA, 0, NULL);
        for (size_t j = 0; j < out_count; ++j) {
            if (out[j].step < 0) {
                continue;
            }
            dl_push_cursor(frontier, &frontier_count, &out[j]);
            if (frontier_count >= %s_MAX_PENDING_ASYNC) {
                break;
            }
        }
        free(out);
        if (frontier_count >= %s_MAX_PENDING_ASYNC) {
            break;
        }
    }
    if (dl_debug_dma_enabled()) {
        fprintf(stderr,
                "pending-async build original=%%zu frontier=%%zu total_pre=%%zu\\n",
                original_count,
                frontier_count,
                machine->pending_async_count);
        for (size_t i = 0; i < original_count && i < 8; ++i) {
            fprintf(stderr,
                    "pending-async original[%%zu] trace=%%s step=%%d depth=%%d score=%%u\\n",
                    i,
                    dl_debug_trace_name(&original[i]),
                    original[i].step,
                    original[i].call_depth,
                    original[i].score);
        }
        for (size_t i = 0; i < frontier_count && i < 8; ++i) {
            fprintf(stderr,
                    "pending-async frontier[%%zu] trace=%%s step=%%d depth=%%d score=%%u\\n",
                    i,
                    dl_debug_trace_name(&frontier[i]),
                    frontier[i].step,
                    frontier[i].call_depth,
                    frontier[i].score);
        }
    }
    machine->pending_async_count = 0;
    for (size_t i = 0; i < original_count; ++i) {
        dl_push_cursor(machine->pending_async,
                       &machine->pending_async_count,
                       &original[i]);
    }
    for (size_t i = 0; i < frontier_count; ++i) {
        dl_push_cursor(machine->pending_async,
                       &machine->pending_async_count,
                       &frontier[i]);
    }
    dl_compact_cursor_set_relaxed(machine->pending_async,
                                  &machine->pending_async_count);
    free(original);
    free(frontier);
}"""
            % (
                self.symbol_prefix,
                self.symbol_prefix.upper(),
                self.symbol_prefix.upper(),
                self.symbol_prefix.upper(),
                self.symbol_prefix.upper(),
                self.symbol_prefix,
                self.symbol_prefix.upper(),
                self.symbol_prefix.upper(),
                self.symbol_prefix.upper(),
            )
        )
        lines.append("")
        lines.append(
            """/* Probe the async DMA frontier with the current event and keep
 * the narrowest successful continuation. Before probing, collapse same-name
 * trace families and apply a small beam limit so speculative replay stays
 * local and bounded. */
static int dl_try_pending_async_dma(
    struct %s_machine *machine,
    const struct devilang_event *event) {
    struct %s_machine *best_probe = NULL;
    int have_dma_named_seed = 0;
    /* Prefer shallower continuations first, then stronger local evidence.
     * followup_support breaks ties in favor of probes that can also absorb the
     * immediate next DMA event. */
    int best_depth = 0x7fffffff;
    uint32_t best_score = 0;
    size_t best_followup_support = 0;
    size_t best_active_count = (size_t)-1;
    size_t best_matched_count = (size_t)-1;

    if (!machine || !event || event->kind != DEVILANG_EV_DMA ||
        machine->pending_async_reentry) {
        return 0;
    }
    for (size_t i = 0; i < machine->pending_async_count; ++i) {
        if (dl_trace_name_matches_dma_opcode(
                dl_debug_trace_name(&machine->pending_async[i]),
                event->dma_opcode)) {
            have_dma_named_seed = 1;
            break;
        }
    }
    if (event->dma_opcode == %d) {
        dl_compact_pending_async_by_trace_name(machine);
    }
    if (machine->pending_async_count > %s_PENDING_ASYNC_BEAM_WIDTH) {
        for (size_t i = 0; i < machine->pending_async_count; ++i) {
            for (size_t j = i + 1; j < machine->pending_async_count; ++j) {
                struct dl_cursor tmp;
                const struct dl_cursor *lhs = &machine->pending_async[i];
                const struct dl_cursor *rhs = &machine->pending_async[j];
                int swap = 0;

                if (rhs->call_depth < lhs->call_depth) {
                    swap = 1;
                } else if (rhs->call_depth == lhs->call_depth &&
                           rhs->score > lhs->score) {
                    swap = 1;
                } else if (rhs->call_depth == lhs->call_depth &&
                           rhs->score == lhs->score &&
                           rhs->step < lhs->step) {
                    swap = 1;
                }
                if (!swap) {
                    continue;
                }
                tmp = machine->pending_async[i];
                machine->pending_async[i] = machine->pending_async[j];
                machine->pending_async[j] = tmp;
            }
        }
        machine->pending_async_count = %s_PENDING_ASYNC_BEAM_WIDTH;
    }
    for (size_t i = 0; i < machine->pending_async_count; ++i) {
        struct %s_machine *probe = calloc(1, sizeof(*probe));
        struct dl_cursor base;
        int probe_rc;
        if (!probe) {
            continue;
        }
        if (event->dma_queue <= 2 &&
            !dl_trace_matches_runtime_queue_hint(
                &machine->pending_async[i],
                (int)event->dma_queue)) {
            free(probe);
            continue;
        }
        if (have_dma_named_seed &&
            !dl_trace_name_matches_dma_opcode(
                dl_debug_trace_name(&machine->pending_async[i]),
                event->dma_opcode)) {
            free(probe);
            continue;
        }
        *probe = *machine;
        probe->active_count = 0;
        probe->matched_count = 0;
        probe->pending_async_count = 0;
        base = machine->pending_async[i];
        base.probe_mode = 1;
        if (base.probe_budget < 48) {
            base.probe_budget = 48;
        }
        if (dl_debug_dma_enabled()) {
            fprintf(stderr,
                    "pending-async try[%%zu] trace=%%s step=%%d depth=%%d event_addr=0x%%llx event_len=%%u dir=%%u op=%%u\\n",
                    i,
                    dl_debug_trace_name(&base),
                    base.step,
                    base.call_depth,
                    (unsigned long long)event->dma_addr,
                    event->dma_len,
                    event->dma_dir,
                    event->dma_opcode);
        }
        dl_push_cursor(probe->active, &probe->active_count, &base);
        probe->pending_async_reentry = 1;
        probe_rc = %s_feed_event(probe, event);
        if (probe_rc == 0 && probe->matched_count > 0) {
            int candidate_depth = 0x7fffffff;
            uint32_t candidate_score = 0;
            size_t candidate_followup_support = 0;

            for (size_t active_index = 0;
                 active_index < probe->active_count;
                 ++active_index) {
                if (probe->active[active_index].call_depth < candidate_depth) {
                    candidate_depth = probe->active[active_index].call_depth;
                }
                if (probe->active[active_index].score > candidate_score) {
                    candidate_score = probe->active[active_index].score;
                }
            }
            if (candidate_depth == 0x7fffffff) {
                for (size_t match_index = 0;
                     match_index < probe->matched_count;
                     ++match_index) {
                    if (probe->matched[match_index].call_depth < candidate_depth) {
                        candidate_depth = probe->matched[match_index].call_depth;
                    }
                    if (probe->matched[match_index].score > candidate_score) {
                        candidate_score = probe->matched[match_index].score;
                    }
                }
            }
            candidate_followup_support =
                dl_count_active_followup_dma_support(
                    &%s_machines[base.machine],
                    (size_t)base.machine,
                    probe,
                    event);
            if (!best_probe ||
                candidate_depth < best_depth ||
                (candidate_depth == best_depth &&
                 (candidate_followup_support > best_followup_support ||
                  (candidate_followup_support == best_followup_support &&
                   (probe->active_count < best_active_count ||
                    (probe->active_count == best_active_count &&
                     (candidate_score > best_score ||
                      (candidate_score == best_score &&
                       probe->matched_count < best_matched_count)))))))) {
                if (dl_debug_dma_enabled()) {
                    fprintf(stderr,
                            "pending-async best trace=%%s depth=%%d score=%%u followup=%%zu matched=%%zu active=%%zu\\n",
                            dl_debug_trace_name(&base),
                            candidate_depth,
                            candidate_score,
                            candidate_followup_support,
                            probe->matched_count,
                            probe->active_count);
                }
                if (best_probe) {
                    free(best_probe);
                }
                best_probe = probe;
                best_depth = candidate_depth;
                best_score = candidate_score;
                best_followup_support = candidate_followup_support;
                best_active_count = probe->active_count;
                best_matched_count = probe->matched_count;
                continue;
            }
        }
        free(probe);
    }
    if (!best_probe) {
        return 0;
    }
    machine->matched_count = best_probe->matched_count;
    memcpy(machine->matched, best_probe->matched,
           sizeof(machine->matched[0]) * best_probe->matched_count);
    machine->active_count = best_probe->active_count;
    memcpy(machine->active, best_probe->active,
           sizeof(machine->active[0]) * best_probe->active_count);
    dl_filter_active_to_followup_dma_support(
        &%s_machines[best_probe->active_count > 0
                         ? best_probe->active[0].machine
                         : 0],
        (size_t)(best_probe->active_count > 0
                     ? best_probe->active[0].machine
                     : 0),
        machine,
        event);
    dl_compact_cursor_set_relaxed(machine->active,
                                  &machine->active_count);
    dl_compact_cursor_set_relaxed(machine->matched,
                                  &machine->matched_count);
    dl_record_pending_dma_context(machine, event);
    machine->pending_async_count = 0;
    free(best_probe);
    return 1;
}"""
            % (
                self.symbol_prefix,
                self.symbol_prefix,
                DMA_OP_IDS["map"],
                self.symbol_prefix.upper(),
                self.symbol_prefix.upper(),
                self.symbol_prefix,
                self.symbol_prefix,
                self.symbol_prefix,
                self.symbol_prefix,
            )
        )
        lines.append("")
        event_signature_cases: List[str] = []
        for machine_index in range(len(machines)):
            signatures = compiled[machine_index][10]
            read_cases = [
                f"            case {self.render_u64_literal(offset)}: return {self.render_u64_literal(1 << sig_id)};"
                for kind, offset, sig_id in signatures
                if kind == "read"
            ]
            write_cases = [
                f"            case {self.render_u64_literal(offset)}: return {self.render_u64_literal(1 << sig_id)};"
                for kind, offset, sig_id in signatures
                if kind == "write"
            ]
            body: List[str] = []
            if read_cases:
                body.append(
                    "        if (event->kind == DEVILANG_EV_MMIO_READ) {\n"
                    "            switch (offset) {\n"
                    + "\n".join(read_cases)
                    + "\n            default: return 0;\n            }\n        }"
                )
            if write_cases:
                body.append(
                    "        if (event->kind == DEVILANG_EV_MMIO_WRITE) {\n"
                    "            switch (offset) {\n"
                    + "\n".join(write_cases)
                    + "\n            default: return 0;\n            }\n        }"
                )
            if not body:
                body.append("        return 0;")
            event_signature_cases.append(
                "    if (machine_index == %d) {\n%s\n        return 0;\n    }"
                % (machine_index, "\n".join(body))
            )
        lines.append(
            """static uint64_t dl_event_signature_mask(
    size_t machine_index,
    const struct devilang_event *event) {
    uint64_t offset;

    if (!event) {
        return 0;
    }
    if (event->kind != DEVILANG_EV_MMIO_READ &&
        event->kind != DEVILANG_EV_MMIO_WRITE) {
        return 0;
    }
    if (event->addr < event->base) {
        return 0;
    }
    offset = event->addr - event->base;
%s
    return 0;
}"""
            % "\n".join(event_signature_cases)
        )
        lines.append("")
        lines.append(
            """static int dl_step_reaches_event_signature(
    const struct dl_step *step,
    uint64_t event_signature,
    int event_kind_mask) {
    if (!step) {
        return 0;
    }
    if (event_signature != 0 && step->reachable_signature_mask != 0) {
        return (step->reachable_signature_mask & event_signature) != 0;
    }
    if (event_kind_mask != 0) {
        return (step->reachable_mask & event_kind_mask) != 0;
    }
    return 0;
}"""
        )
        lines.append("")
        lines.append(
            """static int dl_step_distance_to_event_signature(
    const struct dl_machine_meta *machine_meta,
    size_t machine_index,
    int start_step,
    uint64_t event_signature,
    int event_kind_mask) {
    const struct dl_step *steps;
    size_t nr_steps;
    int *queue;
    int *distance;
    unsigned char *seen;
    size_t head = 0;
    size_t tail = 0;
    int result = -1;

    if (!machine_meta || start_step < 0) {
        return -1;
    }
    steps = dl_steps_for_machine(machine_index);
    nr_steps = dl_nr_steps_for_machine(machine_index);
    if (!steps || nr_steps == 0 || (size_t)start_step >= nr_steps) {
        return -1;
    }

    queue = calloc(nr_steps, sizeof(*queue));
    distance = calloc(nr_steps, sizeof(*distance));
    seen = calloc(nr_steps, sizeof(*seen));
    if (!queue || !distance || !seen) {
        free(queue);
        free(distance);
        free(seen);
        /* Fall back to a conservative summary: if the start step already
         * advertises reachability, treat the distance as unknown-but-live
         * rather than as unreachable. */
        return dl_step_reaches_event_signature(
            &steps[start_step], event_signature, event_kind_mask)
            ? 0
            : -1;
    }

    queue[tail] = start_step;
    distance[tail] = 0;
    tail++;
    seen[start_step] = 1;

    while (head < tail) {
        int step_index = queue[head];
        int current_distance = distance[head];
        const struct dl_step *step = &steps[step_index];
        head++;

        if (dl_step_kind_mask(step) != 0 &&
            dl_step_reaches_event_signature(step, event_signature, event_kind_mask)) {
            result = current_distance;
            break;
        }
        if (dl_step_kind_mask(step) != 0) {
            continue;
        }

        #define DL_ENQUEUE_STEP(idx) \
            do { \
                if ((idx) >= 0 && (size_t)(idx) < nr_steps && !seen[(idx)]) { \
                    seen[(idx)] = 1; \
                    queue[tail] = (idx); \
                    distance[tail] = current_distance + 1; \
                    tail++; \
                } \
            } while (0)

        switch (step->kind) {
        case DL_STEP_EPS:
        case DL_STEP_WILDCARD:
        case DL_STEP_ASSIGN:
            DL_ENQUEUE_STEP(step->next_a);
            break;
        case DL_STEP_BRANCH:
            DL_ENQUEUE_STEP(step->next_a);
            DL_ENQUEUE_STEP(step->next_b);
            break;
        case DL_STEP_CALL:
            if (step->call_trace >= 0 &&
                (size_t)step->call_trace < machine_meta->nr_traces) {
                const struct dl_trace_meta *callee =
                    &machine_meta->traces[step->call_trace];
                DL_ENQUEUE_STEP(callee->start_step);
            }
            DL_ENQUEUE_STEP(step->next_a);
            break;
        default:
            break;
        }

        #undef DL_ENQUEUE_STEP
    }

    free(queue);
    free(distance);
    free(seen);
    return result;
}"""
        )
        lines.append("")
        lines.append(
            """static int dl_observable_step_matches_event(
    const struct dl_machine_meta *machine_meta,
    const struct dl_step *step,
    const struct dl_cursor *cursor,
    const struct devilang_event *event) {
    int known = 0;
    uint64_t addr = 0;
    struct dl_cursor bound_cursor;

    if (!machine_meta || !step || !cursor || !event) {
        return 1;
    }
    if (step->kind == DL_STEP_READ) {
        if (event->kind != DEVILANG_EV_MMIO_READ ||
            (event->width != 0 && event->width != (uint32_t)step->width)) {
            return 0;
        }
    } else if (step->kind == DL_STEP_WRITE) {
        if (event->kind != DEVILANG_EV_MMIO_WRITE ||
            (event->width != 0 && event->width != (uint32_t)step->width)) {
            return 0;
        }
    } else if (step->kind == DL_STEP_DMA) {
        if (event->kind != DEVILANG_EV_DMA) {
            return 0;
        }
        if ((uint32_t)step->dma_op != event->dma_opcode ||
            (uint32_t)step->dma_dir != event->dma_dir ||
            !dl_dma_path_matches((uint32_t)step->dma_path,
                                 event->dma_path)) {
            return 0;
        }
        bound_cursor = *cursor;
        if (!dl_match_dma_addr(machine_meta->exprs, step->addr, &bound_cursor,
                               event->dma_addr)) {
            return 0;
        }
        if (!dl_match_dma_len(machine_meta->exprs, step->value, &bound_cursor,
                              event->dma_len)) {
            return 0;
        }
        if (!dl_dma_kind_matches(step->dma_data_kind, event)) {
            return 0;
        }
        if (!dl_dma_type_matches(step->dma_data_type, machine_meta, event)) {
            return 0;
        }
        return 1;
    } else {
        return 1;
    }
    if (step->addr < 0) {
        return 1;
    }
    if (!dl_mmio_event_schema_matches(event)) {
        return 0;
    }
    addr = dl_eval_expr(machine_meta->exprs, step->addr, cursor, &known);
    if (!known) {
        return 1;
    }
    return addr == event->addr;
}"""
        )
        lines.append("")
        lines.append(
            """static int dl_is_transport_noise_event(
    const struct devilang_event *event) {
    uint64_t offset;

    if (!event) {
        return 0;
    }
    if (event->kind != DEVILANG_EV_MMIO_READ &&
        event->kind != DEVILANG_EV_MMIO_WRITE) {
        return 0;
    }
    if (event->addr < event->base) {
        return 0;
    }
    offset = event->addr - event->base;
    return offset == 0x60 ||
           offset == 0x64;
}"""
        )
        lines.append("")
        lines.append(
            """static int dl_is_driver_ok_status_event(
    const struct devilang_event *event) {
    uint64_t offset;

    if (!event) {
        return 0;
    }
    if (event->kind != DEVILANG_EV_MMIO_READ &&
        event->kind != DEVILANG_EV_MMIO_WRITE) {
        return 0;
    }
    if (event->addr < event->base) {
        return 0;
    }
    offset = event->addr - event->base;
    if (offset != 0x70) {
        return 0;
    }
    return ((uint32_t)event->value & 0xfU) == 0xfU;
}"""
        )
        lines.append("")
        lines.append(
            """static void dl_record_queue_desc_mmio_hint(
    struct """
            + f"{self.symbol_prefix}_machine"
            + """ *machine,
    const struct devilang_event *event) {
    uint64_t offset;
    uint64_t addr;
    if (!machine || !event ||
        event->kind != DEVILANG_EV_MMIO_WRITE ||
        event->addr < event->base) {
        return;
    }
    offset = event->addr - event->base;
    if (offset == 0x80) {
        machine->queue_desc_lo = (uint32_t)event->value;
        machine->queue_desc_lo_valid = 1;
    } else if (offset == 0x84) {
        machine->queue_desc_hi = (uint32_t)event->value;
        machine->queue_desc_hi_valid = 1;
    } else {
        return;
    }
    if (!machine->queue_desc_lo_valid) {
        return;
    }
    addr = ((uint64_t)machine->queue_desc_hi << 32) |
           (uint64_t)machine->queue_desc_lo;
    dl_pointer_hint_add(machine, addr, dl_find_dma_type_id(&"""
            + f"{self.symbol_prefix}_machines"
            + """[1], "vring_desc"), 8);
    dl_pointer_hint_add(machine, addr, dl_find_dma_type_id(&"""
            + f"{self.symbol_prefix}_machines"
            + """[1], "vring_packed_desc"), 8);
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
            next.probe_mode = base->probe_mode;
            next.probe_budget = base->probe_budget;
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
        next.probe_mode = base->probe_mode;
        next.probe_budget = base->probe_budget;
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
        if (strcmp(trace_meta->name, "vm_set_status_trace") == 0 &&
            strcmp(param_name, "dev") == 0 &&
            step->arg_count >= 1 &&
            step->call_args[0] >= 0) {
            int known = 0;
            uint64_t value = dl_eval_expr(
                machine_meta->exprs, step->call_args[0], cursor, &known);
            if (known) {
                cursor->symbols[param_symbol] = value;
                cursor->symbol_valid[param_symbol] = 1;
                used_args[0] = 1;
                continue;
            }
        }
        if (strcmp(trace_meta->name, "vm_set_status_trace") == 0 &&
            strcmp(param_name, "status") == 0 &&
            step->arg_count >= 2 &&
            step->call_args[1] >= 0) {
            int known = 0;
            uint64_t value = dl_eval_expr(
                machine_meta->exprs, step->call_args[1], cursor, &known);
            if (known) {
                cursor->symbols[param_symbol] = value;
                cursor->symbol_valid[param_symbol] = 1;
                used_args[1] = 1;
                continue;
            }
        }
        if (strcmp(param_name, "base") == 0 &&
            mmio_symbol >= 0 &&
            cursor->symbol_valid[mmio_symbol]) {
            cursor->symbols[param_symbol] = cursor->symbols[mmio_symbol] + 0x100ULL;
            cursor->symbol_valid[param_symbol] = 1;
            continue;
        }
        if (strcmp(trace_meta->name, "vm_get_trace") == 0 &&
            strcmp(param_name, "offset") == 0 &&
            step->arg_count >= 2 &&
            step->call_args[1] >= 0) {
            int known = 0;
            uint64_t value = dl_eval_expr(
                machine_meta->exprs, step->call_args[1], cursor, &known);
            if (known) {
                cursor->symbols[param_symbol] = value;
                cursor->symbol_valid[param_symbol] = 1;
                continue;
            }
            {
                int indvar_symbol = %s_symbol_ids_phi_indvars_iv;
                if (indvar_symbol >= 0 &&
                    cursor->symbol_valid[indvar_symbol]) {
                    cursor->symbols[param_symbol] =
                        cursor->symbols[indvar_symbol];
                } else {
                    cursor->symbols[param_symbol] = 0;
                }
                cursor->symbol_valid[param_symbol] = 1;
                continue;
            }
        }
        if (strcmp(trace_meta->name, "vm_get_trace") == 0 &&
            strcmp(param_name, "len") == 0 &&
            step->arg_count >= 4 &&
            step->call_args[3] >= 0) {
            int known = 0;
            uint64_t value = dl_eval_expr(
                machine_meta->exprs, step->call_args[3], cursor, &known);
            if (known) {
                cursor->symbols[param_symbol] = value;
                cursor->symbol_valid[param_symbol] = 1;
                continue;
            }
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
            % (
                self.symbol_prefix,
                self.symbol_prefix,
                self.symbol_prefix,
            )
        )
        lines.append("")
        lines.append(
            """static int dl_trace_allows_dma_branch_split(const char *name) {
    if (!name) {
        return 0;
    }
    return strstr(name, "vring_map_one_sg") != NULL ||
           strstr(name, "vring_map_single") != NULL ||
           strstr(name, "vring_unmap_one_split") != NULL ||
           strstr(name, "vring_unmap_extra_packed") != NULL;
}"""
        )
        lines.append("")
        lines.append(
            """static int dl_closure(
    const struct dl_machine_meta *machine_meta,
    int machine_idx,
    const struct dl_step *steps,
    struct dl_cursor *io,
    size_t *count,
    int target_event_kind,
    uint64_t target_event_signature) {
    size_t index = 0;
    struct dl_cursor *seen = calloc(%s_MAX_CURSORS, sizeof(*seen));
    size_t seen_count = 0;
    if (!seen) {
        /* Callers must treat this as "closure unavailable" and preserve
         * their current frontier instead of consuming a partial result. */
        return 0;
    }
    while (index < *count) {
        if ((target_event_signature == %s_status_read_signature ||
             target_event_signature == %s_status_write_signature) &&
            *count > 64) {
            dl_compact_cursor_set_relaxed(io, count);
            if (index >= *count) {
                break;
            }
        }
        dl_sync_cursor_trace_from_step(machine_meta, &io[index]);
        struct dl_cursor cursor = io[index];
        int already_seen = 0;
        int relax_seen = 0;
        if ((target_event_signature == %s_status_read_signature ||
             target_event_signature == %s_status_write_signature) &&
            cursor.trace >= 0 &&
            dl_trace_prefers_status_distance_guidance(
                machine_meta->traces[cursor.trace].name)) {
            relax_seen = 1;
        }
        for (size_t seen_index = 0; seen_index < seen_count; ++seen_index) {
            if (dl_cursor_equal(&seen[seen_index], &cursor) ||
                (relax_seen &&
                 dl_cursor_same_frame(&seen[seen_index], &cursor))) {
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
        if (cursor.probe_mode &&
            cursor.score == 0 &&
            cursor.probe_budget == 0) {
            io[index].step = -1;
            index++;
            continue;
        }
        if (cursor.step < 0) {
            index++;
            continue;
        }
        const struct dl_step *step = &steps[cursor.step];
        /* Some notify-triggered vring DMA traces emit several same-kind DMA
         * observables back-to-back before later dataflow distinguishes the
         * branch. Keep both successors here; otherwise real virtio-mmio trace
         * replay can prune away later descriptor maps too early. */
        if (step->kind == DL_STEP_BRANCH &&
            target_event_kind == DEVILANG_EV_DMA &&
            cursor.trace >= 0 &&
            step->next_a >= 0 &&
            step->next_b >= 0 &&
            dl_trace_allows_dma_branch_split(
                machine_meta->traces[cursor.trace].name)) {
            struct dl_cursor alt = cursor;
            io[index].step = step->next_a;
            alt.step = step->next_b;
            dl_push_cursor(io, count, &alt);
            index++;
            continue;
        }
        if (step->kind == DL_STEP_EPS) {
            if (cursor.probe_mode && cursor.score == 0 && io[index].probe_budget > 0) {
                io[index].probe_budget--;
            }
            io[index].step = step->next_a;
            continue;
        }
        if (step->kind == DL_STEP_WILDCARD) {
            if (cursor.probe_mode && cursor.score == 0 && io[index].probe_budget > 0) {
                io[index].probe_budget--;
            }
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
            if (cursor.probe_mode && cursor.score == 0 && io[index].probe_budget > 0) {
                io[index].probe_budget--;
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
            if (((machine_idx != 0) || cursor.state > 0) &&
                cursor.probe_mode &&
                cursor.score == 0 &&
                target_event_kind != 0) {
                const int want_mask = dl_event_kind_mask(target_event_kind);
                const struct dl_trace_meta *probe_callee =
                    &machine_meta->traces[step->call_trace];
                const struct dl_step *callee_step =
                    probe_callee->start_step >= 0
                        ? &steps[probe_callee->start_step]
                        : NULL;
                const int callee_matches =
                    dl_step_reaches_event_signature(
                        callee_step, target_event_signature, want_mask);
                const int next_matches =
                    step->next_a >= 0 &&
                    dl_step_reaches_event_signature(
                        &steps[step->next_a], target_event_signature, want_mask);
                if (!callee_matches) {
                    if (io[index].probe_budget > 0) {
                        io[index].probe_budget--;
                    }
                    io[index].step = step->next_a;
                    if (step->scratch >= 0) {
                        io[index].scratch_valid[step->scratch] = 0;
                    }
                    continue;
                }
                if (next_matches) {
                    struct dl_cursor alt = io[index];
                    alt.step = step->next_a;
                    if (step->scratch >= 0) {
                        alt.scratch_valid[step->scratch] = 0;
                    }
                    dl_push_cursor(io, count, &alt);
                }
            }
            io[index].return_steps[io[index].call_depth] = step->next_a;
            io[index].return_traces[io[index].call_depth] = io[index].trace;
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
            if (cursor.probe_mode && cursor.score == 0 && io[index].probe_budget > 0) {
                io[index].probe_budget--;
            }
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
            if ((step->value >= 0 &&
                 machine_meta->exprs[step->value].kind == DL_EXPR_CONST &&
                 machine_meta->exprs[step->value].value == 0 &&
                 dl_expr_is_unknown_zero_field_flag(machine_meta->exprs,
                                                    step->addr, &cursor)) ||
                (step->addr >= 0 &&
                 machine_meta->exprs[step->addr].kind == DL_EXPR_CONST &&
                 machine_meta->exprs[step->addr].value == 0 &&
                 dl_expr_is_unknown_zero_field_flag(machine_meta->exprs,
                                                    step->value, &cursor))) {
                if (target_event_signature != 0 &&
                    step->next_a >= 0 &&
                    step->next_b >= 0) {
                    const int want_mask = dl_event_kind_mask(target_event_kind);
                    const int a_matches = dl_step_reaches_event_signature(
                        &steps[step->next_a], target_event_signature, want_mask);
                    const int b_matches = dl_step_reaches_event_signature(
                        &steps[step->next_b], target_event_signature, want_mask);
                    if (a_matches && !b_matches) {
                        io[index].step = step->next_a;
                        continue;
                    }
                    if (!a_matches && b_matches) {
                        io[index].step = step->next_b;
                        continue;
                    }
                    if (a_matches && b_matches) {
                        const int a_distance = dl_step_distance_to_event_signature(
                            machine_meta,
                            (size_t)machine_idx,
                            step->next_a,
                            target_event_signature,
                            want_mask);
                        const int b_distance = dl_step_distance_to_event_signature(
                            machine_meta,
                            (size_t)machine_idx,
                            step->next_b,
                            target_event_signature,
                            want_mask);
                        if (a_distance >= 0 && b_distance >= 0 &&
                            a_distance != b_distance) {
                            io[index].step =
                                a_distance < b_distance ? step->next_a : step->next_b;
                            continue;
                        }
                    }
                    if (!a_matches && !b_matches) {
                        io[index].step = step->next_b;
                        continue;
                    }
                } else {
                    io[index].step = step->next_b;
                    continue;
                }
            }
            if (step->next_a >= 0 &&
                step->next_b >= 0 &&
                step->next_a <= cursor.step &&
                step->next_b > cursor.step &&
                dl_branch_backedge_is_pure_symbolic_loop(
                    steps, &cursor, step, step->next_a)) {
                io[index].step = step->next_b;
                continue;
            }
            if (step->next_a >= 0 &&
                step->next_b >= 0 &&
                step->next_b <= cursor.step &&
                step->next_a > cursor.step &&
                dl_branch_backedge_is_pure_symbolic_loop(
                    steps, &cursor, step, step->next_b)) {
                io[index].step = step->next_a;
                continue;
            }
            if (target_event_signature != 0 &&
                step->next_a >= 0 &&
                step->next_b >= 0) {
                const int want_mask = dl_event_kind_mask(target_event_kind);
                const int a_matches = dl_step_reaches_event_signature(
                    &steps[step->next_a], target_event_signature, want_mask);
                const int b_matches = dl_step_reaches_event_signature(
                    &steps[step->next_b], target_event_signature, want_mask);
                if (a_matches && !b_matches) {
                    if (cursor.probe_mode && cursor.score == 0 &&
                        io[index].probe_budget > 0) {
                        io[index].probe_budget--;
                    }
                    io[index].step = step->next_a;
                    continue;
                }
                if (!a_matches && b_matches) {
                    if (cursor.probe_mode && cursor.score == 0 &&
                        io[index].probe_budget > 0) {
                        io[index].probe_budget--;
                    }
                    io[index].step = step->next_b;
                    continue;
                }
                if (a_matches && b_matches &&
                    cursor.trace >= 0 &&
                    (strcmp(machine_meta->traces[cursor.trace].name,
                            "vm_find_vqs_trace") == 0 ||
                     strcmp(machine_meta->traces[cursor.trace].name,
                            "virtnet_find_vqs_trace") == 0)) {
                    if (target_event_signature ==
                            %s_status_read_signature ||
                        target_event_signature ==
                            %s_status_write_signature) {
                        const int a_distance = dl_step_distance_to_event_signature(
                            machine_meta,
                            (size_t)machine_idx,
                            step->next_a,
                            target_event_signature,
                            want_mask);
                        const int b_distance = dl_step_distance_to_event_signature(
                            machine_meta,
                            (size_t)machine_idx,
                            step->next_b,
                            target_event_signature,
                            want_mask);
                        if (a_distance >= 0 && b_distance >= 0 &&
                            a_distance != b_distance) {
                            if (cursor.probe_mode && cursor.score == 0 &&
                                io[index].probe_budget > 0) {
                                io[index].probe_budget--;
                            }
                            io[index].step =
                                a_distance < b_distance ? step->next_a : step->next_b;
                            continue;
                        }
                        if (cursor.probe_mode && cursor.score == 0 &&
                            io[index].probe_budget > 0) {
                            io[index].probe_budget--;
                        }
                        io[index].step = step->next_b;
                        continue;
                    }
                    const int a_distance = dl_step_distance_to_event_signature(
                        machine_meta,
                        (size_t)machine_idx,
                        step->next_a,
                        target_event_signature,
                        want_mask);
                    const int b_distance = dl_step_distance_to_event_signature(
                        machine_meta,
                        (size_t)machine_idx,
                        step->next_b,
                        target_event_signature,
                        want_mask);
                    if (a_distance >= 0 && b_distance >= 0 &&
                        a_distance != b_distance) {
                        if (cursor.probe_mode && cursor.score == 0 &&
                            io[index].probe_budget > 0) {
                            io[index].probe_budget--;
                        }
                        io[index].step =
                            a_distance < b_distance ? step->next_a : step->next_b;
                        continue;
                    }
                }
                if (a_matches && b_matches &&
                    !cursor.probe_mode &&
                    target_event_signature ==
                        %s_queue_notify_write_signature) {
                    const int a_distance = dl_step_distance_to_event_signature(
                        machine_meta,
                        (size_t)machine_idx,
                        step->next_a,
                        target_event_signature,
                        want_mask);
                    const int b_distance = dl_step_distance_to_event_signature(
                        machine_meta,
                        (size_t)machine_idx,
                        step->next_b,
                        target_event_signature,
                        want_mask);
                    const int a_forward = step->next_a > cursor.step;
                    const int b_forward = step->next_b > cursor.step;
                    if (a_distance >= 0 && b_distance >= 0 &&
                        a_distance != b_distance &&
                        (a_forward || b_forward)) {
                        io[index].step =
                            a_distance < b_distance ? step->next_a : step->next_b;
                        continue;
                    }
                }
                if (a_matches && b_matches &&
                    cursor.trace >= 0 &&
                    (target_event_signature ==
                         %s_status_read_signature ||
                     target_event_signature ==
                         %s_status_write_signature) &&
                    dl_trace_prefers_status_distance_guidance(
                        machine_meta->traces[cursor.trace].name)) {
                    const int a_distance = dl_step_distance_to_event_signature(
                        machine_meta,
                        (size_t)machine_idx,
                        step->next_a,
                        target_event_signature,
                        want_mask);
                    const int b_distance = dl_step_distance_to_event_signature(
                        machine_meta,
                        (size_t)machine_idx,
                        step->next_b,
                        target_event_signature,
                        want_mask);
                    if (a_distance >= 0 && b_distance >= 0 &&
                        a_distance != b_distance) {
                        if (cursor.probe_mode && cursor.score == 0 &&
                            io[index].probe_budget > 0) {
                            io[index].probe_budget--;
                        }
                        io[index].step =
                            a_distance < b_distance ? step->next_a : step->next_b;
                        continue;
                    }
                    if (step->next_a > cursor.step &&
                        step->next_b <= cursor.step) {
                        io[index].step = step->next_a;
                        continue;
                    }
                    if (step->next_b > cursor.step &&
                        step->next_a <= cursor.step) {
                        io[index].step = step->next_b;
                        continue;
                    }
                }
            }
            if (((machine_idx != 0) || cursor.state > 0) &&
                cursor.score == 0 &&
                step->next_a >= 0 &&
                step->next_b >= 0) {
                if (cursor.probe_mode && target_event_kind != 0) {
                    const int want_mask = dl_event_kind_mask(target_event_kind);
                    const int next_a_mask = step->next_a >= 0
                        ? steps[step->next_a].reachable_mask
                        : 0;
                    const int next_b_mask = step->next_b >= 0
                        ? steps[step->next_b].reachable_mask
                        : 0;
                    const int a_matches = want_mask != 0 &&
                        (next_a_mask & want_mask) != 0;
                    const int b_matches = want_mask != 0 &&
                        (next_b_mask & want_mask) != 0;

                    if (a_matches && !b_matches) {
                        if (io[index].probe_budget > 0) {
                            io[index].probe_budget--;
                        }
                        io[index].step = step->next_a;
                        continue;
                    }
                    if (!a_matches && b_matches) {
                        if (io[index].probe_budget > 0) {
                            io[index].probe_budget--;
                        }
                        io[index].step = step->next_b;
                        continue;
                    }
                    if (a_matches && b_matches) {
                        const int a_distance = dl_step_distance_to_event_signature(
                            machine_meta,
                            (size_t)machine_idx,
                            step->next_a,
                            target_event_signature,
                            want_mask);
                        const int b_distance = dl_step_distance_to_event_signature(
                            machine_meta,
                            (size_t)machine_idx,
                            step->next_b,
                            target_event_signature,
                            want_mask);
                        const int a_forward = step->next_a > cursor.step;
                        const int b_forward = step->next_b > cursor.step;
                        if (a_distance >= 0 && b_distance >= 0 &&
                            a_distance != b_distance) {
                            io[index].step =
                                a_distance < b_distance ? step->next_a : step->next_b;
                        } else if (a_forward && !b_forward) {
                            io[index].step = step->next_a;
                        } else if (!a_forward && b_forward) {
                            io[index].step = step->next_b;
                        } else if (a_forward && b_forward) {
                            io[index].step = step->next_a < step->next_b
                                ? step->next_a
                                : step->next_b;
                        } else {
                            io[index].step = step->next_a;
                        }
                        if (io[index].probe_budget > 0) {
                            io[index].probe_budget--;
                        }
                        continue;
                    }
                    io[index].step = -1;
                    continue;
                }
                if (!cursor.probe_mode) {
                const int a_forward = step->next_a > cursor.step;
                const int b_forward = step->next_b > cursor.step;

                if (a_forward && !b_forward) {
                    if (cursor.probe_mode && cursor.score == 0 && io[index].probe_budget > 0) {
                        io[index].probe_budget--;
                    }
                    io[index].step = step->next_a;
                    continue;
                }
                if (!a_forward && b_forward) {
                    if (cursor.probe_mode && cursor.score == 0 && io[index].probe_budget > 0) {
                        io[index].probe_budget--;
                    }
                    io[index].step = step->next_b;
                    continue;
                }
                if (a_forward && b_forward) {
                    if (cursor.probe_mode && cursor.score == 0 && io[index].probe_budget > 0) {
                        io[index].probe_budget--;
                    }
                    io[index].step =
                        step->next_a < step->next_b ? step->next_a : step->next_b;
                    continue;
                }
                }
            }
            if (target_event_kind == 0 &&
                !cursor.probe_mode &&
                cursor.trace >= 0 &&
                dl_trace_pause_unknown_post_event_branch(
                    machine_meta->traces[cursor.trace].name)) {
                index++;
                continue;
            }
            if (cursor.probe_mode && cursor.score == 0) {
                io[index].step = -1;
                continue;
            }
            struct dl_cursor alt = cursor;
            io[index].step = step->next_a;
            alt.step = step->next_b;
            dl_push_cursor(io, count, &alt);
            continue;
        }
        if (((cursor.machine != 0) || cursor.state > 0) &&
            cursor.probe_mode &&
            cursor.score == 0 &&
            target_event_kind != 0 &&
            step->next_a >= 0) {
            const int want_mask = dl_event_kind_mask(target_event_kind);
            const int step_kind_mask =
                step->kind == DL_STEP_READ ? 1 :
                step->kind == DL_STEP_WRITE ? 2 :
                step->kind == DL_STEP_DMA ? 4 : 0;
            if (want_mask != 0 &&
                step_kind_mask != 0 &&
                step_kind_mask != want_mask &&
                (step->reachable_mask & want_mask) != 0) {
                if (io[index].probe_budget > 0) {
                    io[index].probe_budget--;
                }
                io[index].step = step->next_a;
                continue;
            }
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
                return_scratch = machine_meta->traces[io[index].trace].return_scratch;
                low_scratch = dl_find_scratch_id(machine_meta, "call");
                high_scratch = dl_find_scratch_id(machine_meta, "call8");
                if (strcmp(machine_meta->traces[io[index].trace].name, "vm_get_features_trace") == 0 &&
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
                if (strcmp(machine_meta->traces[io[index].trace].name, "vm_get_trace") == 0 &&
                    caller_trace >= 0 &&
                    strcmp(machine_meta->traces[caller_trace].name,
                           "__virtio_cread_many_trace") == 0 &&
                    %s_symbol_ids_offset >= 0 &&
                    %s_symbol_ids_phi_indvars_iv >= 0 &&
                    cursor.symbol_valid[%s_symbol_ids_offset]) {
                    io[index].symbols[%s_symbol_ids_phi_indvars_iv] =
                        cursor.symbols[%s_symbol_ids_offset] + 1;
                    io[index].symbol_valid[%s_symbol_ids_phi_indvars_iv] = 1;
                    if (%s_symbol_ids_indvars_iv_next >= 0) {
                        io[index].symbols[%s_symbol_ids_indvars_iv_next] =
                            cursor.symbols[%s_symbol_ids_offset];
                        io[index].symbol_valid[%s_symbol_ids_indvars_iv_next] = 1;
                    }
                    io[index].symbol_valid[%s_symbol_ids_offset] = 0;
                }
                if (strcmp(machine_meta->traces[io[index].trace].name, "vm_setup_vq_trace") == 0 &&
                    caller_trace >= 0 &&
                    strcmp(machine_meta->traces[caller_trace].name,
                           "vm_find_vqs_trace") == 0 &&
                    %s_symbol_ids_index >= 0 &&
                    cursor.symbol_valid[%s_symbol_ids_index]) {
                    if (%s_symbol_ids_inc30 >= 0) {
                        io[index].symbols[%s_symbol_ids_inc30] =
                            cursor.symbols[%s_symbol_ids_index];
                        io[index].symbol_valid[%s_symbol_ids_inc30] = 1;
                    }
                    if (%s_symbol_ids_queue_idx_067 >= 0) {
                        io[index].symbols[%s_symbol_ids_queue_idx_067] =
                            cursor.symbols[%s_symbol_ids_index];
                        io[index].symbol_valid[%s_symbol_ids_queue_idx_067] = 1;
                    }
                    if (%s_symbol_ids_queue_idx_phi >= 0) {
                        io[index].symbols[%s_symbol_ids_queue_idx_phi] =
                            cursor.symbols[%s_symbol_ids_index];
                        io[index].symbol_valid[%s_symbol_ids_queue_idx_phi] = 1;
                    }
                }
                if (binding >= 0) {
                    if (strcmp(machine_meta->traces[io[index].trace].name, "virtio_has_feature_trace") == 0 &&
                        %s_symbol_ids_device_features >= 0 &&
                        %s_symbol_ids_fbit >= 0 &&
                        io[index].symbol_valid[%s_symbol_ids_device_features] &&
                        io[index].symbol_valid[%s_symbol_ids_fbit]) {
                        uint64_t features = io[index].symbols[%s_symbol_ids_device_features];
                        uint64_t fbit = io[index].symbols[%s_symbol_ids_fbit];
                        io[index].scratch[binding] =
                            fbit < 64 ? ((features >> fbit) & 1ULL) : 0ULL;
                        io[index].scratch_valid[binding] = 1;
                    } else if (machine_meta->traces[io[index].trace].return_constant >= 0) {
                        io[index].scratch[binding] =
                            (uint64_t)machine_meta->traces[io[index].trace].return_constant;
                        io[index].scratch_valid[binding] = 1;
                    } else if (return_scratch >= 0 &&
                        io[index].scratch_valid[return_scratch]) {
                        io[index].scratch[binding] = io[index].scratch[return_scratch];
                        io[index].scratch_valid[binding] = 1;
                    } else if (binding >= 0 &&
                        (size_t)binding < machine_meta->nr_scratch &&
                        dl_scratch_name_is_success_bias(
                            machine_meta->scratch_names[binding])) {
                        io[index].scratch[binding] = 0;
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
    return 1;
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
            """static int dl_trace_runtime_rx_refill_candidate(const char *trace_name) {
    if (!trace_name) {
        return 0;
    }
    return strstr(trace_name, "vring_map_one_sg") != NULL &&
           (strstr(trace_name, "virtqueue_add_inbuf") != NULL ||
            strstr(trace_name, "add_recvbuf") != NULL);
}"""
        )
        lines.append("")
        lines.append(
            """static int dl_trace_runtime_rx_refill_len_matches(
    const char *trace_name,
    const struct devilang_event *event) {
    if (!trace_name || !event || event->kind != DEVILANG_EV_DMA) {
        return 0;
    }
    if (event->dma_len >= 256) {
        return strstr(trace_name, "add_recvbuf_big") != NULL;
    }
    return strstr(trace_name, "add_recvbuf_big") == NULL;
}"""
        )
        lines.append("")
        lines.append(
            """static int dl_trace_runtime_queue_hint(const char *trace_name) {
    if (!trace_name) {
        return -1;
    }
    if (strcmp(trace_name, "virtnet_open_trace") == 0) {
        return 0;
    }
    if (strcmp(trace_name, "start_xmit_trace") == 0 ||
        strcmp(trace_name, "virtnet_xdp_xmit_trace") == 0) {
        return 1;
    }
    if (strcmp(trace_name, "virtnet_set_mac_address_trace") == 0 ||
        strcmp(trace_name, "virtnet_vlan_rx_add_vid_trace") == 0 ||
        strcmp(trace_name, "virtnet_vlan_rx_kill_vid_trace") == 0 ||
        strcmp(trace_name, "virtnet_xdp_trace") == 0 ||
        strcmp(trace_name, "virtnet_set_features_trace") == 0 ||
        strcmp(trace_name, "virtnet_set_ringparam_trace") == 0 ||
        strcmp(trace_name, "virtnet_get_ethtool_stats_trace") == 0 ||
        strcmp(trace_name, "virtnet_set_channels_trace") == 0 ||
        strcmp(trace_name, "virtnet_set_coalesce_trace") == 0 ||
        strcmp(trace_name, "virtnet_set_per_queue_coalesce_trace") == 0 ||
        strcmp(trace_name, "virtnet_set_rxfh_trace") == 0 ||
        strcmp(trace_name, "virtnet_set_hashflow_trace") == 0) {
        return 2;
    }
    return -1;
}"""
        )
        lines.append("")
        lines.append(
            """static int dl_trace_pause_unknown_post_event_branch(
    const char *trace_name) {
    if (!trace_name) {
        return 0;
    }
    return strcmp(trace_name, "__virtio_cread_many_trace") == 0 ||
           strcmp(trace_name, "vm_find_vqs_trace") == 0 ||
           strcmp(trace_name, "virtnet_find_vqs_trace") == 0;
}"""
        )
        lines.append("")
        lines.append(
            """static int dl_trace_prefers_status_distance_guidance(
    const char *trace_name) {
    if (!trace_name) {
        return 0;
    }
    return strcmp(trace_name, "vm_find_vqs_trace") == 0 ||
           strcmp(trace_name, "virtnet_find_vqs_trace") == 0 ||
           strcmp(trace_name, "virtio_find_vqs_trace") == 0 ||
           strcmp(trace_name, "init_vqs_trace") == 0 ||
           strcmp(trace_name, "virtnet_probe_trace") == 0;
}"""
        )
        lines.append("")
        lines.append(
            """static int dl_step_kind_mask(const struct dl_step *step) {
    if (!step) {
        return 0;
    }
    switch (step->kind) {
    case DL_STEP_READ:
        return 1;
    case DL_STEP_WRITE:
        return 2;
    case DL_STEP_DMA:
        return 4;
    default:
        return 0;
    }
}"""
        )
        lines.append("")
        lines.append(
            """static int dl_trace_probe_supports_event(
    const struct dl_machine_meta *machine_meta,
    size_t machine_index,
    int trace_idx,
    const struct devilang_event *event) {
    int *work = NULL;
    unsigned char *seen = NULL;
    size_t work_count = 0;
    size_t index = 0;
    const struct dl_step *steps;
    const struct dl_trace_meta *trace_meta;
    const size_t nr_steps = dl_nr_steps_for_machine(machine_index);
    const int event_kind_mask = dl_event_kind_mask(event ? event->kind : 0);
    const uint64_t event_signature =
        dl_event_signature_mask(machine_index, event);

    if (!machine_meta || !event || trace_idx < 0 ||
        (size_t)trace_idx >= machine_meta->nr_traces) {
        return 0;
    }
    trace_meta = &machine_meta->traces[trace_idx];
    if (trace_meta->start_step < 0) {
        return 0;
    }
    steps = dl_steps_for_machine(machine_index);
    if (!steps || nr_steps == 0 || (size_t)trace_meta->start_step >= nr_steps) {
        return 0;
    }
    work = calloc(nr_steps, sizeof(*work));
    seen = calloc(nr_steps, sizeof(*seen));
    if (!work || !seen) {
        free(work);
        free(seen);
        /* Fall back to the precomputed step reachability summary instead of
         * concluding that the trace cannot consume the event. */
        return dl_step_reaches_event_signature(
            &steps[trace_meta->start_step],
            event_signature,
            event_kind_mask);
    }

    work[work_count++] = trace_meta->start_step;
    while (index < work_count) {
        const int step_idx = work[index++];
        const struct dl_step *step;

        if (step_idx < 0 || (size_t)step_idx >= nr_steps) {
            continue;
        }
        if (seen[step_idx]) {
            continue;
        }
        seen[step_idx] = 1;
        step = &steps[step_idx];

        switch (step->kind) {
        case DL_STEP_EPS:
        case DL_STEP_WILDCARD:
        case DL_STEP_ASSIGN:
            if (step->next_a >= 0 && work_count < nr_steps) {
                work[work_count++] = step->next_a;
            }
            break;
        case DL_STEP_BRANCH:
            if (step->next_a >= 0 &&
                (step->next_a == step_idx ||
                 dl_step_reaches_event_signature(
                     &steps[step->next_a], event_signature, event_kind_mask)) &&
                work_count < nr_steps) {
                work[work_count++] = step->next_a;
            }
            if (step->next_b >= 0 &&
                (step->next_b == step_idx ||
                 dl_step_reaches_event_signature(
                     &steps[step->next_b], event_signature, event_kind_mask)) &&
                work_count < nr_steps) {
                work[work_count++] = step->next_b;
            }
            break;
        case DL_STEP_CALL: {
            const struct dl_trace_meta *callee = NULL;
            if (step->call_trace >= 0 &&
                (size_t)step->call_trace < machine_meta->nr_traces) {
                callee = &machine_meta->traces[step->call_trace];
            }
            if (callee &&
                callee->start_step >= 0 &&
                (size_t)callee->start_step < nr_steps &&
                dl_step_reaches_event_signature(
                    &steps[callee->start_step], event_signature, event_kind_mask) &&
                work_count < nr_steps) {
                work[work_count++] = callee->start_step;
            } else if (step->next_a >= 0 &&
                       work_count < nr_steps) {
                work[work_count++] = step->next_a;
            }
            break;
        }
        case DL_STEP_DMA:
            if (event->kind != DEVILANG_EV_DMA) {
                break;
            }
            if ((uint32_t)step->dma_op != event->dma_opcode ||
                (uint32_t)step->dma_dir != event->dma_dir ||
                !dl_dma_path_matches((uint32_t)step->dma_path,
                                     event->dma_path)) {
                break;
            }
            if (!dl_dma_kind_matches(step->dma_data_kind, event)) {
                break;
            }
            if (!dl_dma_type_matches(step->dma_data_type, machine_meta, event)) {
                break;
            }
            free(work);
            free(seen);
            return 1;
        case DL_STEP_READ:
            if (event->kind == DEVILANG_EV_MMIO_READ) {
                if (event_signature != 0 &&
                    !dl_step_reaches_event_signature(
                        step, event_signature, event_kind_mask)) {
                    break;
                }
                free(work);
                free(seen);
                return 1;
            }
            break;
        case DL_STEP_WRITE:
            if (event->kind == DEVILANG_EV_MMIO_WRITE) {
                if (event_signature != 0 &&
                    !dl_step_reaches_event_signature(
                        step, event_signature, event_kind_mask)) {
                    break;
                }
                free(work);
                free(seen);
                return 1;
            }
            break;
        default:
            break;
        }
    }
    free(work);
    free(seen);
    return 0;
}"""
        )
        lines.append("")
        lines.append(
            """/* Count how many distinct active traces can plausibly consume
 * the immediate follow-up DMA event after a successful map. This is only used
 * as a tie-breaker when ranking speculative DMA recoveries. */
static size_t dl_count_active_followup_dma_support(
    const struct dl_machine_meta *machine_meta,
    size_t machine_index,
    const struct %s_machine *machine,
    const struct devilang_event *event) {
    struct devilang_event followup;
    unsigned char *seen = NULL;
    size_t support_count = 0;

    if (!machine_meta || !machine || !event ||
        event->kind != DEVILANG_EV_DMA ||
        event->dma_opcode != %d) {
        return 0;
    }
    followup = *event;
    followup.dma_opcode = %d;
    seen = calloc(machine_meta->nr_traces, sizeof(*seen));
    if (!seen) {
        for (size_t i = 0; i < machine->active_count; ++i) {
            const struct dl_cursor *cursor = &machine->active[i];
            int duplicate = 0;
            if (cursor->machine != (int)machine_index ||
                cursor->trace < 0 ||
                (size_t)cursor->trace >= machine_meta->nr_traces) {
                continue;
            }
            for (size_t j = 0; j < i; ++j) {
                if (machine->active[j].machine == cursor->machine &&
                    machine->active[j].trace == cursor->trace) {
                    duplicate = 1;
                    break;
                }
            }
            if (duplicate) {
                continue;
            }
            if (dl_trace_probe_supports_event(
                    machine_meta,
                    machine_index,
                    cursor->trace,
                    &followup)) {
                support_count += 1;
            }
        }
        return support_count;
    }
    for (size_t i = 0; i < machine->active_count; ++i) {
        const struct dl_cursor *cursor = &machine->active[i];
        if (cursor->machine != (int)machine_index ||
            cursor->trace < 0 ||
            (size_t)cursor->trace >= machine_meta->nr_traces ||
            seen[cursor->trace]) {
            continue;
        }
        seen[cursor->trace] = 1;
        if (dl_trace_probe_supports_event(
                machine_meta,
                machine_index,
                cursor->trace,
                &followup)) {
            support_count += 1;
        }
    }
    free(seen);
    return support_count;
}"""
            % (
                self.symbol_prefix,
                DMA_OP_IDS["map"],
                DMA_OP_IDS["unmap"],
            )
        )
        lines.append("")
        lines.append(
            """/* After a successful DMA map recovery, keep only runtime traces
 * that can also accept the matching follow-up DMA event. This narrows the
 * restored active set before later unmap/complete traffic arrives. */
static void dl_filter_active_to_followup_dma_support(
    const struct dl_machine_meta *machine_meta,
    size_t machine_index,
    struct %s_machine *machine,
    const struct devilang_event *event) {
    struct devilang_event followup;
    struct dl_cursor *filtered = NULL;
    size_t filtered_count = 0;
    unsigned char *seen = NULL;
    int keep_any = 0;

    if (!machine_meta || !machine || !event ||
        machine_index != 1 ||
        event->kind != DEVILANG_EV_DMA ||
        event->dma_opcode != %d) {
        return;
    }
    followup = *event;
    followup.dma_opcode = %d;
    filtered = calloc(%s_MAX_CURSORS, sizeof(*filtered));
    seen = calloc(machine_meta->nr_traces, sizeof(*seen));
    if (!filtered || !seen) {
        size_t write_index = 0;
        int fallback_keep_any = 0;

        for (size_t i = 0; i < machine->active_count; ++i) {
            const struct dl_cursor *cursor = &machine->active[i];
            int supports_followup = 0;
            int duplicate = 0;

            if (cursor->machine != (int)machine_index ||
                cursor->trace < 0 ||
                (size_t)cursor->trace >= machine_meta->nr_traces) {
                continue;
            }
            if (seen) {
                duplicate = seen[cursor->trace] != 0;
            } else {
                for (size_t j = 0; j < i; ++j) {
                    if (machine->active[j].machine == cursor->machine &&
                        machine->active[j].trace == cursor->trace) {
                        duplicate = 1;
                        break;
                    }
                }
            }
            if (duplicate) {
                supports_followup = 1;
            } else {
                supports_followup = dl_trace_probe_supports_event(
                    machine_meta,
                    machine_index,
                    cursor->trace,
                    &followup);
                if (supports_followup && seen) {
                    seen[cursor->trace] = 1;
                }
            }
            if (!supports_followup) {
                continue;
            }
            fallback_keep_any = 1;
            if (write_index != i) {
                machine->active[write_index] = machine->active[i];
            }
            write_index++;
        }
        free(filtered);
        free(seen);
        if (fallback_keep_any) {
            machine->active_count = write_index;
            dl_compact_cursor_set_relaxed(machine->active,
                                          &machine->active_count);
        }
        return;
    }
    for (size_t i = 0; i < machine->active_count; ++i) {
        const struct dl_cursor *cursor = &machine->active[i];
        int supports_followup = 0;
        if (cursor->machine != (int)machine_index ||
            cursor->trace < 0 ||
            (size_t)cursor->trace >= machine_meta->nr_traces) {
            continue;
        }
        if (seen[cursor->trace]) {
            supports_followup = 1;
        } else {
            supports_followup = dl_trace_probe_supports_event(
                machine_meta,
                machine_index,
                cursor->trace,
                &followup);
            if (supports_followup) {
                seen[cursor->trace] = 1;
            }
        }
        if (!supports_followup) {
            continue;
        }
        keep_any = 1;
        dl_push_cursor(filtered, &filtered_count, cursor);
    }
    if (!keep_any) {
        free(filtered);
        free(seen);
        return;
    }
    memcpy(machine->active, filtered, sizeof(filtered[0]) * filtered_count);
    machine->active_count = filtered_count;
    dl_compact_cursor_set_relaxed(machine->active, &machine->active_count);
    free(filtered);
    free(seen);
}"""
            % (
                self.symbol_prefix,
                DMA_OP_IDS["map"],
                DMA_OP_IDS["unmap"],
                self.symbol_prefix.upper(),
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
    size_t *out_count,
    int target_event_kind,
    uint64_t target_event_signature,
    const struct devilang_event *event) {
    struct dl_cursor *local = calloc(%s_MAX_CURSORS, sizeof(*local));
    size_t local_count = 1;
    int has_live = 0;
    int activated_transition = 0;
    int closure_ok = 0;
    if (!local) {
        /* Preserve the incoming cursor on transient allocation failure so
         * callers do not accidentally drop a live frontier member. */
        dl_push_cursor(out, out_count, cursor);
        return;
    }
    local[0] = *cursor;
    closure_ok = dl_closure(machine_meta, machine_idx, steps, local, &local_count,
                            target_event_kind, target_event_signature);
    if (!closure_ok) {
        dl_push_cursor(out, out_count, cursor);
        free(local);
        return;
    }
    for (size_t i = 0; i < local_count; ++i) {
        if (local[i].step >= 0) {
            has_live = 1;
        }
    }
    for (size_t i = 0; i < local_count; ++i) {
        const struct dl_trace_meta *trace_meta;
        int keep_cursor = 1;
        if (local[i].step < 0) {
            continue;
        }
        if (cursor->probe_mode &&
            local[i].score == 0 &&
            target_event_kind != 0) {
            const int want_mask = dl_event_kind_mask(target_event_kind);
            const int step_mask = dl_step_kind_mask(&steps[local[i].step]);
            if (want_mask != 0 && step_mask != want_mask) {
                keep_cursor = 0;
            }
        }
        if (!keep_cursor) {
            continue;
        }
        if (!dl_observable_step_matches_event(
                machine_meta, &steps[local[i].step], &local[i], event)) {
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
        machine_step_count_cases = []
        for machine_index in range(len(machines)):
            machine_step_cases.append(
                "    if (machine_index == %d) {\n        return %s_machine_%d_steps;\n    }"
                % (machine_index, self.symbol_prefix, machine_index)
            )
            machine_step_count_cases.append(
                "    if (machine_index == %d) {\n        return %d;\n    }"
                % (machine_index, len(compiled[machine_index][0]))
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
            """static size_t dl_nr_steps_for_machine(size_t machine_index) {
%s
    return 0;
}"""
            % ("\n".join(machine_step_count_cases))
        )
        lines.append("")
        lines.append(
            """void %s_init(struct %s_machine *machine) {
    memset(machine, 0, sizeof(*machine));
    const struct dl_machine_meta *meta = &%s_machines[0];
    struct dl_cursor base;
    memset(&base, 0, sizeof(base));
    base.machine = 0;
    base.probe_mode = 0;
    machine->booting_resume.trace = -1;
    machine->booting_resume.step = -1;
    if (meta->nr_transitions > 0 && meta->initial_state >= 0) {
        dl_activate_state(meta, 0, &base, meta->initial_state, machine->active,
                          &machine->active_count);
    } else {
        dl_activate_initial(meta, 0, &base, machine->active, &machine->active_count);
    }
    (void)dl_closure(meta, 0, %s_machine_0_steps, machine->active,
                     &machine->active_count, 0, 0);
}"""
            % (self.symbol_prefix, self.symbol_prefix, self.symbol_prefix, self.symbol_prefix)
        )
        lines.append(
            """static void dl_normalize_active_set(
    struct %s_machine *machine,
    const struct devilang_event *event) {
    struct dl_cursor *expanded = calloc(%s_MAX_CURSORS, sizeof(*expanded));
    size_t expanded_count = 0;
    if (!expanded) {
        /* Preserve the current active frontier on transient allocation
         * failure instead of erasing runtime state. */
        return;
    }

    for (size_t i = 0; i < machine->active_count; ++i) {
        const struct dl_machine_meta *meta =
            &%s_machines[machine->active[i].machine];
        const struct dl_step *steps = dl_steps_for_machine(machine->active[i].machine);
        const int target_event_kind = event ? event->kind : 0;
        const uint64_t target_event_signature =
            event ? dl_event_signature_mask(machine->active[i].machine, event) : 0;
        if (!steps) {
            continue;
        }
        dl_sync_cursor_trace_from_step(meta, &machine->active[i]);
        if (!dl_cursor_step_matches_trace(&machine->active[i])) {
            continue;
        }
        dl_expand_cursor(meta, machine->active[i].machine, steps,
                         &machine->active[i], expanded, &expanded_count,
                         target_event_kind, target_event_signature, event);
    }

    dl_compact_cursor_set_relaxed(expanded, &expanded_count);
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
            """static void dl_activate_runtime_idle(
    struct %s_machine *machine) {
    const struct dl_machine_meta *runtime_meta;
    struct dl_cursor base;

    if (!machine || %d < 2) {
        return;
    }

    runtime_meta = &%s_machines[1];
    memset(&base, 0, sizeof(base));
    base.machine = 1;
    base.probe_mode = 0;
    base.probe_budget = 0;

    if (runtime_meta->nr_transitions > 0 && runtime_meta->initial_state >= 0) {
        dl_activate_state(runtime_meta, 1, &base, runtime_meta->initial_state,
                          machine->active, &machine->active_count);
    } else {
        dl_activate_initial(runtime_meta, 1, &base, machine->active,
                            &machine->active_count);
    }
    machine->runtime_started = 1;
}"""
            % (
                self.symbol_prefix,
                len(machines),
                self.symbol_prefix,
            )
        )
        lines.append("")
        lines.append(
            """static void dl_activate_booting_resume(
    struct %s_machine *machine) {
    const struct dl_machine_meta *booting_meta;
    struct dl_cursor base;

    if (!machine || machine->booting_complete ||
        !machine->booting_resume_valid || %d < 1) {
        return;
    }

    booting_meta = &%s_machines[0];
    memset(&base, 0, sizeof(base));
    base.machine = 0;
    base.state = machine->booting_resume_state;
    base.trace = -1;
    base.step = -1;
    base.probe_mode = 1;
    base.probe_budget = 255;

    machine->active_count = 0;
    machine->matched_count = 0;
    machine->runtime_started = 0;

    if (machine->booting_resume.trace >= 0 &&
        machine->booting_resume.step >= 0) {
        const struct dl_step *steps = dl_steps_for_machine(0);
        machine->active_count = 1;
        machine->active[0] = machine->booting_resume;
        machine->active[0].probe_mode = 0;
        if (machine->active[0].score == 0) {
            machine->active[0].score = 1;
        }
        machine->active[0].probe_budget = 0;
        while (steps &&
               machine->active[0].step >= 0 &&
               machine->active[0].call_depth > 0) {
            const struct dl_step *resume_step =
                &steps[machine->active[0].step];
            if (resume_step->kind != DL_STEP_END) {
                break;
            }
            machine->active[0].call_depth--;
            machine->active[0].trace =
                machine->active[0].return_traces[machine->active[0].call_depth];
            machine->active[0].step =
                machine->active[0].return_steps[machine->active[0].call_depth];
        }
        return;
    }

    if (booting_meta->nr_transitions > 0) {
        dl_activate_state(booting_meta, 0, &base, machine->booting_resume_state,
                          machine->active, &machine->active_count);
    }
}"""
            % (
                self.symbol_prefix,
                len(machines),
                self.symbol_prefix,
            )
        )
        lines.append("")
        lines.append(
            """static int dl_active_set_is_runtime_idle(
    const struct %s_machine *machine) {
    if (!machine || machine->active_count == 0) {
        return 0;
    }
    for (size_t i = 0; i < machine->active_count; ++i) {
        const struct dl_cursor *cursor = &machine->active[i];
        if (cursor->machine == 0 ||
            cursor->score != 0 ||
            cursor->call_depth != 0) {
            return 0;
        }
    }
    return 1;
}"""
            % self.symbol_prefix
        )
        lines.append("")
        lines.append(
            """static int dl_has_live_active(
    const struct %s_machine *machine) {
    if (!machine) {
        return 0;
    }
    for (size_t i = 0; i < machine->active_count; ++i) {
        if (machine->active[i].step >= 0) {
            return 1;
        }
    }
    return 0;
}"""
            % self.symbol_prefix
        )
        lines.append("")
        lines.append(
            """static int dl_probe_has_runtime_match(
    const struct %s_machine *machine) {
    if (!machine) {
        return 0;
    }
    for (size_t i = 0; i < machine->matched_count; ++i) {
        const struct dl_cursor *cursor = &machine->matched[i];
        if (cursor->machine == 1 && cursor->trace >= 0) {
            return 1;
        }
    }
    return !dl_active_set_is_runtime_idle(machine);
}"""
            % self.symbol_prefix
        )
        lines.append("")
        lines.append(
            """int %s_feed_event(
    struct %s_machine *machine,
    const struct devilang_event *event) {
    struct dl_cursor *next = calloc(%s_MAX_CURSORS, sizeof(*next));
    struct dl_cursor *saved_active = calloc(%s_MAX_CURSORS, sizeof(*saved_active));
    size_t saved_active_count = 0;
    int queue_notify_queue_hint = -1;
    int has_known_signature = 0;
    int queue_notify_signature_seen = 0;
    size_t next_count = 0;
    if (!next || !saved_active) {
        free(next);
        free(saved_active);
        return -1;
    }
#define DL_FEED_EVENT_RETURN(value) \
    do { \
        free(next); \
        free(saved_active); \
        return (value); \
    } while (0)
    for (size_t i = 0; i < machine->active_count; ++i) {
        dl_sync_cursor_trace_from_step(
            dl_machine_meta_for_index(machine->active[i].machine),
            &machine->active[i]);
    }
    next_count = 0;
    if (event &&
        (event->kind == DEVILANG_EV_MMIO_READ ||
         event->kind == DEVILANG_EV_MMIO_WRITE ||
         event->kind == DEVILANG_EV_DMA)) {
        saved_active_count = machine->active_count;
        if (saved_active_count > %s_MAX_CURSORS) {
            saved_active_count = %s_MAX_CURSORS;
        }
        if (saved_active_count > 0) {
            memcpy(saved_active, machine->active,
                   sizeof(saved_active[0]) * saved_active_count);
        }
        for (size_t i = 0; i < machine->active_count; ++i) {
            uint64_t signature =
                dl_event_signature_mask(machine->active[i].machine, event);
            if (signature != 0) {
                has_known_signature = 1;
            }
            if (signature == %s_queue_notify_write_signature) {
                queue_notify_signature_seen = 1;
            }
        }
    }
    if (!queue_notify_signature_seen &&
        dl_is_queue_notify_event(event)) {
        queue_notify_signature_seen = 1;
    }
    if (queue_notify_signature_seen) {
        queue_notify_queue_hint = dl_queue_notify_queue_hint(event);
    }
    dl_record_queue_desc_mmio_hint(machine, event);
    dl_normalize_active_set(machine, event);

    for (size_t i = 0; i < machine->active_count; ++i) {
        struct dl_cursor cursor = machine->active[i];
        dl_sync_cursor_trace_from_step(dl_machine_meta_for_index(cursor.machine), &cursor);
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
            if (!dl_mmio_event_schema_matches(event)) {
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
            if (!dl_mmio_event_schema_matches(event)) {
                continue;
            }
            if (!dl_match_write_value(%s_machines[cursor.machine].exprs, step->value, &cursor, event->value)) {
                continue;
            }
            cursor.step = step->next_a;
            cursor.score += 1;
            dl_push_cursor(next, &next_count, &cursor);
            continue;
        }
        if (step->kind == DL_STEP_DMA) {
            uint32_t pointer_bonus = 0;
            if (event->kind != DEVILANG_EV_DMA) {
                continue;
            }
            if ((uint32_t)step->dma_op != event->dma_opcode ||
                (uint32_t)step->dma_dir != event->dma_dir ||
                !dl_dma_path_matches((uint32_t)step->dma_path,
                                     event->dma_path)) {
                if (dl_debug_dma_enabled()) {
                    fprintf(stderr,
                            "dma-miss reason=opcode-dir-path trace=%%d step=%%d step_op=%%d event_op=%%u step_dir=%%d event_dir=%%u step_path=%%d event_path=%%u\\n",
                            cursor.trace,
                            cursor.step,
                            step->dma_op,
                            event->dma_opcode,
                            step->dma_dir,
                            event->dma_dir,
                            step->dma_path,
                            event->dma_path);
                }
                continue;
            }
            if (!dl_match_dma_addr(%s_machines[cursor.machine].exprs, step->addr, &cursor, event->dma_addr)) {
                if (dl_debug_dma_enabled()) {
                    fprintf(stderr,
                            "dma-miss reason=addr trace=%%d step=%%d event_addr=0x%%llx\\n",
                            cursor.trace,
                            cursor.step,
                            (unsigned long long)event->dma_addr);
                }
                continue;
            }
            if (!dl_match_dma_len(%s_machines[cursor.machine].exprs, step->value, &cursor, event->dma_len)) {
                if (dl_debug_dma_enabled()) {
                    fprintf(stderr,
                            "dma-miss reason=len trace=%%d step=%%d event_len=%%u\\n",
                            cursor.trace,
                            cursor.step,
                            event->dma_len);
                }
                continue;
            }
            if (!dl_dma_kind_matches(step->dma_data_kind, event)) {
                if (dl_debug_dma_enabled()) {
                    fprintf(stderr,
                            "dma-miss reason=kind trace=%%d step=%%d kind=%%d event_len=%%u\\n",
                            cursor.trace,
                            cursor.step,
                            step->dma_data_kind,
                            event->dma_len);
                }
                continue;
            }
            if (!dl_dma_type_matches(step->dma_data_type, &%s_machines[cursor.machine], event)) {
                if (dl_debug_dma_enabled()) {
                    fprintf(stderr,
                            "dma-miss reason=type trace=%%d step=%%d type=%%d event_len=%%u\\n",
                            cursor.trace,
                            cursor.step,
                            step->dma_data_type,
                            event->dma_len);
                }
                continue;
            }
            pointer_bonus = dl_pointer_hint_score(machine, event->dma_addr, step->dma_data_type);
            cursor.step = step->next_a;
            cursor.score += 2 + pointer_bonus;
            dl_push_cursor(next, &next_count, &cursor);
            if (step->dma_data_type >= 0) {
                dl_record_pointer_hints_from_event(
                    machine,
                    &%s_machines[cursor.machine],
                    step->dma_data_type,
                    event,
                    cursor.score);
            }
        }
    }
    if (next_count == 0) {
        if (event->kind == DEVILANG_EV_DMA &&
            dl_resume_pending_dma_context(machine, event)) {
            DL_FEED_EVENT_RETURN(%s_feed_event(machine, event));
        }
        if (!machine->probe_mode &&
            event->kind == DEVILANG_EV_DMA &&
            dl_try_pending_async_dma(machine, event)) {
            DL_FEED_EVENT_RETURN(0);
        }
        if (event->kind != DEVILANG_EV_DMA &&
            dl_validate_dma_aperture_event(event)) {
            machine->matched_count = machine->active_count;
            memcpy(machine->matched, machine->active,
                   sizeof(machine->matched[0]) * machine->active_count);
            DL_FEED_EVENT_RETURN(machine->active_count > 0 ? 0 : 1);
        }
        if (!machine->probe_mode &&
            !machine->booting_complete &&
            event->kind == DEVILANG_EV_MMIO_READ) {
            if (!has_known_signature) {
                machine->active_count = saved_active_count;
                if (saved_active_count > 0) {
                    memcpy(machine->active, saved_active,
                           sizeof(saved_active[0]) * saved_active_count);
                    machine->matched_count = saved_active_count;
                    memcpy(machine->matched, saved_active,
                           sizeof(saved_active[0]) * saved_active_count);
                } else {
                    machine->matched_count = 0;
                }
                DL_FEED_EVENT_RETURN(saved_active_count > 0 ? 0 : 1);
            }
            if (machine->active_count == 0 &&
                machine->booting_resume_valid) {
                dl_activate_booting_resume(machine);
            }
            machine->matched_count = machine->active_count;
            if (machine->active_count > 0) {
                memcpy(machine->matched, machine->active,
                       sizeof(machine->matched[0]) * machine->active_count);
            }
            DL_FEED_EVENT_RETURN(machine->active_count > 0 ? 0 : 1);
        }
        if (!machine->probe_mode &&
            !machine->booting_complete &&
            machine->booting_resume_valid &&
            (event->kind == DEVILANG_EV_MMIO_WRITE ||
             event->kind == DEVILANG_EV_DMA)) {
            struct %s_machine *probe;
            int probe_rc = -1;

            probe = calloc(1, sizeof(*probe));
            if (probe) {
                *probe = *machine;
                probe->probe_mode = 1;
                probe->active_count = 0;
                probe->matched_count = 0;
                probe->booting_resume.trace = -1;
                probe->booting_resume.step = -1;
                dl_activate_booting_resume(probe);
                if (probe->active_count > 0) {
                    probe_rc = %s_feed_event(probe, event);
                }
                if (probe_rc == 0 && probe->matched_count > 0) {
                    *machine = *probe;
                    machine->probe_mode = 0;
                    free(probe);
                    DL_FEED_EVENT_RETURN(0);
                }
                free(probe);
            }
        }
        if (machine->booting_complete &&
            dl_is_transport_noise_event(event)) {
            machine->matched_count = machine->active_count;
            memcpy(machine->matched, machine->active,
                   sizeof(machine->matched[0]) * machine->active_count);
            DL_FEED_EVENT_RETURN(0);
        }
        /* Large queue0 from-device DMA commonly corresponds to RX refill /
         * completion traffic. Probe these traces before the generic
         * runtime-idle fallback so they are not masked by broad idle
         * entry-surface recovery. */
        if (!machine->probe_mode &&
            event->kind == DEVILANG_EV_DMA &&
            %d >= 2 &&
            event->dma_dir == %d &&
            event->dma_queue == 0 &&
            event->dma_len >= 256) {
            const struct dl_machine_meta *runtime_meta = &%s_machines[1];
            for (size_t trace_index = 0;
                 trace_index < runtime_meta->nr_traces;
                 ++trace_index) {
                const struct dl_trace_meta *trace_meta =
                    &runtime_meta->traces[trace_index];
                struct %s_machine *probe;
                struct dl_cursor base;
                int probe_rc;

                if (trace_meta->start_step < 0 ||
                    !dl_trace_runtime_rx_refill_candidate(
                        trace_meta->name) ||
                    !dl_trace_runtime_rx_refill_len_matches(
                        trace_meta->name,
                        event)) {
                    continue;
                }
                if (!dl_trace_probe_supports_event(
                        runtime_meta,
                        1,
                        (int)trace_index,
                        event)) {
                    if (dl_debug_dma_enabled()) {
                        fprintf(stderr,
                                "runtime-rx-probe skip trace=%%s reason=supports_event_false len=%%u addr=0x%%llx\\n",
                                trace_meta->name,
                                event->dma_len,
                                (unsigned long long)event->dma_addr);
                    }
                    continue;
                }

                probe = calloc(1, sizeof(*probe));
                if (!probe) {
                    continue;
                }
                probe->booting_complete = 1;
                probe->runtime_started = 1;
                probe->probe_mode = 1;

                memset(&base, 0, sizeof(base));
                base.machine = 1;
                base.state = -1;
                base.trace = (int)trace_index;
                base.step = trace_meta->start_step;
                base.probe_mode = 1;
                base.probe_budget = 24;
                dl_seed_cursor_from_dma_event(runtime_meta, &base, event);
                {
                    int matching_dma_step =
                        dl_find_matching_dma_step_in_trace(
                            runtime_meta,
                            1,
                            (int)trace_index,
                            &base,
                            event);
                    if (matching_dma_step >= 0) {
                        base.step = matching_dma_step;
                    }
                }
                dl_push_cursor(probe->active, &probe->active_count, &base);

                probe_rc = %s_feed_event(probe, event);
                if (probe_rc == 0 &&
                    probe->matched_count > 0 &&
                    dl_probe_has_runtime_match(probe)) {
                    machine->runtime_started = 1;
                    machine->matched_count = probe->matched_count;
                    memcpy(machine->matched, probe->matched,
                           sizeof(machine->matched[0]) * probe->matched_count);
                    machine->active_count = probe->active_count;
                    memcpy(machine->active, probe->active,
                           sizeof(machine->active[0]) * probe->active_count);
                    free(probe);
                    DL_FEED_EVENT_RETURN(0);
                }
                free(probe);
            }
        }
        if (dl_active_set_is_runtime_idle(machine)) {
            if (machine->probe_mode) {
                machine->matched_count = 0;
                DL_FEED_EVENT_RETURN(1);
            }
            for (size_t active_index = 0;
                 active_index < machine->active_count;
                 ++active_index) {
                struct %s_machine *probe;
                struct dl_cursor base;
                int probe_rc;

                if (machine->active[active_index].machine != 1) {
                    continue;
                }

                probe = calloc(1, sizeof(*probe));
                if (!probe) {
                    continue;
                }
                probe->booting_complete = 1;
                probe->runtime_started = 1;
                probe->probe_mode = 1;

                base = machine->active[active_index];
                base.probe_mode = 1;
                base.probe_budget = 24;
                if (!dl_trace_matches_runtime_queue_hint(
                        &base,
                        queue_notify_queue_hint)) {
                    free(probe);
                    continue;
                }
                if (event->kind == DEVILANG_EV_DMA &&
                    event->dma_queue <= 2) {
                    const char *trace_name =
                        %s_machines[1].traces[base.trace].name;
                    const int queue_hint =
                        dl_trace_runtime_queue_hint(trace_name);
                    if (queue_hint >= 0 &&
                        queue_hint != (int)event->dma_queue) {
                        free(probe);
                        continue;
                    }
                }
                if ((event->kind == DEVILANG_EV_DMA ||
                     event->kind == DEVILANG_EV_MMIO_READ ||
                     event->kind == DEVILANG_EV_MMIO_WRITE) &&
                    !dl_trace_probe_supports_event(
                        &%s_machines[1],
                        1,
                        base.trace,
                        event)) {
                    free(probe);
                    continue;
                }
                if (event->kind == DEVILANG_EV_MMIO_READ ||
                    event->kind == DEVILANG_EV_MMIO_WRITE) {
                    int matching_mmio_step =
                        dl_find_matching_mmio_step_in_trace(
                            1,
                            base.trace,
                            &base,
                            event);
                    if (matching_mmio_step >= 0) {
                        base.step = matching_mmio_step;
                    }
                }
                dl_push_cursor(probe->active, &probe->active_count, &base);

                probe_rc = %s_feed_event(probe, event);
                if (probe_rc == 0 &&
                    probe->matched_count > 0 &&
                    dl_probe_has_runtime_match(probe)) {
                    machine->runtime_started = 1;
                    machine->matched_count = probe->matched_count;
                    memcpy(machine->matched, probe->matched,
                           sizeof(machine->matched[0]) * probe->matched_count);
                    machine->active_count = probe->active_count;
                    memcpy(machine->active, probe->active,
                           sizeof(machine->active[0]) * probe->active_count);
                    free(probe);
                    DL_FEED_EVENT_RETURN(0);
                }
                free(probe);
            }
            machine->matched_count = 0;
            if (dl_is_driver_ok_status_event(event)) {
                dl_activate_runtime_idle(machine);
            }
            DL_FEED_EVENT_RETURN(0);
        }
        if (machine->booting_complete &&
            !dl_has_live_active(machine) &&
            event->kind == DEVILANG_EV_MMIO_READ) {
            machine->matched_count = 0;
            machine->active_count = 0;
            if (dl_is_driver_ok_status_event(event)) {
                dl_activate_runtime_idle(machine);
            }
            DL_FEED_EVENT_RETURN(0);
        }
        if (!machine->probe_mode &&
            event->kind == DEVILANG_EV_DMA &&
            %d >= 2) {
            const struct dl_machine_meta *runtime_meta = &%s_machines[1];
            if (!(event->dma_dir == %d &&
                  event->dma_queue == 0 &&
                  event->dma_len >= 256)) {
                for (size_t transition_index = 0;
                     transition_index < runtime_meta->nr_transitions;
                     ++transition_index) {
                    const struct dl_transition *transition =
                        &runtime_meta->transitions[transition_index];
                    struct %s_machine *probe;
                    struct dl_cursor base;
                    const struct dl_trace_meta *trace_meta;
                    int probe_rc;

                    if (transition->src_state != runtime_meta->initial_state ||
                        transition->trace < 0 ||
                        (size_t)transition->trace >= runtime_meta->nr_traces) {
                        continue;
                    }

                    probe = calloc(1, sizeof(*probe));
                    if (!probe) {
                        continue;
                    }
                    probe->booting_complete = 1;
                    probe->runtime_started = 1;
                    probe->probe_mode = 1;

                    memset(&base, 0, sizeof(base));
                    base.machine = 1;
                    base.state = -1;
                    base.trace = transition->trace;
                    trace_meta = &runtime_meta->traces[transition->trace];
                    base.step = trace_meta->start_step + transition->start_offset;
                    if (!dl_trace_matches_runtime_queue_hint(
                            &base,
                            queue_notify_queue_hint)) {
                        free(probe);
                        continue;
                    }
                    if (event->dma_queue <= 2) {
                        const char *trace_name = runtime_meta->traces[base.trace].name;
                        const int queue_hint =
                            dl_trace_runtime_queue_hint(trace_name);
                        if (queue_hint >= 0 &&
                            queue_hint != (int)event->dma_queue) {
                            free(probe);
                            continue;
                        }
                    }
                    if (!dl_trace_probe_supports_event(
                            runtime_meta,
                            1,
                            base.trace,
                            event)) {
                        free(probe);
                        continue;
                    }
                    base.probe_mode = 1;
                    base.probe_budget = 24;
                    dl_push_cursor(probe->active, &probe->active_count, &base);

                    probe_rc = %s_feed_event(probe, event);
                    if (probe_rc == 0 &&
                        probe->matched_count > 0 &&
                        dl_probe_has_runtime_match(probe)) {
                        machine->runtime_started = 1;
                        machine->matched_count = probe->matched_count;
                        memcpy(machine->matched, probe->matched,
                               sizeof(machine->matched[0]) * probe->matched_count);
                        machine->active_count = probe->active_count;
                        memcpy(machine->active, probe->active,
                               sizeof(machine->active[0]) * probe->active_count);
                        free(probe);
                        DL_FEED_EVENT_RETURN(0);
                    }
                    free(probe);
                }
            }
        }
        if (machine->booting_complete &&
            !dl_has_live_active(machine) &&
            %d >= 2) {
            const struct dl_machine_meta *runtime_meta = &%s_machines[1];
            for (size_t transition_index = 0;
                 transition_index < runtime_meta->nr_transitions;
                 ++transition_index) {
                const struct dl_transition *transition =
                    &runtime_meta->transitions[transition_index];
                struct %s_machine *probe;
                struct dl_cursor base;
                const struct dl_trace_meta *trace_meta;
                int probe_rc;

                if (transition->src_state != runtime_meta->initial_state ||
                    transition->trace < 0 ||
                    (size_t)transition->trace >= runtime_meta->nr_traces) {
                    continue;
                }

                probe = calloc(1, sizeof(*probe));
                if (!probe) {
                    continue;
                }
                probe->booting_complete = 1;
                probe->runtime_started = 1;
                probe->probe_mode = 1;

                    memset(&base, 0, sizeof(base));
                    base.machine = 1;
                    base.state = -1;
                    base.trace = transition->trace;
                    trace_meta = &runtime_meta->traces[transition->trace];
                    base.step = trace_meta->start_step + transition->start_offset;
                    if (!dl_trace_matches_runtime_queue_hint(
                            &base,
                            queue_notify_queue_hint)) {
                        free(probe);
                        continue;
                    }
                if (event->kind == DEVILANG_EV_DMA) {
                    if (!dl_trace_has_pointer_hint_target(
                            machine,
                            runtime_meta,
                            1,
                            transition->trace,
                            base.step,
                            event->dma_addr)) {
                        free(probe);
                        continue;
                    }
                } else if (event->kind == DEVILANG_EV_MMIO_READ ||
                           event->kind == DEVILANG_EV_MMIO_WRITE) {
                    if (!dl_trace_probe_supports_event(
                            runtime_meta,
                            1,
                            transition->trace,
                            event)) {
                        free(probe);
                        continue;
                    }
                    if (event->kind == DEVILANG_EV_MMIO_READ ||
                        event->kind == DEVILANG_EV_MMIO_WRITE) {
                        int matching_mmio_step =
                            dl_find_matching_mmio_step_in_trace(
                                1,
                                transition->trace,
                                &base,
                                event);
                        if (matching_mmio_step >= 0) {
                            base.step = matching_mmio_step;
                        }
                    }
                } else {
                    free(probe);
                    continue;
                }
                base.probe_mode = 1;
                base.probe_budget = 24;
                dl_push_cursor(probe->active, &probe->active_count, &base);

                probe_rc = %s_feed_event(probe, event);
                if (probe_rc == 0 &&
                    probe->matched_count > 0 &&
                    dl_probe_has_runtime_match(probe)) {
                    machine->runtime_started = 1;
                    machine->matched_count = probe->matched_count;
                    memcpy(machine->matched, probe->matched,
                           sizeof(machine->matched[0]) * probe->matched_count);
                    machine->active_count = probe->active_count;
                    memcpy(machine->active, probe->active,
                           sizeof(machine->active[0]) * probe->active_count);
                    free(probe);
                    DL_FEED_EVENT_RETURN(0);
                }
                free(probe);
            }
            machine->matched_count = 0;
            if (dl_is_driver_ok_status_event(event)) {
                dl_activate_runtime_idle(machine);
            }
            DL_FEED_EVENT_RETURN(0);
        }
        if (!machine->probe_mode &&
            machine->booting_complete &&
            event->kind == DEVILANG_EV_DMA) {
            machine->matched_count = 0;
            machine->active_count = 0;
            DL_FEED_EVENT_RETURN(0);
        }
        machine->matched_count = 0;
        if (!has_known_signature &&
            event &&
            (event->kind == DEVILANG_EV_MMIO_READ ||
             event->kind == DEVILANG_EV_MMIO_WRITE)) {
            machine->active_count = saved_active_count;
            if (saved_active_count > 0) {
                memcpy(machine->active, saved_active,
                       sizeof(saved_active[0]) * saved_active_count);
                machine->matched_count = saved_active_count;
                memcpy(machine->matched, saved_active,
                       sizeof(saved_active[0]) * saved_active_count);
            }
            DL_FEED_EVENT_RETURN(0);
        }
        machine->active_count = 0;
        DL_FEED_EVENT_RETURN(1);
    }
    if (event->kind == DEVILANG_EV_DMA && saved_active_count > 0) {
        for (size_t saved_index = 0; saved_index < saved_active_count; ++saved_index) {
            const struct dl_cursor *saved = &saved_active[saved_index];

            if (saved->machine < 0) {
                continue;
            }
            dl_push_cursor(next, &next_count, saved);
        }
        dl_compact_cursor_set_relaxed(next, &next_count);
    }
    if (queue_notify_signature_seen &&
        event->kind == DEVILANG_EV_MMIO_WRITE) {
        dl_filter_cursor_set_by_runtime_queue_hint(next,
                                                   &next_count,
                                                   queue_notify_queue_hint);
        if (next_count > 0) {
            dl_filter_cursor_set_to_notify_impl(next, &next_count);
        }
        dl_compact_cursor_set_by_trace_step(next, &next_count);
        if (dl_debug_dma_enabled()) {
            fprintf(stderr,
                    "queue-notify pre-match queue=%%d next=%%zu saved=%%zu active=%%zu\\n",
                    queue_notify_queue_hint,
                    next_count,
                    saved_active_count,
                    machine->active_count);
        }
    }
    machine->matched_count = next_count;
    memcpy(machine->matched, next, sizeof(next[0]) * next_count);
    if (queue_notify_signature_seen &&
        event->kind == DEVILANG_EV_MMIO_WRITE) {
        dl_filter_cursor_set_by_runtime_queue_hint(machine->matched,
                                                   &machine->matched_count,
                                                   queue_notify_queue_hint);
        if (machine->matched_count > 0) {
            dl_filter_cursor_set_to_notify_impl(machine->matched,
                                                &machine->matched_count);
        }
        dl_compact_cursor_set_by_trace_step(machine->matched,
                                            &machine->matched_count);
    }
    if (event->kind == DEVILANG_EV_DMA) {
        machine->pending_async_count = 0;
    } else if (queue_notify_signature_seen &&
               event->kind == DEVILANG_EV_MMIO_WRITE &&
               saved_active_count > 0) {
        /* Queue notify is the boundary where synchronous control flow turns
         * into later DMA activity. Capture and normalize that frontier here
         * so subsequent DMA replay starts from a bounded async seed set. */
        /* Stage 1: snapshot the notify-side live cursors. */
        if (dl_debug_dma_enabled()) {
            fprintf(stderr, "queue-notify stage=record-notify saved=%%zu\\n",
                    saved_active_count);
        }
        dl_record_pending_async_notify(machine,
                                       saved_active,
                                       saved_active_count,
                                       queue_notify_queue_hint);
        /* Stage 2: add caller-return seeds that may resume closest to the
         * later DMA observable step. */
        if (dl_debug_dma_enabled()) {
            fprintf(stderr, "queue-notify stage=append-returns pending=%%zu\\n",
                    machine->pending_async_count);
        }
        dl_append_pending_async_returns(machine,
                                        saved_active,
                                        saved_active_count,
                                        queue_notify_queue_hint);
        /* Stage 3: keep only DMA-capable traces, then expand toward their
         * next observable DMA frontier. */
        if (dl_debug_dma_enabled()) {
            fprintf(stderr, "queue-notify stage=filter-dma pending=%%zu\\n",
                    machine->pending_async_count);
        }
        dl_filter_pending_async_to_dma_candidates(machine);
        if (dl_debug_dma_enabled()) {
            fprintf(stderr, "queue-notify stage=build-frontiers pending=%%zu\\n",
                    machine->pending_async_count);
        }
        dl_build_pending_async_dma_frontiers(machine);
        if (dl_debug_dma_enabled()) {
            fprintf(stderr, "queue-notify stage=post-frontiers pending=%%zu\\n",
                    machine->pending_async_count);
        }
        dl_compact_cursor_set_relaxed(next, &next_count);
        dl_compact_cursor_set_relaxed(machine->matched,
                                      &machine->matched_count);
        if (dl_debug_dma_enabled()) {
            fprintf(stderr,
                    "queue-notify post-pending queue=%%d next=%%zu matched=%%zu pending=%%zu\\n",
                    queue_notify_queue_hint,
                    next_count,
                    machine->matched_count,
                    machine->pending_async_count);
            if (queue_notify_queue_hint == 1) {
                for (size_t debug_index = 0;
                     debug_index < next_count && debug_index < 8;
                     ++debug_index) {
                    fprintf(stderr,
                            "queue-notify next[%%zu] trace=%%s step=%%d depth=%%d score=%%u\\n",
                            debug_index,
                            dl_debug_trace_name(&next[debug_index]),
                            next[debug_index].step,
                            next[debug_index].call_depth,
                            next[debug_index].score);
                }
            }
        }
    }
    int matched_booting_state = -1;
    struct dl_cursor matched_booting_cursor;
    int matched_booting_cursor_valid = 0;
    memset(&matched_booting_cursor, 0, sizeof(matched_booting_cursor));
    for (size_t i = 0; i < machine->matched_count; ++i) {
        const struct dl_cursor *cursor = &machine->matched[i];
        const struct dl_machine_meta *meta;
        if (cursor->machine != 0 || cursor->state <= 0) {
            continue;
        }
        meta = &%s_machines[cursor->machine];
        if ((size_t)(cursor->state + 1) >= meta->nr_states) {
            continue;
        }
        if (cursor->state > matched_booting_state) {
            matched_booting_state = cursor->state;
            matched_booting_cursor = *cursor;
            matched_booting_cursor_valid = 1;
        }
    }
    dl_compact_cursor_set_relaxed(next, &next_count);
    machine->active_count = next_count;
    memcpy(machine->active, next, sizeof(next[0]) * next_count);
    free(next);
    next = NULL;
    struct dl_cursor *expanded = calloc(%s_MAX_CURSORS, sizeof(*expanded));
    size_t expanded_count = 0;
    int has_live_booting = 0;
    int resume_state = -1;
    if (!expanded) {
        /* Treat this as a replay failure, but keep the machine snapshot
         * intact so callers can decide how to recover. */
        DL_FEED_EVENT_RETURN(-1);
    }
    for (size_t i = 0; i < machine->active_count; ++i) {
        const struct dl_machine_meta *meta = &%s_machines[machine->active[i].machine];
        const struct dl_step *steps = dl_steps_for_machine(machine->active[i].machine);
        const char *trace_name = dl_debug_trace_name(&machine->active[i]);
        if (!steps) {
            continue;
        }
        if (event &&
            event->kind == DEVILANG_EV_MMIO_WRITE &&
            queue_notify_signature_seen &&
            (strcmp(trace_name, "vm_notify_trace") == 0 ||
             strcmp(trace_name, "vm_notify_with_data_trace") == 0)) {
            dl_push_cursor(expanded, &expanded_count, &machine->active[i]);
            continue;
        }
        if (machine->active[i].step >= 0 &&
            steps[machine->active[i].step].kind == DL_STEP_END &&
            event &&
            event->kind == DEVILANG_EV_MMIO_WRITE &&
            dl_event_signature_mask(machine->active[i].machine, event) ==
                %s_queue_notify_write_signature) {
            dl_push_cursor(expanded, &expanded_count, &machine->active[i]);
            continue;
        }
        dl_expand_cursor(meta, machine->active[i].machine, steps,
                         &machine->active[i], expanded, &expanded_count,
                         0, 0, NULL);
    }
    for (size_t i = 0; i < expanded_count; ++i) {
        const struct dl_cursor *cursor = &expanded[i];
        const struct dl_machine_meta *meta;
        if (cursor->machine != 0 ||
            cursor->step >= 0 ||
            cursor->state <= 0) {
            continue;
        }
        meta = &%s_machines[cursor->machine];
        if ((size_t)(cursor->state + 1) >= meta->nr_states) {
            continue;
        }
        if (cursor->state > resume_state) {
            resume_state = cursor->state;
        }
    }
    dl_compact_cursor_set_relaxed(expanded, &expanded_count);
    machine->active_count = expanded_count;
    memcpy(machine->active, expanded, sizeof(expanded[0]) * expanded_count);
    if (dl_debug_dma_enabled() &&
        queue_notify_signature_seen &&
        event &&
        event->kind == DEVILANG_EV_MMIO_WRITE) {
        fprintf(stderr,
                "queue-notify post-expand queue=%%d expanded=%%zu matched=%%zu\\n",
                queue_notify_queue_hint,
                machine->active_count,
                machine->matched_count);
    }
    free(expanded);
    for (size_t i = 0; i < machine->active_count; ++i) {
        if (machine->active[i].machine == 0 && machine->active[i].step >= 0) {
            has_live_booting = 1;
            break;
        }
    }
    if (has_live_booting) {
        machine->booting_resume_valid = 0;
        machine->booting_resume.trace = -1;
        machine->booting_resume.step = -1;
    } else if (!machine->booting_complete &&
               matched_booting_cursor_valid) {
        machine->booting_resume = matched_booting_cursor;
        machine->booting_resume_valid = 0;
        machine->booting_complete = 0;
        machine->runtime_started = 0;
        machine->booting_resume_valid = 1;
        machine->booting_resume_state = matched_booting_cursor.state;
        dl_activate_booting_resume(machine);
        DL_FEED_EVENT_RETURN(machine->active_count > 0 ? 0 : -1);
    } else if (!machine->booting_complete &&
               (resume_state >= 0 || matched_booting_state >= 0)) {
        if (resume_state < 0) {
            resume_state = matched_booting_state;
        }
        machine->booting_resume.trace = -1;
        machine->booting_resume.step = -1;
        machine->booting_resume_state = resume_state;
        machine->booting_resume_valid = 1;
        machine->booting_complete = 0;
        dl_activate_booting_resume(machine);
        DL_FEED_EVENT_RETURN(machine->active_count > 0 ? 0 : -1);
    } else {
        machine->booting_resume_valid = 0;
        machine->booting_resume.trace = -1;
        machine->booting_resume.step = -1;
        machine->booting_complete = machine->booting_complete || !has_live_booting;
    }
    if (machine->booting_complete &&
        !(queue_notify_signature_seen &&
          event &&
          event->kind == DEVILANG_EV_MMIO_WRITE &&
          (machine->active_count > 0 ||
           machine->pending_async_count > 0))) {
        dl_activate_runtime_idle(machine);
    }
    if (machine->active_count == 0 &&
        dl_is_driver_ok_status_event(event)) {
        dl_activate_runtime_idle(machine);
    }
    DL_FEED_EVENT_RETURN(machine->active_count > 0 ? 0 : -1);
}
#undef DL_FEED_EVENT_RETURN
"""
            % (
                self.symbol_prefix,
                self.symbol_prefix,
                self.symbol_prefix.upper(),
                self.symbol_prefix.upper(),
                self.symbol_prefix.upper(),
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
                len(machines),
                DMA_DIR_IDS["from_device"],
                self.symbol_prefix,
                self.symbol_prefix,
                self.symbol_prefix,
                self.symbol_prefix,
                self.symbol_prefix,
                self.symbol_prefix,
                self.symbol_prefix,
                len(machines),
                self.symbol_prefix,
                DMA_DIR_IDS["from_device"],
                self.symbol_prefix,
                self.symbol_prefix,
                len(machines),
                self.symbol_prefix,
                self.symbol_prefix,
                self.symbol_prefix,
                self.symbol_prefix,
                self.symbol_prefix.upper(),
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
    const char *base_text;
    const char *addr_text;
    const char *len_text;
    const char *value_text;
    char token[1024];

    if (!line || !event) {
        return -1;
    }

    memset(event, 0, sizeof(*event));
    event->width = 0;

    if (strstr(line, "virtio_vring_map ") != NULL ||
        strstr(line, "virtio_vring_unmap ") != NULL) {
        size_t data_len = 0;

        event->kind = DEVILANG_EV_DMA;
        event->has_dma = 1;
        event->dma_path = 0xffffffffu;
        event->dma_status = 0;
        event->dma_opcode =
            strstr(line, "virtio_vring_unmap ") != NULL ? %d : %d;

        addr_text = dl_find_hex_value(line, "addr");
        if (!addr_text || dl_parse_u64_hex(addr_text, &event->dma_addr) != 0) {
            return -1;
        }

        len_text = dl_find_hex_value(line, "len");
        if (!len_text || dl_parse_u64_hex(len_text, &event->value) != 0) {
            return -1;
        }
        event->dma_len = (uint32_t)event->value;
        event->value = 0;

        if (dl_copy_token(line, "dir", token, sizeof(token)) == 0) {
            if (strcmp(token, "0") == 0) {
                event->dma_dir = %d;
            } else if (strcmp(token, "1") == 0) {
                event->dma_dir = %d;
            } else if (strcmp(token, "2") == 0) {
                event->dma_dir = %d;
            } else {
                return -1;
            }
        } else {
            return -1;
        }

        if (dl_copy_token(line, "queue", token, sizeof(token)) == 0) {
            char *end = NULL;
            unsigned long parsed = strtoul(token, &end, 10);

            if (!end || *end != '\\0') {
                return -1;
            }
            event->dma_queue = (uint32_t)parsed;
        }

        if (dl_copy_token(line, "data", event->dma_data, sizeof(event->dma_data)) != 0) {
            event->dma_data[0] = '\\0';
        }
        data_len = strlen(event->dma_data);
        if ((data_len & 1U) != 0U) {
            return -1;
        }
        event->dma_capture_len = (uint32_t)(data_len / 2U);
        return 0;
    } else if (strstr(line, "virtio_mmio_read ") != NULL) {
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
    if (dl_copy_token(line, "dma_path", token, sizeof(token)) == 0) {
        uint64_t parsed = 0;

        if (strcmp(token, "-") != 0 && dl_parse_u64_hex(token, &parsed) == 0) {
            event->dma_path = (uint32_t)parsed;
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
            char *separator = strchr(event->dma_data, ':');

            if (separator) {
                size_t view_len = (size_t)(separator - event->dma_data);
                if (view_len >= sizeof(event->dma_view)) {
                    view_len = sizeof(event->dma_view) - 1;
                }
                memcpy(event->dma_view, event->dma_data, view_len);
                event->dma_view[view_len] = '\\0';
                memmove(event->dma_data, separator + 1, strlen(separator + 1) + 1);
            }
            event->has_dma = 1;
        }
    }

    return 0;
}"""
            % (
                self.symbol_prefix,
                DMA_OP_IDS["unmap"],
                DMA_OP_IDS["map"],
                DMA_DIR_IDS["to_device"],
                DMA_DIR_IDS["from_device"],
                DMA_DIR_IDS["bidirectional"],
            )
        )
        lines.append("")
        lines.append(
            """int %s_feed_trace_line(
    struct %s_machine *machine,
    const char *line) {
    struct devilang_event event;
    uint64_t dma_aperture_offset = 0;

    if (%s_parse_trace_line(line, &event) != 0) {
        return -1;
    }

    if (event.kind == DEVILANG_EV_DMA &&
        dl_consume_pending_dma_duplicate(machine, &event)) {
        return 0;
    }

    if (dl_is_dma_aperture_event(&event)) {
        /* Aperture MMIO records are split into two phases:
         * 1. non-submit writes only update the aperture shadow state
         * 2. the submit/complete write at DL_HP_DMA_EVENT_OFFSET is converted
         *    into a raw pending_dma record, which the later synthesized DMA
         *    event can consume directly. */
        if (!dl_validate_dma_aperture_event(&event)) {
            return -1;
        }
        dma_aperture_offset = event.addr - event.base;
        if (dma_aperture_offset != DL_HP_DMA_EVENT_OFFSET) {
            return 0;
        }
        event.kind = DEVILANG_EV_DMA;
        dl_record_pending_dma_duplicate(machine, &event);
        return 0;
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
