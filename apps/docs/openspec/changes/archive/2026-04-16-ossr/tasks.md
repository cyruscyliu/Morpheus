## 1. Input And Data Fetching

- [x] 1.1 Define the tracked repository list format using `owner/repo` identifiers and add an example input file.
- [x] 1.2 Implement GitHub fetch logic for repository metadata and bounded recent commit history for each configured repository.
- [x] 1.3 Handle malformed, missing, or inaccessible public repositories without aborting the full snapshot run.

## 2. Snapshot Generation

- [x] 2.1 Design and implement the generated snapshot schema for overview data and per-repository detail data.
- [x] 2.2 Implement fork drift collection for forked repositories, including graceful handling when ahead/behind comparison is unavailable.
- [x] 2.3 Implement deterministic status derivation rules for activity and fork drift and include the generated timestamp in the snapshot output.

## 3. Static Dashboard

- [x] 3.1 Build the overview page that renders aggregate counts and the tracked repository list from generated snapshot data.
- [x] 3.2 Build repository detail views that show repository metadata, recent commits, and fork drift when available.
- [x] 3.3 Add sorting and filtering controls for key fields such as activity, fork state, and drift status.

## 4. Publishing And Verification

- [x] 4.1 Configure a GitHub Actions workflow to generate snapshots on schedule and on demand.
- [x] 4.2 Configure GitHub Pages deployment to publish the static dashboard and generated snapshot assets.
- [x] 4.3 Add verification coverage for config parsing, status derivation, fork drift fallback behavior, and snapshot rendering against representative repository fixtures.
