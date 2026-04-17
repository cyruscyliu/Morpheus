#!/usr/bin/env python3
"""Extra-edges mutator callbacks."""

from pathlib import Path


def pre_mutator_callback(values, args, context):
    del values, args, context
    return None


def post_mutator_callback(values, args, context):
    del values, args
    path = Path(context["default_extra_edges"]).resolve()
    if not path.is_file():
        raise FileNotFoundError(f"Extra edges file not found: {path}")
    return [str(path)]
