"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import type { RunDetail, RunSummary, RunsIndexPayload } from "@/src/types";

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

interface AnsiState {
  bold: boolean;
  dim: boolean;
  fg: string | null;
}

function ansiStateClassNames(state: AnsiState): string {
  const classes = ["log-seg"];
  if (state.bold) {
    classes.push("is-bold");
  }
  if (state.dim) {
    classes.push("is-dim");
  }
  if (state.fg) {
    classes.push(`fg-${state.fg}`);
  }
  return classes.join(" ");
}

function renderAnsiHtml(value: string): string {
  const ansiPattern = /\u001b\[([0-9;]*)m/g;
  const initialState: AnsiState = { bold: false, dim: false, fg: null };
  let state = { ...initialState };
  let cursor = 0;
  let html = "";

  const pushText = (text: string) => {
    if (!text) {
      return;
    }
    html += `<span class="${ansiStateClassNames(state)}">${escapeHtml(text)}</span>`;
  };

  const applyCode = (code: number) => {
    if (code === 0) {
      state = { ...initialState };
      return;
    }
    if (code === 1) {
      state.bold = true;
      return;
    }
    if (code === 2) {
      state.dim = true;
      return;
    }
    if (code === 22) {
      state.bold = false;
      state.dim = false;
      return;
    }
    if (code === 39) {
      state.fg = null;
      return;
    }
    const foregroundMap: Record<number, string> = {
      30: "black",
      31: "red",
      32: "green",
      33: "yellow",
      34: "blue",
      35: "magenta",
      36: "cyan",
      37: "white",
      90: "bright-black",
      91: "bright-red",
      92: "bright-green",
      93: "bright-yellow",
      94: "bright-blue",
      95: "bright-magenta",
      96: "bright-cyan",
      97: "bright-white",
    };
    const mapped = foregroundMap[code];
    if (mapped) {
      state.fg = mapped;
    }
  };

  let match: RegExpExecArray | null;
  while ((match = ansiPattern.exec(value)) !== null) {
    pushText(value.slice(cursor, match.index));
    const codes = (match[1] || "0")
      .split(";")
      .map((item) => Number(item))
      .filter((item) => Number.isFinite(item));
    for (const code of codes) {
      applyCode(code);
    }
    cursor = match.index + match[0].length;
  }
  pushText(value.slice(cursor));
  return html;
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

function nextSelectedRunIdAfterRemoval(runs: RunSummary[], runId: string): string | null {
  const index = runs.findIndex((run) => run.id === runId);
  if (index === -1) {
    return normalizeSelectedRunId(runs, null);
  }
  const nextRun = runs[index + 1] || runs[index - 1] || null;
  return nextRun ? nextRun.id : null;
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
      return `<li class="log-line"><span class="log-ln">${lineNumber}</span><span class="log-lc">${renderAnsiHtml(line)}</span></li>`;
    })
    .join("");
  return `<div class="log-viewer"><ul class="log-lines">${items}</ul></div>`;
}

async function loadWorkflowLog(runId: string): Promise<string> {
  return await fetchText(`/api/runs/${encodeURIComponent(runId)}/log`);
}

async function loadWorkflowDetail(runId: string): Promise<RunDetail> {
  return await fetchJson<RunDetail>(`/api/runs/${encodeURIComponent(runId)}`);
}

