#!/usr/bin/env python3
import argparse
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument("--sel4", required=True)
parser.add_argument("--boards", required=True)
parser.add_argument("--configs", required=True)
parser.add_argument("--tool-target-triple")
parser.add_argument("--gcc-toolchain-prefix-aarch64")
parser.add_argument("--skip-docs", action="store_true")
parser.add_argument("--skip-tar", action="store_true")
args = parser.parse_args()

version = Path("VERSION").read_text(encoding="utf8").strip()
root = Path("release") / f"microkit-sdk-{version}"
for board in args.boards.split(","):
    for config in args.configs.split(","):
        target = root / "board" / board / config / "include" / "kernel"
        target.mkdir(parents=True, exist_ok=True)
        (target / "gen_config.h").write_text("// generated\n", encoding="utf8")
(root / "VERSION").write_text(version + "\n", encoding="utf8")
