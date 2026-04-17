"""kernel_groups.py - Library helpers for kernel group extraction.

Defines PRE_PRESETS / PRESETS for the supported subsystem families:

  Virtio family  – accessed via MMIO from the guest; entries are typically
                   virtio ops structs and, in some drivers, SYSCALL_DEFINE
                   wrappers.  Shared infra in drivers/virtio is pulled in via
                   VIRTIO_PRE_PRESETS.

  KVM            – accessed from userspace via ioctl(2) on /dev/kvm, /dev/kvm/<vm>,
                   and /dev/kvm/<vcpu>.  There is no MMIO pre-preset; the entry
                   points are file_operations ioctl handlers (kvm_chardev_ops,
                   kvm_vm_fops, kvm_vcpu_fops) caught automatically by the ops-
                   struct extractor.  Syscall wrapping is disabled for this preset.

"""
import json
import re
from pathlib import Path
from typing import Dict, List, Optional, Set, Tuple

from scan import (
    collect_interface_scan,
    collect_syscall_entries_from_files,
    expand_preset,
    extract_groups_from_file,
    find_c_files,
    kconfig_required_configs,
    load_kconfig,
    parse_kernel_version,
)

# ---------------------------------------------------------------------------
# PRE_PRESETS – common infrastructure pulled into every preset of each family
# ---------------------------------------------------------------------------

# Virtio: shared transport layer always required for any virtio device driver.
VIRTIO_PRE_PRESETS: Dict[str, List[str]] = {
    "scan_dirs": ["drivers/virtio"],
    "enable_configs": ["CONFIG_VIRTIO_MMIO"],
    "excluded_dirs": ["lib", "kernel"],
    "excluded_files": []
}

NP_PRE_PRESETS = VIRTIO_PRE_PRESETS
BALLOON_PRE_PRESETS = VIRTIO_PRE_PRESETS
BT_PRE_PRESETS = VIRTIO_PRE_PRESETS
CONSOLE_PRE_PRESETS = VIRTIO_PRE_PRESETS
CRYPTO_PRE_PRESETS = VIRTIO_PRE_PRESETS
DISPLAY_PRE_PRESETS = VIRTIO_PRE_PRESETS
FS_PRE_PRESETS = VIRTIO_PRE_PRESETS
GPIO_PRE_PRESETS = VIRTIO_PRE_PRESETS
INPUT_PRE_PRESETS = VIRTIO_PRE_PRESETS
IOMMU_PRE_PRESETS = VIRTIO_PRE_PRESETS
MEM_PRE_PRESETS = VIRTIO_PRE_PRESETS
NETWORKING_PRE_PRESETS = VIRTIO_PRE_PRESETS
# NETWORKING_PRE_PRESETS["enable_configs"].append("CONFIG_INET")
PMEM_PRE_PRESETS = VIRTIO_PRE_PRESETS
RNG_PRE_PRESETS = VIRTIO_PRE_PRESETS
SCSI_PRE_PRESETS = VIRTIO_PRE_PRESETS
SOUND_PRE_PRESETS = VIRTIO_PRE_PRESETS
STORAGE_PRE_PRESETS = VIRTIO_PRE_PRESETS
VSOCK_PRE_PRESETS = VIRTIO_PRE_PRESETS

# KVM: no shared MMIO transport.  The arch-specific directory is appended
# dynamically by resolve_pre_presets() based on the --arch flag.
KVM_PRE_PRESETS: Dict[str, List[str]] = {
    # virt/kvm has no standalone Makefile (only Makefile.kvm, included by
    # arch/<arch>/kvm/Makefile).  The arch-specific dir is appended by
    # resolve_pre_presets(); include-inlining in the Makefile parser then
    # pulls virt/kvm source files in automatically.
    "scan_dirs": [],
    "enable_configs": [],
    "excluded_dirs": ["mm", "init", "lib", "arch/arm64/kvm/hyp/vhe"],
}

# Default for presets that do not specify their own pre_presets key.
PRE_PRESETS = VIRTIO_PRE_PRESETS