async function refreshRunsIndex(
  setSummaries: (runs: RunSummary[]) => void,
  setTotalRuns: (total: number) => void,
  setUpdatedAt: (updatedAt: string) => void,
): Promise<void> {
  const payload = await fetchJson<RunsIndexPayload>("/api/runs");
  setSummaries(payload.runs);
  setTotalRuns(payload.totalRuns);
  setUpdatedAt(payload.updatedAt);
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
  const [runDetail, setRunDetail] = useState<RunDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [stopLoadingRunId, setStopLoadingRunId] = useState<string | null>(null);
  const [removeLoadingRunId, setRemoveLoadingRunId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"log" | "artifacts">("log");
  const logBodyRef = useRef<HTMLDivElement | null>(null);
  const logRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const detailRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function refreshWorkflowLog(
    runId: string,
    options: { background?: boolean } = {},
  ): Promise<void> {
    if (!options.background) {
      setLogLoading(true);
    }
    setLogError(null);
    try {
      const nextLog = await loadWorkflowLog(runId);
      setLogText(nextLog);
    } catch (error) {
      setLogError(error instanceof Error ? error.message : "Failed to load workflow log.");
    } finally {
      if (!options.background) {
        setLogLoading(false);
      }
    }
  }

  async function refreshRunDetail(runId: string): Promise<void> {
    setDetailLoading(true);
    try {
      const detail = await loadWorkflowDetail(runId);
      setRunDetail(detail);
    } catch {
      setRunDetail(null);
    } finally {
      setDetailLoading(false);
    }
  }

  function scheduleLogRefresh(runId: string, delayMs: number): void {
    if (logRefreshTimerRef.current) {
      clearTimeout(logRefreshTimerRef.current);
    }
    logRefreshTimerRef.current = setTimeout(() => {
      logRefreshTimerRef.current = null;
      void refreshWorkflowLog(runId, { background: true });
    }, delayMs);
  }

  function scheduleDetailRefresh(runId: string, delayMs: number): void {
    if (detailRefreshTimerRef.current) {
      clearTimeout(detailRefreshTimerRef.current);
    }
    detailRefreshTimerRef.current = setTimeout(() => {
      detailRefreshTimerRef.current = null;
      void refreshRunDetail(runId);
    }, delayMs);
  }

  useEffect(() => {
    setSelectedRunId((current) => normalizeSelectedRunId(summaries, current));
  }, [summaries]);

  useEffect(() => {
    if (!selectedRunId) {
      setLogText("");
      setLogError(null);
      setLogLoading(false);
      setRunDetail(null);
      setDetailLoading(false);
      return;
    }
    let cancelled = false;
    setLogText("");
    setLogError(null);
    setLogLoading(true);
    setDetailLoading(true);
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
        setLogError(error instanceof Error ? error.message : "Failed to load workflow log.");
        setLogLoading(false);
      });
    void loadWorkflowDetail(selectedRunId)
      .then((detail) => {
        if (cancelled) {
          return;
        }
        setRunDetail(detail);
        setDetailLoading(false);
      })
      .catch(() => {
        if (cancelled) {
          return;
        }
        setRunDetail(null);
        setDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedRunId]);

  async function refreshSummaries(): Promise<void> {
    await refreshRunsIndex(setSummaries, setTotalRuns, setUpdatedAt);
    if (selectedRunId && activeTab === "log") {
      await refreshWorkflowLog(selectedRunId);
    }
    if (selectedRunId && activeTab === "artifacts") {
      await refreshRunDetail(selectedRunId);
    }
  }

  async function onStopWorkflow(runId: string): Promise<void> {
    setActionError(null);
    setStopLoadingRunId(runId);
    try {
      await postJson(`/api/runs/${encodeURIComponent(runId)}/stop`);
      await refreshRunsIndex(setSummaries, setTotalRuns, setUpdatedAt);
      if (activeTab === "log") {
        await refreshWorkflowLog(runId);
      } else {
        await refreshRunDetail(runId);
      }
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Failed to stop workflow.");
    } finally {
      setStopLoadingRunId(null);
    }
  }

  async function onRemoveWorkflow(runId: string): Promise<void> {
    const summary = summaries.find((entry) => entry.id === runId) || null;
    const label = summary?.workflowName || runId;
    if (!window.confirm(`Remove workflow ${label}?`)) {
      return;
    }
    setActionError(null);
    setRemoveLoadingRunId(runId);
    try {
      await postJson(`/api/runs/${encodeURIComponent(runId)}/remove`);
      const nextSelectedRunId =
        selectedRunId === runId
          ? nextSelectedRunIdAfterRemoval(summaries, runId)
          : selectedRunId;
      setSelectedRunId(nextSelectedRunId);
      await refreshRunsIndex(setSummaries, setTotalRuns, setUpdatedAt);
      if (!nextSelectedRunId) {
        setLogText("");
        setLogError(null);
        setRunDetail(null);
      }
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Failed to remove workflow.");
    } finally {
      setRemoveLoadingRunId(null);
    }
  }

  const renderedLogHtml = useMemo(() => renderWorkflowLogHtml(logText), [logText]);
  const selectedSummary = summaries.find((summary) => summary.id === selectedRunId) || null;
  const artifacts = useMemo(() => {
    const items: Array<{ stepId: string; stepName: string; path: string; location: string }> = [];
    for (const step of runDetail?.steps || []) {
      for (const artifact of step.artifacts || []) {
        items.push({
          stepId: step.id,
          stepName: step.name || step.id,
          path: artifact.path,
          location: artifact.location,
        });
      }
    }
    return items;
  }, [runDetail]);

  useEffect(() => {
    const logBody = logBodyRef.current;
    if (!logBody) {
      return;
    }
    logBody.scrollTop = logBody.scrollHeight;
  }, [logText, logLoading]);

  useEffect(() => {
    const events = new EventSource("/api/events");
    events.addEventListener("runs-changed", () => {
      void refreshRunsIndex(setSummaries, setTotalRuns, setUpdatedAt);
      if (selectedRunId) {
        if (activeTab === "log") {
          scheduleLogRefresh(selectedRunId, 1000);
        } else {
          scheduleDetailRefresh(selectedRunId, 250);
        }
      }
    });
    return () => {
      events.close();
      if (logRefreshTimerRef.current) {
        clearTimeout(logRefreshTimerRef.current);
        logRefreshTimerRef.current = null;
      }
      if (detailRefreshTimerRef.current) {
        clearTimeout(detailRefreshTimerRef.current);
        detailRefreshTimerRef.current = null;
      }
    };
  }, [activeTab, selectedRunId]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="flex min-h-screen flex-col">
        <header className="border-b border-border bg-card/80 backdrop-blur">
          <div className="flex w-full items-center justify-between gap-[6px] px-[6px] py-[6px]">
            <div className="flex items-baseline gap-[6px]">
              <strong>Morpheus</strong>
              <span className="text-sm text-muted-foreground">Workflow Viewer</span>
            </div>
            <div className="flex items-center gap-[6px]">
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

        <main className="flex min-h-0 flex-1 flex-col gap-[6px] overflow-hidden px-[6px] py-[6px]">
          <section className="workflow-table-shell">
            <div className="workflow-table-scroll">
              <table className="workflow-table">
                <thead>
                  <tr>
                    <th>Workflow</th>
                    <th>ID</th>
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
                      <td className="workflow-table-empty" colSpan={8}>
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
                          <div className="workflow-table-name">{summary.workflowName || summary.id}</div>
                        </td>
                        <td className="workflow-table-meta-cell">{summary.id}</td>
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
                              disabled={removeLoadingRunId != null || stopLoadingRunId != null}
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
            <div className="workflow-table-header workflow-log-header">
              <div className="workflow-pane-title-row">
                <h2 className="text-lg font-semibold tracking-tight">
                  {selectedSummary
                    ? `${selectedSummary.workflowName || selectedSummary.id}`
                    : "Workflow"}
                </h2>
                <div className="workflow-pane-tabs">
                  <Button
                    onClick={() => setActiveTab("log")}
                    size="sm"
                    variant={activeTab === "log" ? "default" : "outline"}
                  >
                    Log
                  </Button>
                  <Button
                    onClick={() => setActiveTab("artifacts")}
                    size="sm"
                    variant={activeTab === "artifacts" ? "default" : "outline"}
                  >
                    Artifacts
                  </Button>
                </div>
              </div>
            </div>
            <div className="workflow-log-body" ref={logBodyRef}>
              {actionError ? <p className="mb-4 text-sm text-destructive">{actionError}</p> : null}
              {!selectedRunId ? (
                <div className="workflow-empty-state">No workflow selected.</div>
              ) : activeTab === "log" ? !logText && logLoading ? (
                <div className="workflow-empty-state">Loading log…</div>
              ) : (
                <>
                  {logError ? <p className="mb-4 text-sm text-destructive">{logError}</p> : null}
                  {!logText ? (
                    <div className="workflow-empty-state">No log available.</div>
                  ) : (
                    <div dangerouslySetInnerHTML={{ __html: renderedLogHtml }} />
                  )}
                </>
              ) : detailLoading ? (
                <div className="workflow-empty-state">Loading artifacts…</div>
              ) : artifacts.length === 0 ? (
                <div className="workflow-empty-state">No artifacts available.</div>
              ) : (
                <div className="workflow-artifacts-list">
                  {artifacts.map((artifact) => (
                    <div className="workflow-artifact-row" key={`${artifact.stepId}:${artifact.path}:${artifact.location}`}>
                      <div className="workflow-artifact-meta">
                        <strong>{artifact.path}</strong>
                        <span>{artifact.stepName}</span>
                      </div>
                      <code>{artifact.location}</code>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}
