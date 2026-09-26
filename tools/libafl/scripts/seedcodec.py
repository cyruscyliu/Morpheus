#!/usr/bin/env python3
"""Encode/decode the ScenarioInput v4 seed wire format.

Wire layout (all little-endian), see docs/fuzzing-seed-format.md:

    [ 4 B]  mmio entry count
    [n_m x] offset(u32) + n_v(u32) + n_v x u32 values
    [ 4 B]  dma.coherent count
    [n_c x] addr(u64) + n_e(u32) + n_e x (offset(u32) + n_v(u32) + n_v x u32)
    [to EOF] addr(u64) + n_e(u32) + n_e x (offset(u32) + n_v(u32) + n_v x u32)
"""
import json
import struct
import sys


class WordModel:
    """One modelled 32-bit word: byte offset plus visit-ordered values."""

    def __init__(self, offset, values):
        assert offset % 4 == 0
        assert len(values) >= 1
        self.offset = offset
        self.values = list(values)


def encode_models(models):
    out = struct.pack("<I", len(models))
    for model in models:
        out += struct.pack("<I", model.offset)
        out += struct.pack("<I", len(model.values))
        for v in model.values:
            out += struct.pack("<I", v & 0xFFFFFFFF)
    return out


def decode_models(data, off):
    def take(n):
        nonlocal off
        b = data[off:off + n]
        off += n
        return b

    count = struct.unpack("<I", take(4))[0]
    models = []
    for _ in range(count):
        offset = struct.unpack("<I", take(4))[0]
        n_v = struct.unpack("<I", take(4))[0]
        values = [struct.unpack("<I", take(4))[0] for _ in range(n_v)]
        models.append(WordModel(offset, values))
    return models, off


def encode_scenario(mmio_word_models, coherent, streaming):
    """mmio_word_models: list of WordModel.
    coherent: list of (addr, word_models).
    streaming: list of (addr, word_models)."""
    out = encode_models(mmio_word_models)
    out += struct.pack("<I", len(coherent))
    for addr, models in coherent:
        out += struct.pack("<Q", addr)
        out += encode_models(models)
    for addr, models in streaming:
        out += struct.pack("<Q", addr)
        out += encode_models(models)
    return bytes(out)


def decode_scenario(data):
    off = 0

    mmio_models, off = decode_models(data, off)
    n_c = struct.unpack("<I", data[off:off + 4])[0]
    off += 4
    coherent = []
    for _ in range(n_c):
        addr = struct.unpack("<Q", data[off:off + 8])[0]
        off += 8
        models, off = decode_models(data, off)
        coherent.append((addr, models))

    streaming = []
    while off < len(data):
        addr = struct.unpack("<Q", data[off:off + 8])[0]
        off += 8
        models, off = decode_models(data, off)
        streaming.append((addr, models))
    return mmio_models, coherent, streaming


def _hex(value):
    return f"0x{value:x}"


def render(mmio_models, coherent, streaming):
    lines = [f"mmio slots={len(mmio_models)}"]
    for model in mmio_models:
        lines.append(f"  mmio offset=0x{model.offset:x} values=" + ",".join(
            hex(v) for v in model.values))
    for i, (addr, models) in enumerate(coherent):
        lines.append(f"  coherent[{i}] addr={addr} slots={len(models)}")
        for model in models:
            lines.append(f"    word offset=0x{model.offset:x} values=" +
                         ",".join(hex(v) for v in model.values))
    for i, (addr, models) in enumerate(streaming):
        lines.append(f"  streaming[{i}] addr={addr} slots={len(models)}")
        for model in models:
            lines.append(f"    word offset=0x{model.offset:x} values=" +
                         ",".join(hex(v) for v in model.values))
    return "\n".join(lines)


def render_json(mmio_models, coherent, streaming):
    """Return seed events as JSON Lines compatible with seed.trace.jsonl."""
    schema_version = 4
    source = "seed"
    events = []
    for index, model in enumerate(mmio_models):
        events.append({
            "schemaVersion": schema_version,
            "source": source,
            "kind": "seed-mmio-slot",
            "index": index,
            "offset": _hex(model.offset),
            "count": model.count if hasattr(model, "count") else len(model.values),
            "values": [_hex(v) for v in model.values],
        })
    for index, (addr, models) in enumerate(coherent):
        events.append({
            "schemaVersion": schema_version,
            "source": source,
            "kind": "seed-coherent-alloc",
            "index": index,
            "addr": _hex(addr),
            "model_count": len(models),
            "models": [
                {
                    "offset": _hex(m.offset),
                    "count": m.count if hasattr(m, "count") else len(m.values),
                    "values": [_hex(v) for v in m.values],
                }
                for m in models
            ],
        })
    for index, (addr, models) in enumerate(streaming):
        events.append({
            "schemaVersion": schema_version,
            "source": source,
            "kind": "seed-stream-unit",
            "index": index,
            "addr": _hex(addr),
            "model_count": len(models),
            "models": [
                {
                    "offset": _hex(m.offset),
                    "count": m.count if hasattr(m, "count") else len(m.values),
                    "values": [_hex(v) for v in m.values],
                }
                for m in models
            ],
        })
    return "\n".join(json.dumps(e, ensure_ascii=False) for e in events)


if __name__ == "__main__":
    if len(sys.argv) < 2 or sys.argv[1] in ("-h", "--help"):
        print(f"usage: {sys.argv[0]} [--json] <seed.bin|-", file=sys.stderr)
        sys.exit(1)

    use_json = False
    path = sys.argv[1]
    if path == "--json":
        use_json = True
        if len(sys.argv) < 3:
            print(f"usage: {sys.argv[0]} [--json] <seed.bin|-", file=sys.stderr)
            sys.exit(1)
        path = sys.argv[2]

    if path == "-":
        data = sys.stdin.buffer.read()
    else:
        data = open(path, "rb").read()
    mmio_models, coherent, streaming = decode_scenario(data)
    if use_json:
        print(render_json(mmio_models, coherent, streaming))
    else:
        print(render(mmio_models, coherent, streaming))
