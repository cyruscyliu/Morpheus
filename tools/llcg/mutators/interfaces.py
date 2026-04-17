#!/usr/bin/env python3
"""Public interface-mutator module.

This is the single import surface for interface-based mutator generation and
group extraction. The underlying scan and grouping helpers remain split across
`scan.py` and `groups.py`, but callers should import from `interfaces.py`.
"""

from pathlib import Path

from scan import (  # noqa: F401
    collect_interface_scan,
    collect_syscall_entries_from_files,
    extract_groups_from_file,
    find_c_files,
    kconfig_required_configs,
    load_kconfig,
    parse_kernel_version,
)
from groups import (  # noqa: F401
    PRESETS,
    collect_groups_for_interface,
    expand_presets,
    generate_groups_files,
    parse_interfaces,
    resolve_pre_presets,
    run,
    write_groups_file,
)


def _normalize_interface_values(values):
    normalized = []
    seen = set()
    for name in values:
        parsed = parse_interfaces(name)
        for entry in parsed:
            if entry in seen:
                continue
            seen.add(entry)
            normalized.append(entry)
    return normalized


def pre_mutator_callback(values, args, context):
    del args
    normalized = _normalize_interface_values(values)
    if not normalized:
        manifest_path = context.get("mutator_manifest_path")
        manifest = context.get("mutator_manifest_payload")
        if manifest_path and manifest is None:
            reader = context.get("read_json")
            if reader is None:
                raise ValueError("Interface mutator callback requires read_json helper in context")
            manifest = reader(Path(manifest_path))
            context["mutator_manifest_payload"] = manifest
        if manifest is not None:
            if manifest.get("command") != "mutator" or manifest.get("mutator_kind") != "interfaces":
                raise ValueError(f"{manifest_path} is not an interfaces mutator manifest")
            normalized = list(manifest.get("details", {}).get("interfaces", []))
    context["interface_mutator_values"] = normalized
    return normalized


def post_mutator_callback(values, args, context):
    del args
    normalized = _normalize_interface_values(values)
    if normalized:
        context["interface_mutator_values"] = normalized
        return normalized

    manifest_path = context.get("mutator_manifest_path")
    if not manifest_path:
        return []

    manifest = context.get("mutator_manifest_payload")
    if manifest is None:
        reader = context.get("read_json")
        if reader is None:
            raise ValueError("Interface mutator callback requires read_json helper in context")
        manifest = reader(Path(manifest_path))
        context["mutator_manifest_payload"] = manifest

    if manifest.get("command") != "mutator" or manifest.get("mutator_kind") != "interfaces":
        raise ValueError(f"{manifest_path} is not an interfaces mutator manifest")
    normalized = list(manifest.get("details", {}).get("interfaces", []))
    context["interface_mutator_values"] = normalized
    return normalized

__all__ = [
    "PRESETS",
    "collect_groups_for_interface",
    "collect_interface_scan",
    "collect_syscall_entries_from_files",
    "expand_presets",
    "extract_groups_from_file",
    "find_c_files",
    "generate_groups_files",
    "kconfig_required_configs",
    "load_kconfig",
    "parse_interfaces",
    "parse_kernel_version",
    "post_mutator_callback",
    "pre_mutator_callback",
    "resolve_pre_presets",
    "run",
    "write_groups_file",
]