# ---------------------------------------------------------------------------
# PRESETS – per-subsystem configuration
#
# Keys common to all entries:
#   key_config       CONFIG_ symbol that gates the subsystem.
#
# Optional keys:
#   pre_presets      Override the shared infrastructure dict (default: PRE_PRESETS).
#   syscall_entries  If False, skip SYSCALL_DEFINE scanning for this preset.
#                    Default: True.  Set to False for ioctl-only interfaces like KVM.
# ---------------------------------------------------------------------------

PRESETS: Dict[str, Dict] = {
    # -- Virtio devices -------------------------------------------------------
    "9p": {
        "key_config": "CONFIG_NET_9P_VIRTIO",
        "pre_presets": NP_PRE_PRESETS,
    },
    "balloon": {
        "key_config": "CONFIG_VIRTIO_BALLOON",
        "pre_presets": BALLOON_PRE_PRESETS,
    },
    "bt": {
        "key_config": "CONFIG_BT_VIRTIO",
        "pre_presets": BT_PRE_PRESETS,
    },
    "console": {
        "key_config": "CONFIG_VIRTIO_CONSOLE",
        "pre_presets": CONSOLE_PRE_PRESETS,
    },
    "crypto": {
        "key_config": "CONFIG_CRYPTO_DEV_VIRTIO",
        "pre_presets": CRYPTO_PRE_PRESETS,
    },
    "display": {
        "key_config": "CONFIG_DRM_VIRTIO_GPU",
        "pre_presets": DISPLAY_PRE_PRESETS,
    },
    "fs": {
        "key_config": "CONFIG_VIRTIO_FS",
        "pre_presets": FS_PRE_PRESETS,
    },
    "gpio": {
        "key_config": "CONFIG_GPIO_VIRTIO",
        "pre_presets": GPIO_PRE_PRESETS,
    },
    "input": {
        "key_config": "CONFIG_VIRTIO_INPUT",
        "pre_presets": INPUT_PRE_PRESETS,
    },
    "iommu": {
        "key_config": "CONFIG_VIRTIO_IOMMU",
        "pre_presets": IOMMU_PRE_PRESETS,
    },
    "mem": {
        "key_config": "CONFIG_VIRTIO_MEM",
        "pre_presets": MEM_PRE_PRESETS,
    },
    "networking": {
        "key_config": "CONFIG_VIRTIO_NET",
        "pre_presets": NETWORKING_PRE_PRESETS,
    },
    "pmem": {
        "key_config": "CONFIG_VIRTIO_PMEM",
        "pre_presets": PMEM_PRE_PRESETS,
    },
    "rng": {
        "key_config": "CONFIG_HW_RANDOM_VIRTIO",
        "pre_presets": RNG_PRE_PRESETS,
    },
    "scsi": {
        "key_config": "CONFIG_SCSI_VIRTIO",
        "pre_presets": SCSI_PRE_PRESETS,
    },
    "sound": {
        "key_config": "CONFIG_SND_VIRTIO",
        "pre_presets": SOUND_PRE_PRESETS,
    },
    "storage": {
        "key_config": "CONFIG_VIRTIO_BLK",
        "pre_presets": STORAGE_PRE_PRESETS,
    },
    "vsock": {
        "key_config": "CONFIG_VIRTIO_VSOCKETS",
        "pre_presets": VSOCK_PRE_PRESETS,
    },

    # -- KVM ------------------------------------------------------------------
    # KVM exposes /dev/kvm to userspace.  Control flow enters the kernel
    # through ioctl(2) dispatched by kvm_chardev_ops, kvm_vm_fops, and
    # kvm_vcpu_fops – all file_operations structs captured by extract_groups.
    # There are no SYSCALL_DEFINE macros inside the KVM sources themselves,
    # so syscall entry scanning is disabled.
    "kvm": {
        "key_config": "CONFIG_KVM",
        "pre_presets": KVM_PRE_PRESETS,
        "syscall_entries": False,
    },
}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def resolve_pre_presets(preset_name: str, arch: str = "arm64") -> Dict[str, List[str]]:
    """Return the effective pre_presets for a preset, with arch adjustments."""
    preset = PRESETS[preset_name]
    pp = preset.get("pre_presets", PRE_PRESETS)

    # KVM: add the arch-specific KVM directory alongside the generic virt/kvm/.
    if preset_name == "kvm":
        arch_dir = f"arch/{arch}/kvm"
        extra_scan = [d for d in pp["scan_dirs"]] + [arch_dir]
        pp = {
            "scan_dirs": extra_scan,
            "enable_configs": list(pp["enable_configs"]),
            "excluded_dirs": list(pp.get("excluded_dirs", [])),
            "excluded_files": list(pp.get("excluded_files", [])),
        }

    return pp


