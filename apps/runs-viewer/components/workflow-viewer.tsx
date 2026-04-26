"use client";

import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import type { RunDetail, RunSummary, RunsIndexPayload } from "@/src/types";

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function formatTimestamp(value: string | null | undefined): string {
  if (!value) {
    return "-";
  }
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return value;
  }
  return new Date(parsed).toLocaleString();
}

function normalizeSelectedRunId(
  runs: RunSummary[],
  selectedRunId: string | null,
): string | null {
  if (runs.length === 0) {
    return null;
  }
  if (selectedRunId && runs.some((run) => run.id === selectedRunId)) {
    return selectedRunId;
  }
  return runs[0]?.id ?? null;
}

async function fetchJson<T>(input: string): Promise<T> {
  const response = await fetch(input, {
    cache: "no-store",
    headers: { accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
  return (await response.json()) as T;
}

async function fetchText(input: string): Promise<string> {
  const response = await fetch(input, {
    cache: "no-store",
    headers: { accept: "text/plain" },
  });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
  return await response.text();
}

async function postJson<T>(input: string): Promise<T> {
  const response = await fetch(input, {
    method: "POST",
    headers: { accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error((await response.text()) || `${response.status} ${response.statusText}`);
  }
  return (await response.json()) as T;
}

function renderWorkflowLogHtml(logText: string): string {
  const lines = logText.replace(/\r\n/g, "\n").split("\n");
  const items = lines
    .filter((line, index, values) => !(index === values.length - 1 && line === ""))
    .map((line, index) => {
      const lineNumber = index + 1;
      return `<li class="log-line"><span class="log-ln">${lineNumber}</span><span class="log-lc">${escapeHtml(line)}</span></li>`;
    })
    .join("");
  return `<div class="log-viewer"><ul class="log-lines">${items}</ul></div>`;
}

async function loadWorkflowLog(runId: string): Promise<string> {
  const detail = await fetchJson<RunDetail>(`/api/runs/${encodeURIComponent(runId)}`);
  const stepLogs = await Promise.all(
    detail.steps.map(async (step) => {
      if (!step.logUrl) {
        return null;
      }
      const text = await fetchText(step.logUrl);
      const title = step.name || step.id;
      return [`=== ${title} (${step.status}) ===`, text.trimEnd()].join("\n");
    }),
  );
  return stepLogs.filter((value): value is string => Boolean(value)).join("\n\n");
}

async function refreshViewerState(
  selectedRunId: string | null,
  setSummaries: (runs: RunSummary[]) => void,
  setTotalRuns: (total: number) => void,
  setUpdatedAt: (updatedAt: string) => void,
  setLogText: (text: string) => void,
  setLogError: (error: string | null) => void,
  setLogLoading: (loading: boolean) => void,
): Promise<void> {
  const payload = await fetchJson<RunsIndexPayload>("/api/runs");
  setSummaries(payload.runs);
  setTotalRuns(payload.totalRuns);
  setUpdatedAt(payload.updatedAt);

  if (!selectedRunId || !payload.runs.some((run) => run.id === selectedRunId)) {
    setLogText("");
    setLogError(null);
    setLogLoading(false);
    return;
  }

  setLogLoading(true);
  setLogError(null);
  try {
    const nextLog = await loadWorkflowLog(selectedRunId);
    setLogText(nextLog);
    setLogLoading(false);
  } catch (error) {
    setLogText("");
    setLogError(error instanceof Error ? error.message : "Failed to load workflow log.");
    setLogLoading(false);
  }
}

interface WorkflowViewerProps {
  initialSummaries: RunSummary[];
  initialTotalRuns: number;
  initialUpdatedAt: string;
}

export function WorkflowViewer({
  initialSummaries,
  initialTotalRuns,
  initialUpdatedAt,
}: WorkflowViewerProps) {
  const [summaries, setSummaries] = useState<RunSummary[]>(initialSummaries);
  const [totalRuns, setTotalRuns] = useState(initialTotalRuns);
  const [updatedAt, setUpdatedAt] = useState(initialUpdatedAt);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(() =>
    normalizeSelectedRunId(initialSummaries, null),
  );
  const [logText, setLogText] = useState<string>("");
  const [logLoading, setLogLoading] = useState(false);
  const [logError, setLogError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [stopLoadingRunId, setStopLoadingRunId] = useState<string | null>(null);
  const [removeLoadingRunId, setRemoveLoadingRunId] = useState<string | null>(null);

  useEffect(() => {
    setSelectedRunId((current) => normalizeSelectedRunId(summaries, current));
  }, [summaries]);

  useEffect(() => {
    if (!selectedRunId) {
      setLogText("");
      setLogError(null);
      return;
    }
    let cancelled = false;
    setLogLoading(true);
    setLogError(null);
    void loadWorkflowLog(selectedRunId)
      .then((nextLog) => {
        if (cancelled) {
          return;
        }
        setLogText(nextLog);
        setLogLoading(false);
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        setLogText("");
        setLogError(error instanceof Error ? error.message : "Failed to load workflow log.");
        setLogLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedRunId]);

  async function refreshSummaries(): Promise<void> {
    await refreshViewerState(
      selectedRunId,
      setSummaries,
      setTotalRuns,
      setUpdatedAt,
      setLogText,
      setLogError,
      setLogLoading,
    );
  }

  async function onStopWorkflow(runId: string): Promise<void> {
    setActionError(null);
    setStopLoadingRunId(runId);
    try {
      await postJson(`/api/runs/${encodeURIComponent(runId)}/stop`);
      await refreshViewerState(
        runId,
        setSummaries,
        setTotalRuns,
        setUpdatedAt,
        setLogText,
        setLogError,
        setLogLoading,
      );
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Failed to stop workflow.");
    } finally {
      setStopLoadingRunId(null);
    }
  }

  async function onRemoveWorkflow(runId: string): Promise<void> {
    setActionError(null);
    setRemoveLoadingRunId(runId);
    try {
      await postJson(`/api/runs/${encodeURIComponent(runId)}/remove`);
      const nextSelectedRunId = selectedRunId === runId ? null : selectedRunId;
      setSelectedRunId(nextSelectedRunId);
      await refreshViewerState(
        nextSelectedRunId,
        setSummaries,
        setTotalRuns,
        setUpdatedAt,
        setLogText,
        setLogError,
        setLogLoading,
      );
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Failed to remove workflow.");
    } finally {
      setRemoveLoadingRunId(null);
    }
  }

  const renderedLogHtml = useMemo(() => renderWorkflowLogHtml(logText), [logText]);
  const selectedSummary = summaries.find((summary) => summary.id === selectedRunId) || null;

  useEffect(() => {
    const events = new EventSource("/api/events");
    events.addEventListener("runs-changed", () => {
      void refreshViewerState(
        selectedRunId,
        setSummaries,
        setTotalRuns,
        setUpdatedAt,
        setLogText,
        setLogError,
        setLogLoading,
      );
    });
    return () => events.close();
  }, [selectedRunId]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="flex min-h-screen flex-col">
        <header className="border-b border-border bg-card/80 backdrop-blur">
          <div className="flex w-full items-center justify-between gap-4 px-4 py-3">
            <div className="flex items-baseline gap-3">
              <strong>Morpheus</strong>
              <span className="text-sm text-muted-foreground">Workflow Viewer</span>
            </div>
            <div className="flex items-center gap-3">
              <div className="text-sm text-muted-foreground">
                <span>
                  {summaries.length} / {totalRuns}
                </span>
              </div>
              <div className="text-sm text-muted-foreground">
                <span className="mr-1 uppercase tracking-[0.06em]">Updated</span>
                <span>{updatedAt ? formatTimestamp(updatedAt) : "-"}</span>
              </div>
              <Button onClick={() => void refreshSummaries()} variant="outline">
                Refresh
              </Button>
            </div>
          </div>
        </header>

        <main className="flex flex-1 flex-col gap-4 px-4 py-4">
          <section className="workflow-table-shell">
            <div className="workflow-table-scroll">
              <table className="workflow-table">
                <thead>
                  <tr>
                    <th>Workflow</th>
                    <th>Status</th>
                    <th>Type</th>
                    <th>Created</th>
                    <th>Completed</th>
                    <th>Steps</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {summaries.length === 0 ? (
                    <tr>
                      <td className="workflow-table-empty" colSpan={7}>
                        No workflows.
                      </td>
                    </tr>
                  ) : (
                    summaries.map((summary) => (
                      <tr
                        className={selectedRunId === summary.id ? "is-selected" : undefined}
                        key={summary.id}
                        onClick={() => setSelectedRunId(summary.id)}
                      >
                        <td className="workflow-table-id">
                          <div className="workflow-table-name">
                            {summary.workflowName || summary.id}
                          </div>
                          {summary.workflowName && summary.workflowName !== summary.id ? (
                            <div className="workflow-table-meta">{summary.id}</div>
                          ) : null}
                        </td>
                        <td>
                          <span className={`workflow-status-text is-${summary.status}`}>{summary.status}</span>
                        </td>
                        <td>{summary.category}</td>
                        <td>{formatTimestamp(summary.createdAt)}</td>
                        <td>{formatTimestamp(summary.completedAt)}</td>
                        <td>{summary.stepCount}</td>
                        <td>
                          <div className="workflow-table-actions">
                            {summary.format === "workflow-first" && summary.status === "running" ? (
                              <Button
                                onClick={(event) => {
                                  event.stopPropagation();
                                  void onStopWorkflow(summary.id);
                                }}
                                size="sm"
                                variant="outline"
                              >
                                {stopLoadingRunId === summary.id ? "Stopping..." : "Stop"}
                              </Button>
                            ) : null}
                            <Button
                              onClick={(event) => {
                                event.stopPropagation();
                                void onRemoveWorkflow(summary.id);
                              }}
                              size="sm"
                              variant="outline"
                            >
                              {removeLoadingRunId === summary.id ? "Removing..." : "Remove"}
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="workflow-log-shell">
            <div className="workflow-table-header">
              <h2 className="text-lg font-semibold tracking-tight">
                {selectedSummary
                  ? `Log · ${selectedSummary.workflowName || selectedSummary.id}`
                  : "Log"}
              </h2>
            </div>
            <div className="workflow-log-body">
              {actionError ? <p className="mb-4 text-sm text-destructive">{actionError}</p> : null}
              {!selectedRunId ? (
                <div className="workflow-empty-state">No workflow selected.</div>
              ) : logLoading ? (
                <div className="workflow-empty-state">Loading log…</div>
              ) : logError ? (
                <p className="text-sm text-destructive">{logError}</p>
              ) : !logText ? (
                <div className="workflow-empty-state">No log available.</div>
              ) : (
                <div dangerouslySetInnerHTML={{ __html: renderedLogHtml }} />
              )}
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}
