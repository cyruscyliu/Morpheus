#!/usr/bin/env python3
"""Mutator registry and callback dispatch."""

from blocklist import (  # noqa: F401
    post_mutator_callback as blocklist_post_mutator_callback,
    pre_mutator_callback as blocklist_pre_mutator_callback,
)
from extra_edges import (  # noqa: F401
    post_mutator_callback as extra_edges_post_mutator_callback,
    pre_mutator_callback as extra_edges_pre_mutator_callback,
)
from files import (  # noqa: F401
    post_mutator_callback as file_post_mutator_callback,
    pre_mutator_callback as file_pre_mutator_callback,
)
from interfaces import (  # noqa: F401
    post_mutator_callback as interface_post_mutator_callback,
    pre_mutator_callback as interface_pre_mutator_callback,
)
from reachability import (  # noqa: F401
    post_mutator_callback as reachability_post_mutator_callback,
    pre_mutator_callback as reachability_pre_mutator_callback,
)

MUTATORS = {
    "interface": {
        "pre": interface_pre_mutator_callback,
        "post": interface_post_mutator_callback,
    },
    "file": {
        "pre": file_pre_mutator_callback,
        "post": file_post_mutator_callback,
    },
    "blocklist": {
        "pre": blocklist_pre_mutator_callback,
        "post": blocklist_post_mutator_callback,
    },
    "extra_edges": {
        "pre": extra_edges_pre_mutator_callback,
        "post": extra_edges_post_mutator_callback,
    },
    "reachability": {
        "pre": reachability_pre_mutator_callback,
        "post": reachability_post_mutator_callback,
    },
}

DEFAULT_POST_MUTATORS = ("blocklist", "extra_edges", "reachability")


def supported_mutators(stage: str) -> set[str]:
    return {name for name, callbacks in MUTATORS.items() if callbacks.get(stage)}


def parse_mutator_entries(entries: list[str], *, allowed: set[str], label: str) -> dict[str, list[str]]:
    mutators: dict[str, list[str]] = {}
    for entry in entries:
        text = entry.strip()
        if not text:
            continue
        if "=" not in text:
            raise ValueError(f"Invalid mutator '{entry}'. Expected key=value.")
        key, value = text.split("=", 1)
        key = key.strip()
        value = value.strip()
        if not key or not value:
            raise ValueError(f"Invalid mutator '{entry}'. Expected key=value.")
        mutators.setdefault(key, []).append(value)
    unknown = sorted(set(mutators) - allowed)
    if unknown:
        supported = ", ".join(sorted(allowed)) if allowed else "<none>"
        raise ValueError(
            f"Unsupported {label}(s): " + ", ".join(unknown) + f". Supported values: {supported}"
        )
    return mutators


def apply_mutator_callbacks(
    stage: str,
    mutators: dict[str, list[str]],
    *,
    args,
    context: dict,
) -> dict[str, list[str]]:
    materialized: dict[str, list[str]] = {}
    for name, values in mutators.items():
        callback = MUTATORS[name][stage]
        result = callback(values, args, context)
        if result:
            materialized[name] = list(result)
    return materialized


def apply_default_post_mutators(*, args, context: dict) -> dict[str, list[str]]:
    materialized: dict[str, list[str]] = {}
    for name in DEFAULT_POST_MUTATORS:
        callback = MUTATORS[name]["post"]
        result = callback([], args, context)
        if result:
            materialized[name] = list(result)
    return materialized
