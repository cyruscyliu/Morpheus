#!/usr/bin/env python3
"""Group-only mutator helpers for llcg."""

from groups import write_groups_file
from interfaces import collect_syscall_entries_from_files, extract_groups_from_file
from scan import parse_kernel_version


def collect_groups_for_files(kernel_root, rel_sources, scope_name):
    files = []
    scan_dirs = []
    seen_dirs = set()
    groups = []
    seen_groups = set()

    for rel_source in rel_sources:
        source_path = (kernel_root / rel_source).resolve()
        if not source_path.is_file():
            raise FileNotFoundError(f"Scoped file not found: {rel_source}")
        files.append(source_path)
        parent_rel = source_path.parent.relative_to(kernel_root).as_posix()
        if parent_rel not in seen_dirs:
            seen_dirs.add(parent_rel)
            scan_dirs.append(parent_rel)
        for group_name, funcs, rel, line, struct_type in extract_groups_from_file(source_path, kernel_root):
            if group_name in seen_groups:
                continue
            seen_groups.add(group_name)
            groups.append((group_name, funcs, rel, line, struct_type))

    syscall_groups = []
    _names, syscall_entries = collect_syscall_entries_from_files(files)
    group_name = f"{scope_name}_syscall_helpers"
    if syscall_entries and group_name not in seen_groups:
        syscall_groups.append((group_name, syscall_entries, scope_name))

    return {
        "enabled_configs": set(),
        "scan_dirs": scan_dirs,
        "files": files,
        "groups": groups,
        "syscall_groups": syscall_groups,
    }


def _parse_group_member_entry(entry):
    op = entry[0] if entry.startswith(("+", "-")) else ""
    body = entry[1:].strip() if op else entry.strip()
    field = ""
    name = body
    if ": " in body:
        field, _, value = body.partition(": ")
        if field.strip() and value.strip():
            name = value.strip()
            field = field.strip()
    member = f"{op}{name}" if op else name
    display = f"{field}: {name}" if field else name
    return member, name, display


def load_groups_text(path):
    groups = []
    groups_by_label = {}
    current = None

    def flush():
        nonlocal current
        if not current or not current["label"]:
            current = None
            return
        modifying = any(member.startswith(("+", "-")) for member in current["members"])
        existing = groups_by_label.get(current["label"])
        if modifying and existing is not None:
            for member in current["members"]:
                op = member[0]
                name = member[1:].strip()
                if not name:
                    continue
                if op == "+":
                    if name not in existing["members"]:
                        existing["members"].append(name)
                elif op == "-":
                    existing["members"] = [item for item in existing["members"] if item != name]
            current = None
            return
        if modifying and existing is None:
            current["members"] = [
                member[1:] if member.startswith("+") else member
                for member in current["members"]
                if not member.startswith("-")
            ]
        if existing is None:
            groups.append(current)
            groups_by_label[current["label"]] = current
        else:
            for member in current["members"]:
                if member not in existing["members"]:
                    existing["members"].append(member)
        current = None

    for raw_line in path.read_text().splitlines():
        line = raw_line.strip()
        if line.startswith("#"):
            continue
        if not line:
            flush()
            continue
        if current is None:
            label = line
            raw_label = line
            tags = []
            for marker in (
                "[entry_point]",
                "[no_entry_point]",
            ):
                if marker in line:
                    tags.append(marker)
                label = label.replace(marker, "")
            normalized_tags = "".join(tags)
            for marker in (
                "[entry_point]",
                "[no_entry_point]",
                "[not_reach_then_discard]",
                "[rank_min]",
                "[rank_max]",
            ):
                label = label.replace(marker, "")
            current = {
                "label": label.strip(),
                "raw_label": raw_label.strip(),
                "tags": normalized_tags,
                "entry_point_override": (
                    "clear"
                    if "[no_entry_point]" in normalized_tags
                    else "set"
                    if "[entry_point]" in normalized_tags
                    else ""
                ),
                "members": [],
            }
            continue
        member, _member_name, _display = _parse_group_member_entry(line)
        current["members"].append(member)
    flush()
    return groups


