# github-repo-tracking Specification

## Purpose
TBD - created by archiving change ossr. Update Purpose after archive.
## Requirements
### Requirement: Track configured public GitHub repositories
The system SHALL read a configured list of GitHub repositories identified as `owner/repo` and include each valid public repository in the generated tracking dataset.

#### Scenario: Load configured repositories
- **WHEN** snapshot generation starts with a config file containing repository identifiers
- **THEN** the system loads each identifier and attempts to fetch public repository metadata from GitHub

#### Scenario: Exclude invalid or inaccessible repositories
- **WHEN** a configured repository identifier is malformed, missing, or not publicly accessible
- **THEN** the system excludes it from the generated dataset and reports the failure in generation output

### Requirement: Capture recent repository activity
The system SHALL collect current repository metadata and recent commit activity for each tracked repository.

#### Scenario: Include repository metadata
- **WHEN** a tracked repository is fetched successfully
- **THEN** the generated dataset includes its name, owner, URL, description, fork status, default branch, and last pushed timestamp

#### Scenario: Include recent commits
- **WHEN** a tracked repository is fetched successfully
- **THEN** the generated dataset includes a bounded list of recent commits with commit SHA, author, date, message, and commit URL

### Requirement: Compute fork drift for tracked forks
The system SHALL compute ahead and behind counts for tracked repositories that are forks when GitHub comparison data is available.

#### Scenario: Compute drift for a fork
- **WHEN** a tracked repository is a fork and its parent comparison can be resolved
- **THEN** the generated dataset includes the parent repository identifier and the ahead and behind commit counts for the current default branch

#### Scenario: Handle unavailable fork comparison
- **WHEN** a tracked repository is a fork but comparison data cannot be resolved
- **THEN** the generated dataset marks fork drift as unavailable without failing the entire snapshot

### Requirement: Derive automated repository status
The system SHALL assign a status label to each tracked repository using deterministic rules based on activity and fork drift.

#### Scenario: Mark active repositories
- **WHEN** a tracked repository satisfies the configured threshold for recent activity
- **THEN** the generated dataset marks the repository with an activity status representing recent activity

#### Scenario: Mark stale repositories
- **WHEN** a tracked repository exceeds the configured inactivity threshold
- **THEN** the generated dataset marks the repository with an activity status representing staleness

#### Scenario: Mark drifting forks
- **WHEN** a tracked fork has a behind count above the configured drift threshold
- **THEN** the generated dataset includes a drift-related status indicating that the fork is behind

### Requirement: Publish a static dashboard from generated snapshots
The system SHALL render the tracker as a static site using generated snapshot data without requiring runtime GitHub API access.

#### Scenario: Render repository overview
- **WHEN** a user opens the dashboard
- **THEN** the site displays aggregate counts and a list of tracked repositories using the generated snapshot data

#### Scenario: Render repository detail
- **WHEN** a user opens a repository detail view
- **THEN** the site displays repository metadata, recent commits, and fork drift data if available

#### Scenario: Show snapshot freshness
- **WHEN** a user opens the dashboard
- **THEN** the site displays the timestamp of the most recently generated snapshot

