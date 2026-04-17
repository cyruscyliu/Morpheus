#!/usr/bin/env python3
"""Public file-scoped mutator module."""

from pathlib import Path


def _normalize_file_values(values, context):
    normalizer = context.get("normalize_scope_files")
    source_dir = context.get("source_dir")
    if normalizer is None or source_dir is None:
        raise ValueError("File mutator callback requires source_dir and normalize_scope_files in context")
    return normalizer(Path(source_dir), values)


def pre_mutator_callback(values, args, context):
    del args
    if values:
        normalized = _normalize_file_values(values, context)
        context["file_mutator_values"] = normalized
        return normalized

    manifest_path = context.get("mutator_manifest_path")
    manifest = context.get("mutator_manifest_payload")
    if manifest_path and manifest is None:
        reader = context.get("read_json")
        if reader is None:
            raise ValueError("File mutator callback requires read_json helper in context")
        manifest = reader(Path(manifest_path))
        context["mutator_manifest_payload"] = manifest
    if manifest is not None:
        if manifest.get("command") != "mutator" or manifest.get("mutator_kind") != "files":
            raise ValueError(f"{manifest_path} is not a files mutator manifest")
        normalized = list(manifest.get("details", {}).get("files", []))
        context["file_mutator_values"] = normalized
        return normalized
    return []


def post_mutator_callback(values, args, context):
    del values, args, context
    return []
