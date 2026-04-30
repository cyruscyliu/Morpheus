"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import type {
  RunDetail,
  RunGraphEdge,
  RunGraphNode,
  RunStepSummary,
  RunSummary,
  RunsIndexPayload,
} from "@/src/types";

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

interface AnsiState {
  bold: boolean;
  dim: boolean;
  fg: string | null;
}

interface PositionedGraphNode extends RunGraphNode {
  x: number;
  y: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
}

interface GraphLayout {
  width: number;
  height: number;
  nodes: PositionedGraphNode[];
  nodeMap: Map<string, PositionedGraphNode>;
}

interface GraphRow {
  items: RunGraphNode[];
  width: number;
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
  const ansiPattern = /\[([0-9;]*)m/g;
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

const LARGE_LOG_LINE_THRESHOLD = 4000;
const LARGE_LOG_CHAR_THRESHOLD = 250_000;
const LARGE_LOG_TAIL_LINES = 1200;

function normalizeTerminalLogText(value: string): string {
  const text = value.replace(/\r\n/g, "\n");
  let currentLine = "";
  const lines: string[] = [];

  const pushLine = () => {
    lines.push(currentLine);
    currentLine = "";
  };

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index] || "";
    if (char === "\u001b") {
      let cursor = index + 1;
      while (cursor < text.length && !/[A-Za-z]/.test(text[cursor] || "")) {
        cursor += 1;
      }
      if (cursor < text.length) {
        currentLine += text.slice(index, cursor + 1);
        index = cursor;
        continue;
      }
    }
    if (char === "\r") {
      currentLine = "";
      continue;
    }
    if (char === "\b") {
      currentLine = currentLine.slice(0, -1);
      continue;
    }
    if (char === "\n") {
      pushLine();
      continue;
    }
    if (char < " " && char !== "\t") {
      continue;
    }
    currentLine += char;
  }

  if (currentLine.length > 0 || text.endsWith("\n")) {
    pushLine();
  }

  return lines.join("\n");
}

