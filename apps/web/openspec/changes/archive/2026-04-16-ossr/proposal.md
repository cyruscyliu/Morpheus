## Why

The SSR OS effort depends on a mix of owned and reused public GitHub repositories, but there is no single place to see which repositories matter, what changed recently, and whether a fork has drifted from its parent. A lightweight tracker is needed now so repository activity and fork drift can be monitored without manual curation or a backend service.

## What Changes

- Add `ossr`, a static dashboard for a user-provided list of public GitHub repositories.
- Fetch repository metadata, recent commit activity, and fork relationships from GitHub and publish derived snapshot data for the dashboard.
- Compute automated status indicators from repository activity and fork drift without requiring manual annotations.
- Present an overview page, a sortable repository list, and per-repository detail views suitable for GitHub Pages hosting.

## Capabilities

### New Capabilities
- `github-repo-tracking`: Track public GitHub repositories from a configured list and expose recent activity, fork drift, and derived status in a static dashboard.

### Modified Capabilities

## Impact

- Adds a data ingestion and snapshot generation flow against the GitHub public API.
- Adds a static web dashboard intended for GitHub Pages deployment.
- Introduces a repository list configuration as the only required input.
- No existing specs or runtime systems are modified.
