## Context

Morpheus currently records workflow activity across multiple overlapping files:
plain text logs such as `stdout.log`, JSONL side streams such as
`progress.jsonl` and `relations.jsonl`, and mutable state snapshots such as
`workflow.json`, `step.json`, and `tool-result.json`. Tools also expose their
own `log_file` references and runtime manifests. The result is useful in pieces
but not coherent as a system: some events are only visible in text logs, some
status transitions are only visible in snapshots, and the runs viewer must mix
multiple sources to reconstruct execution history.

The desired direction is a regulated logging model where all workflow activity
lands in one canonical place that a visualizer can filter and visualize. At the
same time, the model should stay simpler than a full separate trace subsystem.
Detailed tool output such as QEMU build chatter still matters, but it should be
represented as a normalized event stream instead of scattered file-specific
contracts.

Constraints:
- Existing workflow execution, resume, and runs viewer flows depend on
  `workflow.json`, `step.json`, and `tool-result.json` for fast lookup.
- Tools already emit a mix of structured payloads and raw stdout/stderr.
- Runtime-backed steps such as `nvirsh.exec` and provider-launched QEMU need
  live liveness signals, not just final launch-success signals.
- The viewer needs fine-grained filtering and visualization without re-parsing
  ad hoc text formats.

## Goals / Non-Goals

**Goals:**
- Define one canonical append-only event log for workflow and step activity.
- Distinguish clearly between canonical events, derived state snapshots, and any
  compatibility text logs.
- Standardize a small event taxonomy for lifecycle, runtime, artifact, warning,
  error, phase, and console-output records.
- Make the runs viewer consume the canonical event stream as a first-class
  inspection source for status, timelines, and future filtering.
- Keep the model simple enough that tool build traces can be represented without
  a separate trace subsystem.

**Non-Goals:**
- Replacing every existing snapshot file with pure event replay in one change.
- Designing a separate trace storage hierarchy or artifact class taxonomy.
- Solving all viewer UX problems for log exploration in the same change.
- Requiring every tool to emit the same internal phase detail on day one.

## Decisions

### Decision: `events.jsonl` becomes the canonical workflow logging substrate
Every workflow run will own one append-only `events.jsonl` file under the run
root. This file is the source of truth for what happened during execution. It
captures workflow lifecycle, step lifecycle, runtime status, artifact flow, and
console output as regulated event records.

Why this over keeping multiple canonical logs:
- It gives the viewer one place to read and filter.
- It avoids splitting semantics across `progress.jsonl`, `relations.jsonl`, and
  text logs.
- It makes artifact flow, runtime liveness, and console output composable in
  one timeline.

Alternative considered: keep `progress.jsonl` for orchestration, keep
`relations.jsonl` for graph data, and keep text logs for output. Rejected
because it preserves the current fragmentation and still forces the viewer to
join multiple partial histories.

### Decision: snapshots remain, but only as derived state views
`workflow.json`, `step.json`, and `tool-result.json` stay in place as optimized
current-state views and compatibility artifacts. They are no longer the
canonical history. They should be written from execution state in parallel with
`events.jsonl`, and the viewer should prefer event-derived interpretation when
there is disagreement.

Why this over removing snapshots immediately:
- Existing workflow resume and viewer flows already rely on them.
- They are efficient for point lookups.
- They reduce migration risk while the system shifts to one canonical event
  stream.

Alternative considered: remove snapshots and reconstruct everything from event
replay. Rejected because it increases implementation risk and makes existing
inspect/resume logic more complex than necessary.

### Decision: raw console output is represented as structured console events
Detailed tool output, including QEMU build traces, should be represented inside
`events.jsonl` as `console.stdout` and `console.stderr` events rather than as a
separate canonical `stdout.log` model. Tools may still mirror output to text log
files for compatibility or convenience, but those files are derived views, not
primary truth.

Why this over a dedicated trace subsystem:
- It satisfies the “one regulated place” goal.
- It keeps build traces available without introducing a second canonical store.
- It allows the viewer to filter raw output by step, tool, or level using one
  event model.

Alternative considered: keep `stdout.log` as canonical and make `events.jsonl`
only semantic. Rejected because it prevents a visualizer from using one source
for both semantic and raw execution history.

### Decision: keep the event taxonomy small and stable
The event model should start with a compact set of event families:
- workflow lifecycle
- step lifecycle
- tool phase/progress
- runtime lifecycle
- artifact produced/consumed
- warning/error
- console stdout/stderr

Why this over a large event catalog:
- It is easier for tools to adopt.
- It gives the viewer enough structure without overfitting to one tool.
- It reduces schema churn and keeps filtering predictable.

Alternative considered: highly specialized trace- and tool-specific event types.
Rejected because it would increase cognitive load and make cross-tool viewer
behavior harder to regulate.

### Decision: the runs viewer treats events as the primary inspection source
The runs viewer should progressively shift from a snapshot-plus-log-file model
into an event-first inspection model. Status interpretation, timelines, artifact
flow, and future filtering should come from `events.jsonl`, with snapshots used
for fast bootstrap and compatibility.

Why this over keeping snapshots as the primary source:
- Runtime-backed status needs event and liveness interpretation.
- Artifact flow is naturally event-shaped.
- A log visualizer is much easier to build against one regulated event stream.

Alternative considered: continue deriving viewer state mostly from snapshots and
only augment with selected event files. Rejected because it keeps the split
mental model and makes future visualization harder.

## Risks / Trade-offs

- **[Large event files from raw console output]** → Use append-only JSONL with
  event filtering and viewer pagination or streaming rather than loading entire
  files eagerly.
- **[Dual-write period between events and snapshots]** → Treat snapshots as
  derived compatibility state and verify parity with focused tests during
  migration.
- **[Tool adoption inconsistency]** → Start with Morpheus-owned lifecycle and
  console wrapping events, then add tool-native phase events incrementally.
- **[Viewer complexity during transition]** → Prefer event-first interpretation
  only for regulated cases and keep snapshot fallbacks until migration is
  complete.
- **[Backwards compatibility for existing runs]** → Allow the viewer to fall
  back to existing snapshots and logs when older runs do not contain the new
  canonical event stream.

## Migration Plan

1. Introduce the canonical `events.jsonl` contract and regulated event schema.
2. Update Morpheus workflow execution to emit lifecycle, artifact, runtime, and
   console events into the canonical stream.
3. Keep writing existing snapshots and compatibility text logs during the same
   execution flow.
4. Update the runs viewer to read regulated events for status interpretation,
   timeline construction, and filtering while preserving compatibility fallback
   for older runs.
5. Migrate or deprecate existing ad hoc JSONL side streams such as
   `progress.jsonl` and `relations.jsonl` once equivalent canonical events
   exist.

## Open Questions

- Should compatibility text logs remain as workflow-owned mirrors indefinitely,
  or only during a transition window?
- How aggressively should the viewer stream or paginate `console.stdout` /
  `console.stderr` events for very large build outputs?
- Should tool phase events be mandatory for all managed tools, or only for tools
  whose workflows materially benefit from phased progress?