def _wants_syscall_entries(preset_name: str) -> bool:
    return PRESETS[preset_name].get("syscall_entries", True)


def parse_interfaces(interfaces_str: str) -> List[str]:
    selected = [x.strip() for x in interfaces_str.split(",") if x.strip()]
    for name in selected:
        if name not in PRESETS:
            raise ValueError(f"Unknown interface preset: {name!r}. Available: {','.join(PRESETS)}")
    return selected


def expand_presets(
    kernel_root: Path,
    selected: List[str],
    arch: str = "arm64",
):
    version = parse_kernel_version(kernel_root)
    kconf = load_kconfig(kernel_root, arch=arch)
    expanded_presets: Dict[str, Dict[str, List[str]]] = {}
    for name in selected:
        key_config = PRESETS[name]["key_config"]
        pp = resolve_pre_presets(name, arch=arch)
        required = kconfig_required_configs(
            kernel_root, key_config, kconf=kconf, arch=arch
        )
        expanded_presets[name] = expand_preset(
            kernel_root, key_config, required=required, arch=arch, pre_presets=pp
        )
    return version, kconf, expanded_presets


def collect_groups_for_interface(
    kernel_root: Path,
    interface: str,
    expanded_preset: Dict[str, List[str]],
    arch: str = "arm64",
):
    enabled_configs: Set[str] = set(expanded_preset["enable_configs"])

    dedup_dirs: List[str] = []
    seen_dirs: Set[str] = set()
    for scan_dir in expanded_preset["scan_dirs"]:
        if scan_dir not in seen_dirs:
            seen_dirs.add(scan_dir)
            dedup_dirs.append(scan_dir)

    pp = resolve_pre_presets(interface, arch=arch)
    excluded_dirs = pp.get("excluded_dirs", [])
    excluded_files = pp.get("excluded_files", [])
    files = find_c_files(kernel_root, dedup_dirs, enabled_configs, excluded_dirs, excluded_files)

    groups: List[Tuple[str, List[str], str, int, str]] = []
    seen_groups: Set[str] = set()
    for path in files:
        for gname, funcs, rel, line, stype in extract_groups_from_file(path, kernel_root):
            if gname in seen_groups:
                continue
            seen_groups.add(gname)
            groups.append((gname, funcs, rel, line, stype))

    syscall_groups: List[Tuple[str, List[str], str]] = []
    if _wants_syscall_entries(interface):
        _, syscall_entries = collect_syscall_entries_from_files(files)
        group_name = f"{interface}_syscall_helpers"
        if syscall_entries and group_name not in seen_groups:
            syscall_groups.append((group_name, syscall_entries, interface))

    return {
        "enabled_configs": enabled_configs,
        "scan_dirs": dedup_dirs,
        "files": files,
        "groups": groups,
        "syscall_groups": syscall_groups,
    }


def write_groups_file(
    output_path: Path,
    version: str,
    interface: str,
    arch: str,
    scan_dirs: List[str],
    enabled_configs: Set[str],
    groups: List[Tuple[str, List[str], str, int, str]],
    syscall_groups: List[Tuple[str, List[str], str]],
) -> Path:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("w") as fh:
        fh.write(
            "# Auto-generated ops groups for Linux kernel analysis.\n"
            f"# kernel={version}\n"
            f"# interface={interface}\n"
            f"# arch={arch}\n"
            f"# scan_dirs={','.join(scan_dirs)}\n"
            f"# enabled_configs={','.join(sorted(enabled_configs))}\n"
        )
        for gname, funcs, rel, line, stype in groups:
            fh.write("\n")
            fh.write(f"# from {rel}:{line} ({stype})\n")
            label = f"[entry_point][rank_min] {gname}" if stype == "file_operations" else gname
            fh.write(label + "\n")
            for fn in funcs:
                fh.write(fn + "\n")
        for gname, funcs, iface_name in syscall_groups:
            fh.write("\n")
            fh.write(f"# from SYSCALL_DEFINE in interface={iface_name}\n")
            fh.write(f"[entry_point][rank_min] {gname}\n")
            for fn in funcs:
                fh.write(fn + "\n")
    return output_path


