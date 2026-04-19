## Context

The current `apps/research-runtime` package contains real reusable structure:
CLI dispatch, filesystem-backed metadata inspection, execution helpers, and
machine-readable output patterns. But its public framing is workflow-runtime
first, while the intended current product boundary for Morpheus is narrower and
more orthogonal: it should help manage shared workspace concerns such as
artifact references, logs, and metadata without owning tool execution, tool
identity, or a first-class run model yet.

The rename is therefore not just cosmetic. A direct folder move without a scope
reset would preserve misleading runtime assumptions and stale documentation.
The safer approach is to rename the app to `apps/morpheus`, keep the reusable
infrastructure that still fits, and explicitly remove or defer workflow/runtime
surfaces that do not match the current product definition.

## Goals / Non-Goals

**Goals:**
- Establish `apps/morpheus` as the main application identity in the repo.
- Reuse applicable code and patterns from `apps/research-runtime`.
- Narrow the current Morpheus app scope to workspace, artifact, and log
  management.
- Keep tools such as `buildroot`, `llbic`, and `llcg` as first-class,
  independent interfaces.
- Preserve machine-readable CLI behavior where it remains useful for agents and
  scripts.

**Non-Goals:**
- Reintroducing workflow execution in this change.
- Giving Morpheus ownership of tool state or tool execution lifecycles.
- Adding a Morpheus run model in this phase.
- Finalizing future workflow architecture before it is needed.

## Decisions

### 1. Rename the app, but do not preserve the old product framing

The app should become `apps/morpheus`, but the rename should be paired with a
product-scope cleanup.

Why:
- `research-runtime` describes an implementation idea, not the product.
- `morpheus` is the right public identity to establish now.

Alternatives considered:
- Keeping `apps/research-runtime`: rejected because it hardens the wrong app
  identity.
- Pure move-only rename: rejected because it would preserve stale scope and
  runtime assumptions.

### 2. Reuse infrastructure selectively

The app should keep reusable mechanisms such as CLI dispatch, structured JSON
output, and filesystem-backed inspection patterns, while dropping or deferring
workflow-runtime-specific layers.

Why:
- There is useful code to keep, but not all of it matches the intended app
  boundary.
- Selective reuse is lower risk than rebuilding everything while still avoiding
  a misleading product model.

Alternatives considered:
- Full rewrite from scratch: possible, but unnecessary for the reusable pieces.
- Full carryover of the runtime model: rejected because it preserves the wrong
  abstraction now.

### 3. Keep Morpheus orthogonal to tool CLIs

Morpheus should not replace tool CLIs. It should coordinate shared concerns and
reference tool outputs.

Why:
- Tools are still intended to remain first-class public interfaces.
- Morpheus should manage metadata and discovery, not become a forced execution
  front door.

Alternatives considered:
- Making Morpheus the only entrypoint: rejected because it collapses the tool
  layer into the app prematurely.

### 4. Defer workflow execution intentionally

Workflow execution can return later, but it should not define the current app.

Why:
- The user explicitly wants workspace, artifact, and log management first.
- Deferral keeps the app simpler and better aligned with the current product
  boundary.

Alternatives considered:
- Keeping placeholder runtime/workflow commands in the renamed app: rejected
  because they would still shape user expectations incorrectly.

## Risks / Trade-offs

- [Partial reuse preserves hidden runtime assumptions] → Mitigation: audit help
  text, package metadata, docs, and path assumptions as part of the rename.
- [Removing workflow surfaces now may require future reintroduction work] →
  Mitigation: keep reusable internals modular and document deferred scope
  clearly.
- [App/tool boundaries may remain fuzzy] → Mitigation: explicitly define
  Morpheus as metadata/log/artifact management and keep tool CLIs independent.
- [Rename churn across docs and scripts] → Mitigation: update package names,
  README references, wrapper paths, and help strings in one coherent pass.

## Migration Plan

1. Rename `apps/research-runtime` to `apps/morpheus`.
2. Update package metadata, scripts, and path references to the new app name.
3. Remove or defer workflow-runtime-first commands and documentation that do
   not fit the current Morpheus boundary.
4. Retain reusable code that still supports metadata, artifact, and log
   management.
5. Verify that repo docs and entrypoints point to the renamed app correctly.

## Open Questions

- Which existing runtime modules are best kept intact versus rewritten during
  the rename?
- Should Morpheus expose a tool-discovery surface immediately, or only
  workspace/artifact/log commands at first?
- How much future workflow scaffolding, if any, should remain visible in the
  renamed app?
