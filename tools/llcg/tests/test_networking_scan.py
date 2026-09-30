#!/usr/bin/env python3
"""Focused tests for the llcg networking interface scan.

The networking preset must produce a source list that includes the virtio
transport and the ethtool ioctl handlers, because the CVE profile's RSS key
helper lives in net/ethtool/ioctl.c and the extraction workflow builds its
module list from the interface source list.
"""

import sys
import tempfile
from pathlib import Path

MUTATORS_DIR = Path(__file__).resolve().parent.parent / "mutators"
sys.path.insert(0, str(MUTATORS_DIR))

from interfaces import (  # noqa: E402
    PRESETS,
    collect_interface_scan,
)
from groups import NETWORKING_PRE_PRESETS  # noqa: E402

VIRTIO_MAKEFILE = "obj-$(CONFIG_VIRTIO_NET) += virtio_net.o\n"
VIRTIO_SOURCE = "void virtio_probe(void) {}\n"
ETHTOOL_MAKEFILE = "obj-$(CONFIG_INET) += ioctl.o\n"
ETHTOOL_SOURCE = "void ethtool_ioctl_handler(void) {}\n"
ROOT_MAKEFILE = "obj-y += drivers/ net/\n"


def write_tree(root: Path) -> None:
    (root / "drivers" / "virtio").mkdir(parents=True)
    (root / "net" / "ethtool").mkdir(parents=True)
    (root / "Makefile").write_text(ROOT_MAKEFILE)
    (root / "drivers" / "virtio" / "Makefile").write_text(VIRTIO_MAKEFILE)
    (root / "drivers" / "virtio" / "virtio_net.c").write_text(VIRTIO_SOURCE)
    (root / "net" / "ethtool" / "Makefile").write_text(ETHTOOL_MAKEFILE)
    (root / "net" / "ethtool" / "ioctl.c").write_text(ETHTOOL_SOURCE)


def expanded_networking() -> dict:
    # The kconfig-expanded networking scope: the virtio driver, the shared
    # transport, and the ethtool ioctl handlers (the RSS key helper's home).
    return {"networking": {
        "scan_dirs": ["drivers/virtio", "net/ethtool"],
        "enable_configs": ["CONFIG_VIRTIO_NET", "CONFIG_VIRTIO_MMIO", "CONFIG_INET"],
        "excluded_dirs": [],
        "excluded_files": [],
    }}


def test_networking_preset_gates_inet():
    assert PRESETS["networking"]["key_config"] == "CONFIG_VIRTIO_NET"
    assert "CONFIG_INET" in NETWORKING_PRE_PRESETS["enable_configs"]


def test_networking_source_list_includes_ethtool_ioctl():
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp) / "linux"
        write_tree(root)
        scan = collect_interface_scan(
            root, "networking", PRESETS,
            expanded_presets=expanded_networking(),
        )
        c_files = scan["c_files"]
        assert "drivers/virtio/virtio_net.c" in c_files, c_files
        assert "net/ethtool/ioctl.c" in c_files, c_files


def test_networking_scan_is_deterministic():
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp) / "linux"
        write_tree(root)
        presets = expanded_networking()
        first = collect_interface_scan(
            root, "networking", PRESETS, expanded_presets=presets)
        second = collect_interface_scan(
            root, "networking", PRESETS, expanded_presets=presets)
        assert first["c_files"] == second["c_files"]
        assert first["c_files"] == sorted(first["c_files"])


def main():
    failures = 0
    for test in (
        test_networking_preset_gates_inet,
        test_networking_source_list_includes_ethtool_ioctl,
        test_networking_scan_is_deterministic,
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