def generate_groups_files(
    kernel_root_str: str,
    groups_dir_str: str,
    interfaces_str: str,
    arch: str = "arm64",
) -> Dict[str, Path]:
    kernel_root = Path(kernel_root_str).resolve()
    groups_dir = Path(groups_dir_str).resolve()
    selected = parse_interfaces(interfaces_str)
    version, _kconf, expanded_presets = expand_presets(kernel_root, selected, arch=arch)
    arch_tag = re.sub(r"[^A-Za-z0-9_.-]+", "_", arch)

    groups_dir.mkdir(parents=True, exist_ok=True)
    outputs: Dict[str, Path] = {}
    for interface in selected:
        info = collect_groups_for_interface(
            kernel_root,
            interface,
            expanded_presets[interface],
            arch=arch,
        )
        output_path = groups_dir / f"{interface}-groups-{version}-{arch_tag}.txt"
        outputs[interface] = write_groups_file(
            output_path,
            version,
            interface,
            arch,
            info["scan_dirs"],
            info["enabled_configs"],
            info["groups"],
            info["syscall_groups"],
        )
    return outputs


def run(kernel_root_str: str, output_str: str, interfaces_str: str, arch: str = "arm64") -> int:
    kernel_root = Path(kernel_root_str).resolve()
    output_path = Path(output_str).resolve()

    selected = parse_interfaces(interfaces_str)

    version, kconf, expanded_presets = expand_presets(kernel_root, selected, arch=arch)

    # Top-level result dict.
    result: Dict = {
        "kernel_version": version,
        "arch": arch,
        "interfaces": {},
    }

    # Track union of all dirs/configs/files.
    all_dedup_dirs: List[str] = []
    all_seen_dirs: Set[str] = set()
    all_enabled_configs: Set[str] = set()
    all_files: List = []

    for iface in selected:
        info = collect_groups_for_interface(
            kernel_root,
            iface,
            expanded_presets[iface],
            arch=arch,
        )
        enabled_configs = info["enabled_configs"]
        dedup_dirs = info["scan_dirs"]
        files = info["files"]
        groups = info["groups"]
        syscall_groups = info["syscall_groups"]

        for scan_dir in dedup_dirs:
            if scan_dir not in all_seen_dirs:
                all_seen_dirs.add(scan_dir)
                all_dedup_dirs.append(scan_dir)
        all_enabled_configs.update(enabled_configs)
        all_files.extend(files)

        # Collect interface scan data.
        iface_scan = collect_interface_scan(
            kernel_root, iface, PRESETS,
            expanded_presets=expanded_presets, kconf=kconf, arch=arch,
        )

        # Build groups list for JSON.
        groups_json = []
        for gname, funcs, rel, line, stype in groups:
            groups_json.append({
                "name": gname,
                "functions": funcs,
                "source": f"{rel}:{line}",
                "struct_type": stype,
                "entry_point": stype == "file_operations",
            })
        for gname, funcs, iface_name in syscall_groups:
            groups_json.append({
                "name": gname,
                "functions": funcs,
                "source": f"SYSCALL_DEFINE in interface={iface_name}",
                "struct_type": "syscall",
                "entry_point": True,
            })

        result["interfaces"][iface] = {
            "key_config": PRESETS[iface]["key_config"],
            "scan_dirs": dedup_dirs,
            "enabled_configs": sorted(enabled_configs),
            "groups": groups_json,
            **iface_scan,
        }

        print(f"groups[{iface}]={len(groups)}")
        print(f"syscall_groups[{iface}]={len(syscall_groups)}")

    result["scan_dirs"] = all_dedup_dirs
    result["enabled_configs"] = sorted(all_enabled_configs)
    result["scanned_c_files"] = len(all_files)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(result, indent=2) + "\n")

    print(f"kernel_version={version}")
    print(f"scan_dirs={','.join(all_dedup_dirs)}")
    print(f"enabled_configs={','.join(sorted(all_enabled_configs))}")
    print(f"arch={arch}")
    print(f"scanned_c_files={len(all_files)}")
    print(f"output={output_path}")

    return 0
