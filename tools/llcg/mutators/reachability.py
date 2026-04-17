#!/usr/bin/env python3
"""Reachability mutator callbacks."""


def pre_mutator_callback(values, args, context):
    del values, args, context
    return None


def post_mutator_callback(values, args, context):
    del values, args, context
    return ["entry_point"]
