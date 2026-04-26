## 1. Workflow Metadata

- [x] 1.1 Extend workflow-run metadata emission to record workflow category as
      explicit `build` or `run` data for workflow-first records.
- [x] 1.2 Update Workflow Viewer normalization types and server responses to
      expose
      workflow category separately from storage format.
- [x] 1.3 Add or update normalization tests for legacy and workflow-first
      records, including category handling and fallback behavior.

## 2. Viewer Terminology And Navigation

- [x] 2.1 Rename Workflow Viewer UI copy from runs/run to workflows/workflow
      in the left pane and detail pane.
- [x] 2.2 Update workflow list rendering to show workflow category alongside
      workflow id, status, and compact supporting metadata.
- [x] 2.3 Replace the current full-hide collapse behavior with a stable
      collapsed left rail that keeps navigation anchored in place.

## 3. Workflow Detail Presentation

- [x] 3.1 Add a workflow overview section in the middle pane that shows
      category, status, timestamps, change, path, and summary facts above the
      step list.
- [x] 3.2 Adjust styles and layout so the compact workflow list and richer
      workflow detail pane remain readable on desktop and narrow viewports.
- [x] 3.3 Update viewer tests or smoke coverage for workflow terminology,
      category display, and left-pane collapse behavior.

## 4. Documentation

- [x] 4.1 Sync `apps/runs-viewer/README.md` with the Workflow Viewer name,
      workflow terminology, and updated left-pane/detail-pane behavior.
