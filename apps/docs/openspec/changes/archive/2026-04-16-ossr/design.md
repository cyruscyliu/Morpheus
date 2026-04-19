## Context

`ns3l` is a public-only tracker for a user-provided list of GitHub repositories. The dashboard will be hosted on GitHub Pages, so the implementation needs to avoid server-side state and client-side authentication. The tracker must stay repo-centric and automated: it should derive repository status from GitHub data rather than from manually maintained metadata.

## Goals / Non-Goals

**Goals:**
- Read a simple configured list of public GitHub repositories to track.
- Fetch repository metadata, recent commit activity, and fork relationship data from GitHub.
- Compute derived status labels such as active, recent, stale, and drifting using deterministic rules.
- Generate static JSON snapshots that a GitHub Pages site can render without calling the GitHub API at runtime.
- Support per-repository detail views with recent commits and fork drift counts when applicable.

**Non-Goals:**
- Tracking private repositories or non-GitHub sources.
- Introducing a separate tool or release model beyond repositories.
- Supporting manual annotations, manual status overrides, or workflow state.
- Producing deep upstream summaries beyond ahead/behind counts for forks.

## Decisions

### Decision: Use a scheduled snapshot generation pipeline
The system will fetch GitHub data during a build step and publish static JSON artifacts with the site.

Rationale:
- GitHub Pages can host static assets reliably but does not provide backend compute.
- Public GitHub API access during generation avoids exposing tokens or hitting browser-side rate limits for every viewer.
- Snapshot generation makes the dashboard fast and deterministic, with a clear "last updated" timestamp.

Alternatives considered:
- Client-side live GitHub API queries: rejected because it complicates rate limiting, runtime reliability, and fork drift aggregation.
- A separate backend service: rejected because it exceeds the desired operational simplicity.

### Decision: Use a minimal repository list as the only input
Tracked repositories will come from a single config file containing GitHub `owner/repo` identifiers.

Rationale:
- The user explicitly wants to provide the repo list directly.
- A flat list avoids overdesign and keeps the source of truth obvious.
- The dashboard remains fully automated because all other fields are derived from GitHub data.

Alternatives considered:
- Auto-discovery from a GitHub account: rejected because it does not cover arbitrary public repositories.
- Rich metadata manifests: rejected because the user does not want manual modeling.

### Decision: Derive status labels from simple heuristics
Repository status will be computed from timestamps and fork drift instead of being manually curated.

Rationale:
- This satisfies the requirement that status be fully automated.
- Deterministic rules make the dashboard understandable and testable.
- Status remains useful even for repositories without releases or custom metadata.

Alternatives considered:
- No status labels at all: rejected because users still need quick triage.
- Machine-generated summaries: rejected because they add complexity without improving the core tracker.

### Decision: Treat fork drift as counts only
For forked repositories, the dashboard will show ahead/behind counts against the parent repository and current default branch, but not detailed upstream change summaries.

Rationale:
- The user only cares whether a fork is behind, not detailed upstream analysis.
- This keeps API usage and UI complexity down.

Alternatives considered:
- Detailed upstream commit feeds: rejected as unnecessary for the current scope.

## Risks / Trade-offs

- [GitHub API rate limits during generation] -> Mitigate by caching responses where practical, limiting commit history depth, and keeping the tracked repo list explicit.
- [Fork comparison edge cases when parent branches diverge or are renamed] -> Mitigate by using the repository default branch and surfacing unavailable comparisons explicitly.
- [Status heuristics may not match user intuition for every repo] -> Mitigate by documenting thresholds and keeping labels simple.
- [Static snapshots can become stale between runs] -> Mitigate by scheduling regular refreshes and showing the last generated time in the UI.

## Migration Plan

1. Add the tracked repository list file and snapshot generation script.
2. Build the static dashboard against generated JSON data.
3. Configure a GitHub Actions workflow to refresh data on schedule and on demand.
4. Publish the generated site to GitHub Pages.
5. If generation fails or the site needs rollback, redeploy the last successful static build artifacts.

## Open Questions

- Which status thresholds should define `active`, `recent`, and `stale` for the initial release?
- How many recent commits should be shown in the overview row versus the detail page?
- Should star count and open issue count be included in v1 or deferred?