def merge_groups_extension(groups_path, extension_path):
    if not extension_path:
        return
    extension_text = extension_path.read_text()
    if not extension_text.strip():
        return

    base_groups = load_groups_text(groups_path)
    ext_groups = load_groups_text(extension_path)
    groups_by_label = {
        group["label"]: {
            "label": group["label"],
            "raw_label": group.get("raw_label", group["label"]),
            "tags": group.get("tags", ""),
            "members": list(group["members"]),
        }
        for group in base_groups
    }
    ordered_labels = [group["label"] for group in base_groups]

    for group in ext_groups:
      existing = groups_by_label.get(group["label"])
      if existing is None:
        groups_by_label[group["label"]] = {
          "label": group["label"],
          "raw_label": group.get("raw_label", group["label"]),
          "tags": group.get("tags", ""),
          "members": list(group["members"]),
        }
        ordered_labels.append(group["label"])
        continue
      if group.get("tags"):
        existing["tags"] = group["tags"]
        existing["raw_label"] = group.get("raw_label", existing["raw_label"])
      elif group.get("entry_point_override") == "clear":
        existing["tags"] = existing.get("tags", "").replace("[entry_point]", "")
        if "[no_entry_point]" not in existing["tags"]:
          existing["tags"] = f"[no_entry_point]{existing['tags']}"
        existing["raw_label"] = f"{existing['tags']}{existing['label']}"
      elif group.get("entry_point_override") == "set":
        existing["tags"] = existing.get("tags", "").replace("[no_entry_point]", "")
        if "[entry_point]" not in existing["tags"]:
          existing["tags"] = f"[entry_point]{existing['tags']}"
        existing["raw_label"] = f"{existing['tags']}{existing['label']}"
      for member in group["members"]:
        if member not in existing["members"]:
          existing["members"].append(member)

    with groups_path.open("w") as fh:
      for index, label in enumerate(ordered_labels):
        group = groups_by_label[label]
        if index > 0:
          fh.write("\n")
        rendered_label = group["raw_label"] if group.get("raw_label") else group["label"]
        fh.write(f"{rendered_label}\n")
        for member in group["members"]:
          fh.write(f"{member}\n")


def collect_group_mutator_payload(
    *,
    kernel_root,
    files,
    scope_name,
    arch,
    out_dir,
    scope_list,
    groups_extension,
    normalize_scope_files,
    read_lines,
    sanitize_tag,
    scope_name_from_files,
    stable_path,
    path_view,
    artifact_entry,
    emit_runtime_payload,
    write_json,
    write_lines,
):
    scoped_files = (
        normalize_scope_files(kernel_root, read_lines(scope_list))
        if scope_list
        else normalize_scope_files(kernel_root, files)
    )
    if not scoped_files:
        raise ValueError("At least one --file or a non-empty --scope-list is required")

    kernel_version = parse_kernel_version(kernel_root)
    scope_label = sanitize_tag(scope_name or scope_name_from_files(scoped_files))
    arch_tag = sanitize_tag(arch)
    manifest_path = out_dir / f"{scope_label}-mutator-{kernel_version}-{arch_tag}.json"
    source_list_path = out_dir / f"{scope_label}-sources-{kernel_version}-{arch_tag}.txt"
    groups_path = out_dir / f"{scope_label}-groups-{kernel_version}-{arch_tag}.txt"

    info = collect_groups_for_files(kernel_root, scoped_files, scope_label)
    rel_files = [path.relative_to(kernel_root).as_posix() for path in info["files"]]
    write_lines(source_list_path, rel_files)
    write_groups_file(
        groups_path,
        kernel_version,
        scope_label,
        arch,
        info["scan_dirs"],
        info["enabled_configs"],
        info["groups"],
        info["syscall_groups"],
    )
    if groups_extension:
        merge_groups_extension(groups_path, groups_extension)

    payload = {
        "command": "mutator",
        "mutator_kind": "groups",
        "status": "success",
        "exit_code": 0,
        "summary": "generated group mutator metadata from kernel sources",
        "details": {
            "mutator_roles": ["post"],
            "kernel_version": kernel_version,
            "arch": arch,
            "scope_label": scope_label,
            "source_dir": stable_path(kernel_root, out_dir),
            "source_list": stable_path(source_list_path, out_dir),
            "scope_list": stable_path(scope_list, out_dir) if scope_list else "",
            "groups_extension": stable_path(groups_extension, out_dir) if groups_extension else "",
            "groups_file": stable_path(groups_path, out_dir),
            "scan_dirs": info["scan_dirs"],
            "enabled_configs": sorted(info["enabled_configs"]),
            "scanned_files": rel_files,
            "groups_count": len(info["groups"]),
            "syscall_group_count": len(info["syscall_groups"]),
        },
        "runtime": emit_runtime_payload(),
        "paths": {
            "manifest": path_view(manifest_path, out_dir),
            "source_dir": path_view(kernel_root, out_dir),
            "source_list": path_view(source_list_path, out_dir),
            **({"scope_list": path_view(scope_list, out_dir)} if scope_list else {}),
            **({"groups_extension": path_view(groups_extension, out_dir)} if groups_extension else {}),
            "groups_file": path_view(groups_path, out_dir),
        },
        "artifacts": [
            artifact_entry("mutator_manifest", manifest_path, out_dir),
            artifact_entry("source_list", source_list_path, out_dir),
            artifact_entry("groups_file", groups_path, out_dir),
        ],
    }
    write_json(manifest_path, payload)
    payload["artifacts"][0]["exists"] = True
    return payload, manifest_path