function deriveLogPresentation(
  rawLogText: string,
  expanded: boolean,
): { text: string; totalLines: number; shownLines: number; truncated: boolean } {
  const normalized = normalizeTerminalLogText(rawLogText);
  const lines = normalized.split("\n");
  const totalLines = lines.length;
  const largeLog =
    totalLines > LARGE_LOG_LINE_THRESHOLD || normalized.length > LARGE_LOG_CHAR_THRESHOLD;

  if (!largeLog || expanded) {
    return {
      text: normalized,
      totalLines,
      shownLines: totalLines,
      truncated: false,
    };
  }

  const tail = lines.slice(-LARGE_LOG_TAIL_LINES);
  return {
    text: tail.join("\n"),
    totalLines,
    shownLines: tail.length,
    truncated: true,
  };
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

function stepDisplayName(step: RunStepSummary | RunGraphNode): string {
  return step.name || step.id;
}

function formatGraphEdge(edge: RunGraphEdge): string {
  if (edge.artifactPath) {
    return edge.artifactPath;
  }
  if (edge.label) {
    return edge.label;
  }
  return edge.kind === "artifact" ? "artifact" : "sequence";
}

function nextStepInspectionTab(
  step: RunStepSummary | null,
  currentTab: "overview" | "log" | "artifacts",
): "overview" | "log" | "artifacts" {
  const hasLog = Boolean(step?.logUrl);
  const hasArtifacts = (step?.artifacts?.length || 0) > 0;

  if (hasLog) {
    return "log";
  }
  if (currentTab === "artifacts" && hasArtifacts) {
    return "artifacts";
  }
  if (hasArtifacts) {
    return "artifacts";
  }
  return "overview";
}

const inspectionTabs = ["overview", "log", "artifacts"] as const;

type InspectionTab = (typeof inspectionTabs)[number];

function buildGraphLayout(
  nodes: RunGraphNode[],
  edges: RunGraphEdge[],
  viewportWidth: number,
): GraphLayout | null {
  if (nodes.length === 0) {
    return null;
  }

  const nodeWidth = 220;
  const nodeHeight = 88;
  const colGap = 92;
  const rowGap = 28;
  const wrapRowGap = 56;
  const paddingX = 32;
  const paddingY = 24;

  const layerMap = new Map<string, number>();
  for (const node of nodes) {
    layerMap.set(node.id, 0);
  }

  for (let pass = 0; pass < nodes.length; pass += 1) {
    let changed = false;
    for (const edge of edges) {
      const sourceLayer = layerMap.get(edge.source);
      const targetLayer = layerMap.get(edge.target);
      if (sourceLayer == null || targetLayer == null) {
        continue;
      }
      const nextLayer = sourceLayer + 1;
      if (nextLayer > targetLayer) {
        layerMap.set(edge.target, nextLayer);
        changed = true;
      }
    }
    if (!changed) {
      break;
    }
  }

  const grouped = new Map<number, RunGraphNode[]>();
  for (const node of nodes) {
    const layer = layerMap.get(node.id) || 0;
    const items = grouped.get(layer) || [];
    items.push(node);
    grouped.set(layer, items);
  }

  const layerEntries = [...grouped.entries()].sort((left, right) => left[0] - right[0]);
  const shouldWrap =
    viewportWidth > 0 &&
    nodes.length > 4 &&
    layerEntries.length === nodes.length &&
    layerEntries.every(([, items]) => items.length === 1);

  const positioned: PositionedGraphNode[] = [];

  if (shouldWrap) {
    const orderedNodes = layerEntries.flatMap(([, items]) => items);
    const usableWidth = Math.max(viewportWidth - paddingX * 2, nodeWidth);
    const maxColumns = Math.max(1, Math.floor((usableWidth + colGap) / (nodeWidth + colGap)));
    const rows: GraphRow[] = [];

    for (let index = 0; index < orderedNodes.length; index += maxColumns) {
      const items = orderedNodes.slice(index, index + maxColumns);
      const width = items.length * nodeWidth + Math.max(items.length - 1, 0) * colGap;
      rows.push({ items, width });
    }

    const contentWidth = Math.max(...rows.map((row) => row.width), nodeWidth);
    rows.forEach((row, rowIndex) => {
      const startX = paddingX + (contentWidth - row.width) / 2;
      const y = paddingY + rowIndex * (nodeHeight + wrapRowGap);
      row.items.forEach((node, itemIndex) => {
        const visualIndex = rowIndex % 2 === 0 ? itemIndex : row.items.length - 1 - itemIndex;
        const x = startX + visualIndex * (nodeWidth + colGap);
        positioned.push({
          ...node,
          x,
          y,
          width: nodeWidth,
          height: nodeHeight,
          centerX: x + nodeWidth / 2,
          centerY: y + nodeHeight / 2,
        });
      });
    });

    const nodeMap = new Map(positioned.map((node) => [node.id, node]));
    const width = paddingX * 2 + contentWidth;
    const height = paddingY * 2 + rows.length * nodeHeight + Math.max(rows.length - 1, 0) * wrapRowGap;
    return { width, height, nodes: positioned, nodeMap };
  }

  const maxRows = Math.max(...layerEntries.map(([, items]) => items.length), 1);
  const contentHeight = maxRows * nodeHeight + Math.max(maxRows - 1, 0) * rowGap;

  for (const [layer, items] of layerEntries) {
    const layerHeight = items.length * nodeHeight + Math.max(items.length - 1, 0) * rowGap;
    const startY = paddingY + (contentHeight - layerHeight) / 2;
    items.forEach((node, index) => {
      const x = paddingX + layer * (nodeWidth + colGap);
      const y = startY + index * (nodeHeight + rowGap);
      positioned.push({
        ...node,
        x,
        y,
        width: nodeWidth,
        height: nodeHeight,
        centerX: x + nodeWidth / 2,
        centerY: y + nodeHeight / 2,
      });
    });
  }

  const nodeMap = new Map(positioned.map((node) => [node.id, node]));
  const maxLayer = Math.max(...layerEntries.map(([layer]) => layer), 0);
  const width = paddingX * 2 + (maxLayer + 1) * nodeWidth + maxLayer * colGap;
  const height = paddingY * 2 + contentHeight;

  return { width, height, nodes: positioned, nodeMap };
}

function edgePath(source: PositionedGraphNode, target: PositionedGraphNode): string {
  const horizontalGap = Math.abs(target.centerX - source.centerX);
  const verticalGap = Math.abs(target.centerY - source.centerY);

  if (verticalGap < 12) {
    const leftToRight = target.centerX >= source.centerX;
    const startX = leftToRight ? source.x + source.width : source.x;
    const endX = leftToRight ? target.x : target.x + target.width;
    const startY = source.centerY;
    const endY = target.centerY;
    const direction = leftToRight ? 1 : -1;
    const delta = Math.max(horizontalGap / 2, 40);
    return `M ${startX} ${startY} C ${startX + delta * direction} ${startY}, ${endX - delta * direction} ${endY}, ${endX} ${endY}`;
  }

  const topToBottom = target.centerY >= source.centerY;
  const startX = source.centerX;
  const startY = topToBottom ? source.y + source.height : source.y;
  const endX = target.centerX;
  const endY = topToBottom ? target.y : target.y + target.height;
  const direction = topToBottom ? 1 : -1;
  const delta = Math.max(verticalGap / 2, 40);
  return `M ${startX} ${startY} C ${startX} ${startY + delta * direction}, ${endX} ${endY - delta * direction}, ${endX} ${endY}`;
}

function edgeLabelPosition(source: PositionedGraphNode, target: PositionedGraphNode): { x: number; y: number } {
  return {
    x: (source.centerX + target.centerX) / 2,
    y: (source.centerY + target.centerY) / 2 - 8,
  };
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
    const body = await response.text();
    if (body) {
      try {
        const parsed = JSON.parse(body);
        const message =
          (parsed && typeof parsed.summary === "string" && parsed.summary)
          || (parsed && parsed.error && typeof parsed.error.message === "string" && parsed.error.message)
          || body;
        throw new Error(message);
      } catch (error) {
        if (error instanceof Error) {
          throw error;
        }
      }
      throw new Error(body);
    }
    throw new Error(`${response.status} ${response.statusText}`);
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

async function loadStepLog(runId: string, stepId: string): Promise<string> {
  return await fetchText(`/api/runs/${encodeURIComponent(runId)}/steps/${encodeURIComponent(stepId)}/log`);
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
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<InspectionTab>("overview");
  const [logText, setLogText] = useState<string>("");
  const [expandedLog, setExpandedLog] = useState(false);
  const [logLoading, setLogLoading] = useState(false);
  const [logError, setLogError] = useState<string | null>(null);
  const [runDetail, setRunDetail] = useState<RunDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [stopLoadingRunId, setStopLoadingRunId] = useState<string | null>(null);
  const [removeLoadingRunId, setRemoveLoadingRunId] = useState<string | null>(null);
  const [resumeLoadingRunId, setResumeLoadingRunId] = useState<string | null>(null);
  const [rerunLoadingStepId, setRerunLoadingStepId] = useState<string | null>(null);
  const [graphViewportWidth, setGraphViewportWidth] = useState(0);
  const logBodyRef = useRef<HTMLDivElement | null>(null);
  const graphBodyRef = useRef<HTMLDivElement | null>(null);
  const tabRefs = useRef<Record<InspectionTab, HTMLButtonElement | null>>({
    overview: null,
    log: null,
    artifacts: null,
  });
  const logRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const detailRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const logRequestIdRef = useRef(0);

  const selectedSummary = summaries.find((summary) => summary.id === selectedRunId) || null;
  const selectedStep = runDetail?.steps.find((step) => step.id === selectedStepId) || null;

  function focusTab(tab: InspectionTab): void {
    tabRefs.current[tab]?.focus();
  }

  function onTabKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, tab: InspectionTab): void {
    const currentIndex = inspectionTabs.indexOf(tab);
    if (currentIndex === -1) {
      return;
    }

    if (event.key === "ArrowRight") {
      event.preventDefault();
      const nextTab = inspectionTabs[(currentIndex + 1) % inspectionTabs.length] || tab;
      setActiveTab(nextTab);
      focusTab(nextTab);
      return;
    }

    if (event.key === "ArrowLeft") {
      event.preventDefault();
      const nextTab = inspectionTabs[(currentIndex - 1 + inspectionTabs.length) % inspectionTabs.length] || tab;
      setActiveTab(nextTab);
      focusTab(nextTab);
      return;
    }

    if (event.key === "Home") {
      event.preventDefault();
      const nextTab = inspectionTabs[0] || tab;
      setActiveTab(nextTab);
      focusTab(nextTab);
      return;
    }

    if (event.key === "End") {
      event.preventDefault();
      const nextTab = inspectionTabs[inspectionTabs.length - 1] || tab;
      setActiveTab(nextTab);
      focusTab(nextTab);
    }
  }

  async function refreshActiveLog(
    runId: string,
    stepId: string | null,
    options: { background?: boolean } = {},
  ): Promise<void> {
    const requestId = logRequestIdRef.current + 1;
    logRequestIdRef.current = requestId;
    if (!options.background) {
      setLogLoading(true);
      setLogText("");
    }
    setLogError(null);
    try {
      const nextLog = stepId ? await loadStepLog(runId, stepId) : await loadWorkflowLog(runId);
      if (requestId !== logRequestIdRef.current) {
        return;
      }
      setLogText(nextLog);
    } catch (error) {
      if (requestId !== logRequestIdRef.current) {
        return;
      }
      setLogText("");
      const message = error instanceof Error ? error.message : "Failed to load log.";
      setLogError(/^404\b/.test(message) ? null : message);
    } finally {
      if (!options.background && requestId === logRequestIdRef.current) {
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

  function scheduleLogRefresh(runId: string, stepId: string | null, delayMs: number): void {
    if (logRefreshTimerRef.current) {
      clearTimeout(logRefreshTimerRef.current);
    }
    logRefreshTimerRef.current = setTimeout(() => {
      logRefreshTimerRef.current = null;
      void refreshActiveLog(runId, stepId, { background: true });
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
    setSelectedStepId(null);
    setActiveTab("overview");
    setExpandedLog(false);
  }, [selectedRunId]);

  useEffect(() => {
    setExpandedLog(false);
  }, [selectedStepId]);

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
    setRunDetail(null);
    setLogLoading(activeTab === "log");
    setDetailLoading(true);
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
    if (activeTab === "log") {
      void refreshActiveLog(selectedRunId, selectedStepId);
    }
    return () => {
      cancelled = true;
    };
  }, [selectedRunId]);

  useEffect(() => {
    logRequestIdRef.current += 1;
    if (!selectedRunId) {
      setLogText("");
      setLogError(null);
      setLogLoading(false);
      return;
    }
    if (activeTab !== "log") {
      setLogText("");
      setLogError(null);
      setLogLoading(false);
      return;
    }
    void refreshActiveLog(selectedRunId, selectedStepId);
  }, [activeTab, selectedRunId, selectedStepId]);

  useEffect(() => {
    if (!runDetail || !selectedStepId) {
      return;
    }
    if (runDetail.steps.some((step) => step.id === selectedStepId)) {
      return;
    }
    setSelectedStepId(null);
    setActiveTab("overview");
  }, [runDetail, selectedStepId]);

  async function refreshSummaries(): Promise<void> {
    await refreshRunsIndex(setSummaries, setTotalRuns, setUpdatedAt);
    if (!selectedRunId) {
      return;
    }
    await refreshRunDetail(selectedRunId);
    if (activeTab === "log") {
      await refreshActiveLog(selectedRunId, selectedStepId);
    }
  }

  async function onStopWorkflow(runId: string): Promise<void> {
    setActionError(null);
    setStopLoadingRunId(runId);
    try {
      await postJson(`/api/runs/${encodeURIComponent(runId)}/stop`);
      await refreshRunsIndex(setSummaries, setTotalRuns, setUpdatedAt);
      await refreshRunDetail(runId);
      if (activeTab === "log") {
        await refreshActiveLog(runId, selectedRunId === runId ? selectedStepId : null);
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
      setSelectedStepId(null);
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

  async function onResumeWorkflow(runId: string, fromStep: string | null): Promise<void> {
    setActionError(null);
    setResumeLoadingRunId(runId);
    setRerunLoadingStepId(fromStep);
    try {
      const query = fromStep ? `?fromStep=${encodeURIComponent(fromStep)}` : "";
      await postJson(`/api/runs/${encodeURIComponent(runId)}/resume${query}`);
      await refreshRunsIndex(setSummaries, setTotalRuns, setUpdatedAt);
      await refreshRunDetail(runId);
      if (activeTab === "log") {
        await refreshActiveLog(runId, selectedStepId);
      }
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Failed to resume workflow.");
    } finally {
      setResumeLoadingRunId(null);
      setRerunLoadingStepId(null);
    }
  }

  const logPresentation = useMemo(
    () => deriveLogPresentation(logText, expandedLog),
    [expandedLog, logText],
  );
  const renderedLogHtml = useMemo(
    () => renderWorkflowLogHtml(logPresentation.text),
    [logPresentation.text],
  );
  const artifacts = useMemo(() => {
    if (!selectedStepId) {
      const items: Array<{ stepId: string; stepName: string; path: string; location: string }> = [];
      for (const step of runDetail?.steps || []) {
        for (const artifact of step.artifacts || []) {
          items.push({
            stepId: step.id,
            stepName: stepDisplayName(step),
            path: artifact.path,
            location: artifact.location,
          });
        }
      }
      return items;
    }
    if (!selectedStep) {
      return [];
    }
    return (selectedStep.artifacts || []).map((artifact) => ({
      stepId: selectedStep.id,
      stepName: stepDisplayName(selectedStep),
      path: artifact.path,
      location: artifact.location,
    }));
  }, [runDetail, selectedStep, selectedStepId]);

  const graphNodes = runDetail?.graph.nodes || [];
  const graphEdges = runDetail?.graph.edges || [];
  const graphLayout = useMemo(
    () => buildGraphLayout(graphNodes, graphEdges, graphViewportWidth),
    [graphEdges, graphNodes, graphViewportWidth],
  );

  useEffect(() => {
    const logBody = logBodyRef.current;
    if (!logBody) {
      return;
    }
    logBody.scrollTop = logBody.scrollHeight;
  }, [logText, logLoading]);

  useEffect(() => {
    const graphBody = graphBodyRef.current;
    if (!graphBody) {
      return;
    }

    const updateWidth = () => {
      setGraphViewportWidth(graphBody.clientWidth);
    };

    updateWidth();
    const resizeObserver = new ResizeObserver(() => {
      updateWidth();
    });
    resizeObserver.observe(graphBody);
    window.addEventListener("resize", updateWidth);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", updateWidth);
    };
  }, []);

  useEffect(() => {
    const events = new EventSource("/api/events");
    events.addEventListener("runs-changed", () => {
      void refreshRunsIndex(setSummaries, setTotalRuns, setUpdatedAt);
      if (selectedRunId) {
        scheduleDetailRefresh(selectedRunId, 250);
        if (activeTab === "log") {
          scheduleLogRefresh(selectedRunId, selectedStepId, 1000);
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
  }, [activeTab, selectedRunId, selectedStepId]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="workflow-viewer-shell">
        <header className="workflow-topbar">
          <div className="workflow-topbar-title">
            <strong>Morpheus</strong>
            <span className="text-sm text-muted-foreground">Workflow Viewer</span>
          </div>
          <div className="workflow-topbar-summary">
            <div className="workflow-topbar-chip">
              <span>{summaries.length}</span>
              <span className="text-muted-foreground">/ {totalRuns}</span>
            </div>
            <div className="workflow-topbar-chip">
              <span className="workflow-topbar-label">Updated</span>
              <span>{updatedAt ? formatTimestamp(updatedAt) : "-"}</span>
            </div>
            <Button onClick={() => void refreshSummaries()} variant="outline">
              Refresh
            </Button>
          </div>
        </header>

        <main className="workflow-main-layout">
          <section className="workflow-middle-shell">
            <aside className="workflow-list-shell">
              <div className="workflow-pane-header">
                <div>
                  <h2 className="workflow-pane-title">Workflows</h2>
                </div>
              </div>
              <div className="workflow-list-body">
                {summaries.length === 0 ? (
                  <div className="workflow-empty-state">No workflows.</div>
                ) : (
                  summaries.map((summary) => {
                    const isSelected = selectedRunId === summary.id;
                    return (
                      <button
                        className={`workflow-list-item${isSelected ? " is-selected" : ""}`}
                        key={summary.id}
                        onClick={() => setSelectedRunId(summary.id)}
                        type="button"
                      >
                        <div className="workflow-list-item-top">
                          <strong>{summary.workflowName || summary.id}</strong>
                          <span
                            aria-label={summary.status}
                            className={`workflow-status-dot is-${summary.status}`}
                            role="img"
                            title={summary.status}
                          />
                        </div>
                        <div className="workflow-list-item-subtle">{formatTimestamp(summary.createdAt)}</div>
                      </button>
                    );
                  })
                )}
              </div>
            </aside>

            <section className="workflow-graph-shell">
              <div className="workflow-pane-header">
                <div>
                  <h2 className="workflow-pane-title">
                    {selectedSummary ? `${selectedSummary.workflowName || selectedSummary.id}` : "Workflow graph"}
                  </h2>
                  {selectedStep ? <p className="workflow-pane-caption">Inspecting {stepDisplayName(selectedStep)}</p> : null}
                </div>
                <div className="workflow-pane-actions">
                  {selectedStep ? (
                    <Button
                      onClick={() => {
                        setSelectedStepId(null);
                        setActiveTab("overview");
                      }}
                      size="sm"
                      variant="ghost"
                    >
                      Workflow overview
                    </Button>
                  ) : null}
                  {selectedSummary?.format === "workflow-first" && selectedStep && selectedSummary.status !== "running" ? (
                    <Button
                      disabled={resumeLoadingRunId != null || removeLoadingRunId != null || stopLoadingRunId != null}
                      onClick={() => void onResumeWorkflow(selectedSummary.id, selectedStep.id)}
                      size="sm"
                      variant="outline"
                    >
                      {rerunLoadingStepId === selectedStep.id ? "Rerunning..." : "Rerun From Step"}
                    </Button>
                  ) : null}
                  {selectedSummary?.format === "workflow-first" && selectedSummary.status === "running" ? (
                    <Button
                      onClick={() => void onStopWorkflow(selectedSummary.id)}
                      size="sm"
                      variant="outline"
                    >
                      {stopLoadingRunId === selectedSummary.id ? "Stopping..." : "Stop"}
                    </Button>
                  ) : null}
                  {selectedSummary?.format === "workflow-first" && selectedSummary.status !== "running" ? (
                    <Button
                      disabled={resumeLoadingRunId != null || removeLoadingRunId != null || stopLoadingRunId != null}
                      onClick={() => void onResumeWorkflow(selectedSummary.id, null)}
                      size="sm"
                      variant="outline"
                    >
                      {resumeLoadingRunId === selectedSummary.id && rerunLoadingStepId == null ? "Resuming..." : "Resume"}
                    </Button>
                  ) : null}
                  {selectedSummary ? (
                    <Button
                      disabled={removeLoadingRunId != null || stopLoadingRunId != null || resumeLoadingRunId != null}
                      onClick={() => void onRemoveWorkflow(selectedSummary.id)}
                      size="sm"
                      variant="outline"
                    >
                      {removeLoadingRunId === selectedSummary.id ? "Removing..." : "Remove"}
                    </Button>
                  ) : null}
                </div>
              </div>
              <div className="workflow-graph-body" ref={graphBodyRef}>
                {actionError ? <p className="text-sm text-destructive">{actionError}</p> : null}
                {!selectedRunId ? (
                  <div className="workflow-empty-state">No workflow selected.</div>
                ) : detailLoading && !runDetail ? (
                  <div className="workflow-empty-state">Loading workflow…</div>
                ) : !runDetail ? (
                  <div className="workflow-empty-state">No workflow detail available.</div>
                ) : !graphLayout ? (
                  <div className="workflow-empty-state">No graph nodes available.</div>
                ) : (
                  <div className="workflow-graph-scroll">
                    <div
                      className="workflow-graph-canvas"
                      style={{ height: `${graphLayout.height}px`, width: `${graphLayout.width}px` }}
                    >
                      <svg
                        className="workflow-graph-svg"
                        height={graphLayout.height}
                        viewBox={`0 0 ${graphLayout.width} ${graphLayout.height}`}
                        width={graphLayout.width}
                      >
                        <defs>
                          <marker
                            id="workflow-arrow-sequence"
                            markerHeight="8"
                            markerWidth="8"
                            orient="auto-start-reverse"
                            refX="7"
                            refY="4"
                          >
                            <path d="M0,0 L8,4 L0,8 z" fill="#6e5f4d" />
                          </marker>
                          <marker
                            id="workflow-arrow-artifact"
                            markerHeight="8"
                            markerWidth="8"
                            orient="auto-start-reverse"
                            refX="7"
                            refY="4"
                          >
                            <path d="M0,0 L8,4 L0,8 z" fill="#165d52" />
                          </marker>
                        </defs>
                        {graphEdges.map((edge) => {
                          const source = graphLayout.nodeMap.get(edge.source);
                          const target = graphLayout.nodeMap.get(edge.target);
                          if (!source || !target) {
                            return null;
                          }
                          const labelPosition = edgeLabelPosition(source, target);
                          return (
                            <g key={edge.id}>
                              <path
                                className={`workflow-graph-path is-${edge.kind}${edge.inferred ? " is-inferred" : ""}`}
                                d={edgePath(source, target)}
                                markerEnd={`url(#workflow-arrow-${edge.kind})`}
                              />
                              <text
                                className="workflow-graph-path-label"
                                textAnchor="middle"
                                x={labelPosition.x}
                                y={labelPosition.y}
                              >
                                {formatGraphEdge(edge)}
                              </text>
                            </g>
                          );
                        })}
                      </svg>
                      {graphLayout.nodes.map((node) => {
                        const isSelected = selectedStepId === node.id;
                        return (
                          <button
                            className={`workflow-graph-node is-${node.status}${isSelected ? " is-selected" : ""}`}
                            key={node.id}
                            onClick={() => {
                              const selectedNodeStep = runDetail?.steps.find((step) => step.id === node.id) || null;
                              setSelectedStepId(node.id);
                              setActiveTab(nextStepInspectionTab(selectedNodeStep, activeTab));
                            }}
                            style={{
                              height: `${node.height}px`,
                              left: `${node.x}px`,
                              top: `${node.y}px`,
                              width: `${node.width}px`,
                            }}
                            type="button"
                          >
                            <div className="workflow-graph-node-top">
                              <strong>{stepDisplayName(node)}</strong>
                              <span className={`workflow-status-text is-${node.status}`}>{node.status}</span>
                            </div>
                            <div className="workflow-graph-node-meta">
                              <span>{node.kind || "step"}</span>
                              <span>{node.artifactCount} artifacts</span>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </section>
          </section>

          <section className="workflow-bottom-shell">
            <div className="workflow-pane-header workflow-bottom-header">
              <div aria-label="Inspection tabs" className="workflow-pane-tabs" role="tablist">
                <button
                  aria-controls="inspection-panel"
                  aria-selected={activeTab === "overview"}
                  className={`workflow-tab${activeTab === "overview" ? " is-active" : ""}`}
                  id="inspection-tab-overview"
                  onClick={() => setActiveTab("overview")}
                  onKeyDown={(event) => onTabKeyDown(event, "overview")}
                  ref={(node) => {
                    tabRefs.current.overview = node;
                  }}
                  role="tab"
                  tabIndex={activeTab === "overview" ? 0 : -1}
                  type="button"
                >
                  Overview
                </button>
                <button
                  aria-controls="inspection-panel"
                  aria-selected={activeTab === "log"}
                  className={`workflow-tab${activeTab === "log" ? " is-active" : ""}`}
                  id="inspection-tab-log"
                  onClick={() => setActiveTab("log")}
                  onKeyDown={(event) => onTabKeyDown(event, "log")}
                  ref={(node) => {
                    tabRefs.current.log = node;
                  }}
                  role="tab"
                  tabIndex={activeTab === "log" ? 0 : -1}
                  type="button"
                >
                  Log
                </button>
                <button
                  aria-controls="inspection-panel"
                  aria-selected={activeTab === "artifacts"}
                  className={`workflow-tab${activeTab === "artifacts" ? " is-active" : ""}`}
                  id="inspection-tab-artifacts"
                  onClick={() => setActiveTab("artifacts")}
                  onKeyDown={(event) => onTabKeyDown(event, "artifacts")}
                  ref={(node) => {
                    tabRefs.current.artifacts = node;
                  }}
                  role="tab"
                  tabIndex={activeTab === "artifacts" ? 0 : -1}
                  type="button"
                >
                  Artifacts
                </button>
              </div>
            </div>
            <div
              aria-labelledby={`inspection-tab-${activeTab}`}
              className="workflow-bottom-body"
              id="inspection-panel"
              ref={activeTab === "log" ? logBodyRef : null}
              role="tabpanel"
            >
              {actionError ? <p className="mb-4 text-sm text-destructive">{actionError}</p> : null}
              {!selectedRunId ? (
                <div className="workflow-empty-state">No workflow selected.</div>
              ) : activeTab === "overview" ? (
                detailLoading && !runDetail ? (
                  <div className="workflow-empty-state">Loading overview…</div>
                ) : !runDetail ? (
                  <div className="workflow-empty-state">No overview available.</div>
                ) : (
                  <div className="workflow-overview-grid">
                    <div className="workflow-overview-card">
                      <span className="workflow-overview-label">Workflow</span>
                      <strong>{selectedSummary?.workflowName || selectedSummary?.id || "-"}</strong>
                    </div>
                    <div className="workflow-overview-card">
                      <span className="workflow-overview-label">Scope</span>
                      <strong>{selectedStep ? stepDisplayName(selectedStep) : "Workflow"}</strong>
                    </div>
                    <div className="workflow-overview-card">
                      <span className="workflow-overview-label">Status</span>
                      <strong className={`workflow-status-text is-${selectedStep?.status || selectedSummary?.status || "unknown"}`}>
                        {selectedStep?.status || selectedSummary?.status || "unknown"}
                      </strong>
                    </div>
                    <div className="workflow-overview-card">
                      <span className="workflow-overview-label">Category</span>
                      <strong>{selectedSummary?.category || "-"}</strong>
                    </div>
                    <div className="workflow-overview-card">
                      <span className="workflow-overview-label">Created</span>
                      <strong>{formatTimestamp(selectedSummary?.createdAt)}</strong>
                    </div>
                    <div className="workflow-overview-card">
                      <span className="workflow-overview-label">Completed</span>
                      <strong>{formatTimestamp(selectedSummary?.completedAt)}</strong>
                    </div>
                    <div className="workflow-overview-card is-wide">
                      <span className="workflow-overview-label">Run directory</span>
                      <code>{runDetail.runDir || "-"}</code>
                    </div>
                    <div className="workflow-overview-card is-wide">
                      <span className="workflow-overview-label">Selection</span>
                      <div className="workflow-overview-list">
                        {(selectedStep ? [selectedStep] : runDetail.steps).map((step) => (
                          <div className="workflow-overview-list-item" key={step.id}>
                            <strong>{stepDisplayName(step)}</strong>
                            <span>{step.kind || "step"}</span>
                            <span className={`workflow-status-text is-${step.status}`}>{step.status}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )
              ) : activeTab === "log" ? (
                !logText && logLoading ? (
                  <div className="workflow-empty-state">Loading log…</div>
                ) : (
                  <>
                    {logError ? <p className="mb-4 text-sm text-destructive">{logError}</p> : null}
                    {!logText ? (
                      <div className="workflow-empty-state">No log available.</div>
                    ) : (
                      <div className="space-y-3">
                        {logPresentation.truncated ? (
                          <div className="flex items-center justify-between gap-3 rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-sm">
                            <span>
                              Showing the last {logPresentation.shownLines.toLocaleString()} of{" "}
                              {logPresentation.totalLines.toLocaleString()} lines.
                            </span>
                            <Button
                              onClick={() => setExpandedLog((current) => !current)}
                              size="sm"
                              variant="outline"
                            >
                              {expandedLog ? "Show tail only" : "Show full log"}
                            </Button>
                          </div>
                        ) : null}
                        <div dangerouslySetInnerHTML={{ __html: renderedLogHtml }} />
                      </div>
                    )}
                  </>
                )
              ) : detailLoading && !runDetail ? (
                <div className="workflow-empty-state">Loading artifacts…</div>
              ) : artifacts.length === 0 ? (
                <div className="workflow-empty-state">No artifacts available.</div>
              ) : (
                <div className="workflow-artifacts-list">
                  {artifacts.map((artifact) => (
                    <ArtifactRow
                      artifact={artifact}
                      key={`${artifact.stepId}:${artifact.path}:${artifact.location}`}
                    />
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

function ArtifactRow({
  artifact,
}: {
  artifact: { stepId: string; stepName: string; path: string; location: string };
}) {
  return (
    <div className="workflow-artifact-row">
      <div className="workflow-artifact-meta">
        <strong>{artifact.path}</strong>
        <span>{artifact.stepName}</span>
      </div>
      <code>{artifact.location}</code>
    </div>
  );
}
