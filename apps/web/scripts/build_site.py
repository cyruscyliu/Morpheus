#!/usr/bin/env python3
"""Build the static ossr site into dist/."""

from __future__ import annotations

import shutil
from pathlib import Path


def copy_tree(src: Path, dst: Path) -> None:
    if dst.exists():
        shutil.rmtree(dst)
    shutil.copytree(src, dst)


def main() -> int:
    root = Path(__file__).resolve().parent.parent
    dist = root / "dist"
    static_src = root / "src"
    generated = root / "generated"

    if dist.exists():
        shutil.rmtree(dist)
    shutil.copytree(static_src, dist)
    snapshot = generated / "snapshot.json"
    if snapshot.exists():
        shutil.copy2(snapshot, dist / "snapshot.json")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

