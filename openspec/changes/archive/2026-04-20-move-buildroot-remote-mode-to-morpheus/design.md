## Context

The current Buildroot CLI has two different responsibilities. One part is tool
semantics: local Buildroot source trees, output directories, defconfigs, and
inspection of local manifests. The other part is orchestration: SSH transport,
remote workspace layout, generated build ids, stable metadata, log capture, and
explicit remote fetch behavior. That second part is not really Buildroot-
specific. It is repository-level managed-run behavior.

Morpheus is already being repositioned as the orthogonal management layer for
workspace metadata, artifacts, and logs. Extending Morpheus to own remote
managed runs fits that direction better than keeping remote orchestration inside
individual tool CLIs.

The important nuance is that Morpheus should not become workflow-heavy too
soon. A single remote Buildroot invocation can be modeled as a managed run of
one tool node without forcing full DAG workflow concepts into the first
iteration.

## Goals / Non-Goals

**Goals:**
- Keep `buildroot` focused on local Buildroot semantics.
- Move SSH-backed remote orchestration into Morpheus.
- Make remote workspace support conditional on using Morpheus.
- Keep direct `buildroot` invocations local-only with no remote workspace mode.
- Define a reusable Morpheus remote run model with stable ids, manifests,
  logs, and explicit artifact fetch behavior.
- Make Buildroot the first consumer of that remote run model.
- Preserve `--json` as a first-class interface for all migrated commands.

**Non-Goals:**
- Designing a full multi-node workflow engine in this change.
- Removing local Buildroot functionality.
- Hiding tool CLIs behind Morpheus for local use.
- Generalizing immediately to every tool before the remote run model is proven.

## Decisions

### 1. Remote orchestration belongs to Morpheus

Remote SSH execution, remote workspace layout, generated ids, and artifact/log
management should move out of `buildroot` and into Morpheus.

Why:
- These concerns are not Buildroot-specific.
- The same remote model can later be reused for other tools.
- It keeps the tool CLI thinner and more Unix-like.

Alternatives considered:
- Keep `buildroot remote-*`: rejected because it preserves a blurred boundary.
- Add a second remote abstraction while keeping `buildroot remote-*`: rejected
  because it duplicates public surfaces during the transition.

### 2. Start with managed runs, not full workflow language

The first Morpheus remote feature should model a remote Buildroot invocation as
one managed tool run. Workflow composition can come later.

Why:
- A one-node workflow does not yet justify a full workflow abstraction.
- The user explicitly wants to keep Morpheus from becoming overdesigned too
  early.
- Managed runs provide a clearer stepping stone toward future workflow support.

Alternatives considered:
- Introduce `workflow run buildroot`: deferred because it front-loads workflow
  terminology before the model is mature.

### 3. Keep tool CLIs first-class for local execution

After the change, `buildroot` should remain a first-class local CLI. Morpheus
should only own the remote managed-run path.

Why:
- This preserves the repo’s tool/app separation.
- It avoids making Morpheus a forced front door for local tool use.
- It makes the remote workspace boundary crisp: use Morpheus for remote
  workspaces, use `buildroot` directly for local execution.

### 4. Remote workspaces are a Morpheus-only concept

Remote workspace creation, reuse, inspection, logs, and artifact fetch should
only be supported when the user runs through Morpheus.

Why:
- A remote workspace is shared orchestration state, not a Buildroot-native
  concept.
- Keeping remote workspace support out of `buildroot` prevents a second remote
  lifecycle from reappearing in the tool.
- This gives users a clear rule: local tool commands are direct, remote
  workspace commands go through Morpheus.

### 5. Preserve remote metadata as a stable contract

The Morpheus remote run model should keep stable ids, manifests, log paths, and
explicit fetch semantics.

Why:
- Those are the high-value parts of the current Buildroot remote behavior.
- Agents and scripts depend on inspectable state and predictable paths.

## Proposed Surface

The exact CLI shape still needs refinement, but the intended split is:

```text
buildroot
  build
  inspect
  clean

morpheus
  remote run ...
  remote inspect ...
  remote logs ...
  remote fetch ...
```

The remote commands should accept:
- SSH target
- remote workspace root
- tool identity
- tool-specific input payload or explicit flags
- JSON mode

For the first migration, Morpheus may expose Buildroot-specific flags directly
while the generic run contract settles.

## Risks / Trade-offs

- [Morpheus scope expands too quickly] → Mitigation: limit v1 to single-node
  managed runs and Buildroot as the first migrated tool.
- [Users lose a familiar `buildroot remote-*` surface] → Mitigation: provide a
  clear migration path and stable JSON contracts in Morpheus.
- [The first remote model is too Buildroot-shaped] → Mitigation: separate
  transport/run metadata from Buildroot-specific execution options.
- [CLI naming becomes awkward] → Mitigation: settle the Morpheus remote command
  tree before implementation.

## Migration Plan

1. Define the Morpheus remote managed-run command surface.
2. Implement Buildroot-backed remote runs in Morpheus.
3. Update docs and tests to point remote Buildroot usage at Morpheus.
4. Remove `remote-*` commands from Buildroot.
5. Verify JSON contracts and migration examples.

## Open Questions

- Should the first Morpheus surface be `remote ...` or `run ...`?
- Should Buildroot-specific flags stay flat in Morpheus initially, or should
  Morpheus accept a structured tool payload?
- How generic should remote fetch semantics be in v1?
