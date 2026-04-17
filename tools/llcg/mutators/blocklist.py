#!/usr/bin/env python3
"""Blocklist mutator callbacks."""

from pathlib import Path


def pre_mutator_callback(values, args, context):
    del values, args, context
    return None


def post_mutator_callback(values, args, context):
    del values, args
    path = Path(context["default_blocklist"]).resolve()
    if not path.is_file():
        raise FileNotFoundError(f"Blocklist file not found: {path}")
    return [str(path)]
