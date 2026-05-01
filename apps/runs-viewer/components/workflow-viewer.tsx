"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";

import { Button } from "@/components/ui/button";
import type {
  RunDetail,
  RunEventRecord,
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

interface RenderedLogRow {
  ts: string | null;
  event: string;
  stepId: string | null;
  text: string;
  key: string;
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

function prettifyStepId(value: string): string {
  return value
    .replace(/[-_]+/g, " ")
    .replace(/\bphase\b/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function stepDisplayName(step: RunStepSummary | RunGraphNode): string {
  const rawName = String(step.name || "").trim();
  if (rawName && !/^[a-z0-9-]+\.run$/i.test(rawName)) {
    return rawName;
  }
  return prettifyStepId(step.id);
}

function formatGraphEdge(edge: RunGraphEdge): string | null {
  if (edge.kind !== "artifact") {
    return null;
  }
  if (edge.artifactPath) {
    return edge.artifactPath;
  }
  if (edge.label) {
    return edge.label;
  }
  return "artifact";
}

function toolFamily(step: RunStepSummary | RunGraphNode): string {
  const rawName = String(step.name || "").trim().toLowerCase();
  if (rawName.includes(".")) {
    return rawName.split(".")[0] || rawName;
  }
  const rawId = String(step.id || "").trim().toLowerCase();
  const match = rawId.match(/^([a-z0-9]+(?:[-_][a-z0-9]+)*)[-_.]/);
  if (match && match[1]) {
    return match[1];
  }
  return rawId;
}

function formatPathLabel(value: string | null | undefined): string {
  if (!value) {
    return "-";
  }
  const normalized = value.replace(/\\/g, "/").replace(/\/+$/, "");
  const parts = normalized.split("/").filter(Boolean);
  return parts[parts.length - 1] || normalized;
}

function flattenEventPayload(value: unknown): string[] {
  const text = JSON.stringify(value ?? {}, null, 2) || "{}";
  return text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\s+$/, ""))
    .filter((line) => line.length > 0);
}

function withConfigQuery(input: string, configPath: string | null): string {
  if (!configPath) {
    return input;
  }
  const separator = input.includes("?") ? "&" : "?";
  return `${input}${separator}config=${encodeURIComponent(configPath)}`;
}

function nextStepInspectionTab(
  step: RunStepSummary | null,
  currentTab: "overview" | "log" | "artifacts",
): "overview" | "log" | "artifacts" {
  const hasArtifacts = (step?.artifacts?.length || 0) > 0;

  if (currentTab === "artifacts" && hasArtifacts) {
    return "artifacts";
  }
  return "log";
}

const inspectionTabs = ["overview", "log", "artifacts"] as const;

type InspectionTab = (typeof inspectionTabs)[number];

function applyOptimisticWorkflowRunState(
  detail: RunDetail | null,
  runId: string,
  fromStep: string | null,
): RunDetail | null {
  if (!detail || detail.id !== runId || detail.format !== "workflow-first") {
    return detail;
  }

  const stepIds = detail.steps.map((step) => step.id);
  const requestedIndex = fromStep ? stepIds.indexOf(fromStep) : -1;
  const firstPendingIndex = detail.steps.findIndex((step) => step.status !== "success" && step.status !== "reused");
  const startIndex =
    requestedIndex >= 0
      ? requestedIndex
      : firstPendingIndex >= 0
        ? firstPendingIndex
        : Math.max(detail.steps.length - 1, 0);

  const nextSteps = detail.steps.map((step, index) => {
    if (index < startIndex) {
      return {
        ...step,
        status: step.status === "success" ? "reused" : step.status,
      };
    }
    if (index === startIndex) {
      return {
        ...step,
        status: "running",
      };
    }
    return {
      ...step,
      status: "created",
    };
  });

  const nextGraphNodes = detail.graph.nodes.map((node, index) => ({
    ...node,
    status: nextSteps[index]?.status || node.status,
  }));

  return {
    ...detail,
    status: "running",
    completedAt: null,
    steps: nextSteps,
    graph: {
      ...detail.graph,
      nodes: nextGraphNodes,
    },
  };
}

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
  const colGap = 40;
  const rowGap = 92;
  const paddingX = 32;
  const paddingY = 24;
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const primaryEdges = edges.filter((edge) => {
    const source = nodeById.get(edge.source);
    const target = nodeById.get(edge.target);
    if (!source || !target) {
      return false;
    }
    const sameTool = toolFamily(source) === toolFamily(target);
    if (sameTool) {
      return edge.kind === "sequence";
    }
    return edge.kind === "artifact";
  });
  const primaryNodeIds = new Set<string>();
  for (const edge of primaryEdges) {
    primaryNodeIds.add(edge.source);
    primaryNodeIds.add(edge.target);
  }
  const fallbackSequenceEdges = edges.filter((edge) =>
    edge.kind === "sequence"
    && (!primaryNodeIds.has(edge.source) || !primaryNodeIds.has(edge.target)),
  );
  const layoutEdges = [...primaryEdges, ...fallbackSequenceEdges];

  const layerMap = new Map<string, number>();
  for (const node of nodes) {
    layerMap.set(node.id, 0);
  }

  for (let pass = 0; pass < nodes.length; pass += 1) {
    let changed = false;
    for (const edge of layoutEdges) {
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

  const incoming = new Map<string, string[]>();
  const outgoing = new Map<string, string[]>();
  for (const node of nodes) {
    incoming.set(node.id, []);
    outgoing.set(node.id, []);
  }
  for (const edge of edges) {
    incoming.get(edge.target)?.push(edge.source);
    outgoing.get(edge.source)?.push(edge.target);
  }

  const layerEntries = [...grouped.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([layer, items]) => [layer, [...items]] as [number, RunGraphNode[]]);

  function nodeCenterForLayerRefs(ids: string[], layerIndexMap: Map<string, number>): number | null {
    const positions = ids
      .map((id) => layerIndexMap.get(id))
      .filter((value): value is number => value != null);
    if (positions.length === 0) {
      return null;
    }
    return positions.reduce((sum, value) => sum + value, 0) / positions.length;
  }

  function optimizeLayerOrdering(): void {
    for (let pass = 0; pass < 4; pass += 1) {
      for (let index = 1; index < layerEntries.length; index += 1) {
        const prevLayer = layerEntries[index - 1]?.[1] || [];
        const currentLayer = layerEntries[index]?.[1] || [];
        const prevIndexMap = new Map(prevLayer.map((node, nodeIndex) => [node.id, nodeIndex]));
        currentLayer.sort((left, right) => {
          const leftScore = nodeCenterForLayerRefs(incoming.get(left.id) || [], prevIndexMap);
          const rightScore = nodeCenterForLayerRefs(incoming.get(right.id) || [], prevIndexMap);
          if (leftScore == null && rightScore == null) {
            return left.id.localeCompare(right.id);
          }
          if (leftScore == null) {
            return 1;
          }
          if (rightScore == null) {
            return -1;
          }
          return leftScore - rightScore;
        });
      }
      for (let index = layerEntries.length - 2; index >= 0; index -= 1) {
        const nextLayer = layerEntries[index + 1]?.[1] || [];
        const currentLayer = layerEntries[index]?.[1] || [];
        const nextIndexMap = new Map(nextLayer.map((node, nodeIndex) => [node.id, nodeIndex]));
        currentLayer.sort((left, right) => {
          const leftScore = nodeCenterForLayerRefs(outgoing.get(left.id) || [], nextIndexMap);
          const rightScore = nodeCenterForLayerRefs(outgoing.get(right.id) || [], nextIndexMap);
          if (leftScore == null && rightScore == null) {
            return left.id.localeCompare(right.id);
          }
          if (leftScore == null) {
            return 1;
          }
          if (rightScore == null) {
            return -1;
          }
          return leftScore - rightScore;
        });
      }
    }
  }

  optimizeLayerOrdering();

  const positioned: PositionedGraphNode[] = [];

  const maxColumns = Math.max(...layerEntries.map(([, items]) => items.length), 1);
  const contentWidth = maxColumns * nodeWidth + Math.max(maxColumns - 1, 0) * colGap;

  for (const [layer, items] of layerEntries) {
    const layerWidth = items.length * nodeWidth + Math.max(items.length - 1, 0) * colGap;
    const startX = paddingX + (contentWidth - layerWidth) / 2;
    const y = paddingY + layer * (nodeHeight + rowGap);
    items.forEach((node, index) => {
      const x = startX + index * (nodeWidth + colGap);
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
  const width = paddingX * 2 + contentWidth;
  const height = paddingY * 2 + (maxLayer + 1) * nodeHeight + maxLayer * rowGap;

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

async function postJson<T>(input: string, body?: unknown): Promise<T> {
  const response = await fetch(input, {
    method: "POST",
    headers: {
      accept: "application/json",
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
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

async function loadWorkflowLog(runId: string, configPath: string | null): Promise<string> {
  return await fetchText(withConfigQuery(`/api/runs/${encodeURIComponent(runId)}/log`, configPath));
}

async function loadStepLog(runId: string, stepId: string, configPath: string | null): Promise<string> {
  return await fetchText(
    withConfigQuery(`/api/runs/${encodeURIComponent(runId)}/steps/${encodeURIComponent(stepId)}/log`, configPath),
  );
}

async function loadWorkflowDetail(runId: string, configPath: string | null): Promise<RunDetail> {
  return await fetchJson<RunDetail>(withConfigQuery(`/api/runs/${encodeURIComponent(runId)}`, configPath));
}

async function loadWorkflowEvents(runId: string, configPath: string | null): Promise<RunEventRecord[]> {
  const payload = await fetchJson<{ events: RunEventRecord[] }>(
    withConfigQuery(`/api/runs/${encodeURIComponent(runId)}/events`, configPath),
  );
  return Array.isArray(payload.events) ? payload.events : [];
}

async function refreshRunsIndex(
  configPath: string | null,
  setSummaries: (runs: RunSummary[]) => void,
  setTotalRuns: (total: number) => void,
  setUpdatedAt: (updatedAt: string) => void,
): Promise<void> {
  const payload = await fetchJson<RunsIndexPayload>(withConfigQuery("/api/runs", configPath));
  setSummaries(payload.runs);
  setTotalRuns(payload.totalRuns);
  setUpdatedAt(payload.updatedAt);
}

interface WorkflowViewerProps {
  initialSummaries: RunSummary[];
  initialTotalRuns: number;
  initialUpdatedAt: string;
  initialWorkspaceRoot: string;
  initialConfigPath: string | null;
  initialConfigLabel: string;
  initialAvailableConfigs: RunsIndexPayload["availableConfigs"];
  initialAvailableWorkflows: RunsIndexPayload["availableWorkflows"];
}

export function WorkflowViewer({
  initialSummaries,
  initialTotalRuns,
  initialUpdatedAt,
  initialWorkspaceRoot,
  initialConfigPath,
  initialConfigLabel,
  initialAvailableConfigs,
  initialAvailableWorkflows,
}: WorkflowViewerProps) {
  const [summaries, setSummaries] = useState<RunSummary[]>(initialSummaries);
  const [totalRuns, setTotalRuns] = useState(initialTotalRuns);
  const [updatedAt, setUpdatedAt] = useState(initialUpdatedAt);
  const [refreshLoading, setRefreshLoading] = useState(false);
  const [workspaceRoot] = useState(initialWorkspaceRoot);
  const [configPath] = useState(initialConfigPath);
  const [configLabel] = useState(initialConfigLabel);
  const [availableConfigs] = useState(initialAvailableConfigs);
  const [availableWorkflows] = useState(initialAvailableWorkflows);
  const [selectedWorkflowName, setSelectedWorkflowName] = useState<string>(
    initialAvailableWorkflows[0]?.name || "",
  );
  const [runWorkflowLoading, setRunWorkflowLoading] = useState(false);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(() =>
    normalizeSelectedRunId(initialSummaries, null),
  );
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<InspectionTab>("overview");
  const [logLoading, setLogLoading] = useState(false);
  const [logError, setLogError] = useState<string | null>(null);
  const [eventLog, setEventLog] = useState<RunEventRecord[]>([]);
  const [eventLoading, setEventLoading] = useState(false);
  const [eventError, setEventError] = useState<string | null>(null);
  const [eventFilter, setEventFilter] = useState("all");
  const [eventStepFilter, setEventStepFilter] = useState("all");
  const [eventQuery, setEventQuery] = useState("");
  const [runDetail, setRunDetail] = useState<RunDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [copiedRunId, setCopiedRunId] = useState<string | null>(null);
  const [stopLoadingRunIds, setStopLoadingRunIds] = useState<string[]>([]);
  const [removeLoadingRunIds, setRemoveLoadingRunIds] = useState<string[]>([]);
  const [resumeLoadingRunIds, setResumeLoadingRunIds] = useState<string[]>([]);
  const [rerunLoadingStepId, setRerunLoadingStepId] = useState<string | null>(null);
  const [graphViewportWidth, setGraphViewportWidth] = useState(0);
  const graphBodyRef = useRef<HTMLDivElement | null>(null);
  const tabRefs = useRef<Record<InspectionTab, HTMLButtonElement | null>>({
    overview: null,
    log: null,
    artifacts: null,
  });
  const detailRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copyResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const selectedSummary = summaries.find((summary) => summary.id === selectedRunId) || null;
  const selectedRunCopyId = selectedSummary?.id || null;
  const selectedStep = runDetail?.steps.find((step) => step.id === selectedStepId) || null;
  const overviewStepStats = useMemo(() => {
    if (!runDetail) {
      return null;
    }

    const byStatus = new Map<string, number>();
    let artifactCount = 0;
    for (const step of runDetail.steps) {
      byStatus.set(step.status, (byStatus.get(step.status) || 0) + 1);
      artifactCount += step.artifactCount || 0;
    }

    return {
      stepCount: runDetail.steps.length,
      artifactCount,
      successCount: byStatus.get("success") || 0,
      runningCount: byStatus.get("running") || 0,
      errorCount: (byStatus.get("error") || 0) + (byStatus.get("failed") || 0),
    };
  }, [runDetail]);
  const eventKinds = useMemo(() => {
    const values = new Set<string>();
    for (const entry of eventLog) {
      if (entry && typeof entry.event === "string" && entry.event) {
        values.add(entry.event);
      }
    }
    return ["all", ...[...values].sort()];
  }, [eventLog]);
  const eventStepOptions = useMemo(() => {
    const values = new Set<string>();
    for (const entry of eventLog) {
      const stepId = typeof entry.step_id === "string" && entry.step_id ? entry.step_id : "workflow";
      values.add(stepId);
    }
    return ["all", ...[...values].sort()];
  }, [eventLog]);
  const filteredEvents = useMemo(() => {
    const query = eventQuery.trim().toLowerCase();
    return eventLog.filter((entry) => {
      if (eventFilter !== "all" && entry.event !== eventFilter) {
        return false;
      }
      const stepId = typeof entry.step_id === "string" && entry.step_id ? entry.step_id : "workflow";
      if (eventStepFilter !== "all" && stepId !== eventStepFilter) {
        return false;
      }
      if (!query) {
        return true;
      }
      return JSON.stringify(entry).toLowerCase().includes(query);
    });
  }, [eventFilter, eventLog, eventQuery, eventStepFilter]);
  const renderedLogRows = useMemo<RenderedLogRow[]>(() => {
    const rows: RenderedLogRow[] = [];
    filteredEvents.forEach((entry, entryIndex) => {
      const event = entry.event || "unknown";
      const stepId = entry.step_id || null;
      const lines = flattenEventPayload(entry.data || {});
      for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
        rows.push({
          ts: entry.ts || null,
          event,
          stepId,
          text: lines[lineIndex] || "",
          key: `${entry.ts || "event"}:${event}:${stepId || "workflow"}:${entryIndex}:${lineIndex}`,
        });
      }
    });
    return rows;
  }, [filteredEvents]);
  const selectedRunActionLocked = Boolean(
    selectedSummary
    && (
      stopLoadingRunIds.includes(selectedSummary.id)
      || removeLoadingRunIds.includes(selectedSummary.id)
      || resumeLoadingRunIds.includes(selectedSummary.id)
    )
  );

  function addLoadingRunId(
    setState: React.Dispatch<React.SetStateAction<string[]>>,
    runId: string,
  ): void {
    setState((current) => (current.includes(runId) ? current : [...current, runId]));
  }

  function removeLoadingRunId(
    setState: React.Dispatch<React.SetStateAction<string[]>>,
    runId: string,
  ): void {
    setState((current) => current.filter((entry) => entry !== runId));
  }

  function isRunSelectionLocked(runId: string): boolean {
    return (
      stopLoadingRunIds.includes(runId)
      || removeLoadingRunIds.includes(runId)
      || resumeLoadingRunIds.includes(runId)
    );
  }

  function actionLabelForRun(runId: string): string | null {
    if (removeLoadingRunIds.includes(runId)) {
      return "Removing...";
    }
    if (stopLoadingRunIds.includes(runId)) {
      return "Stopping...";
    }
    if (resumeLoadingRunIds.includes(runId)) {
      return "Resuming...";
    }
    return null;
  }

  function onWorkspaceSelectChange(event: React.ChangeEvent<HTMLSelectElement>): void {
    const nextConfig = event.target.value;
    const url = new URL(window.location.href);
    if (nextConfig) {
      url.searchParams.set("config", nextConfig);
    } else {
      url.searchParams.delete("config");
    }
    window.location.assign(url.toString());
  }

  async function onCopyRunId(runId: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(runId);
      setCopiedRunId(runId);
      if (copyResetTimerRef.current) {
        clearTimeout(copyResetTimerRef.current);
      }
      copyResetTimerRef.current = setTimeout(() => {
        setCopiedRunId((current) => (current === runId ? null : current));
      }, 1500);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Failed to copy workflow id.");
    }
  }

  async function onRunWorkflow(): Promise<void> {
    if (!selectedWorkflowName) {
      return;
    }
    setActionError(null);
    setRunWorkflowLoading(true);
    try {
      const existingIds = new Set(summaries.map((summary) => summary.id));
      await postJson(withConfigQuery("/api/workflows/run", configPath), { name: selectedWorkflowName });
      for (let attempt = 0; attempt < 12; attempt += 1) {
        const payload = await fetchJson<RunsIndexPayload>(withConfigQuery("/api/runs", configPath));
        setSummaries(payload.runs);
        setTotalRuns(payload.totalRuns);
        setUpdatedAt(payload.updatedAt);
        const nextRun = payload.runs.find((summary) => !existingIds.has(summary.id) && summary.workflowName === selectedWorkflowName);
        if (nextRun) {
          setSelectedRunId(nextRun.id);
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Failed to start workflow.");
    } finally {
      setRunWorkflowLoading(false);
    }
  }

  function summariesSignature(runs: RunSummary[]): string {
    return runs.map((run) => `${run.id}:${run.status}:${run.completedAt || ""}`).join("|");
  }

  async function refreshSummariesWithPolling(): Promise<void> {
    setRefreshLoading(true);
    try {
      const beforeUpdatedAt = updatedAt;
      const beforeSignature = summariesSignature(summaries);
      for (let attempt = 0; attempt < 8; attempt += 1) {
        const payload = await fetchJson<RunsIndexPayload>(withConfigQuery("/api/runs", configPath));
        setSummaries(payload.runs);
        setTotalRuns(payload.totalRuns);
        setUpdatedAt(payload.updatedAt);
        const afterSignature = summariesSignature(payload.runs);
        if (payload.updatedAt !== beforeUpdatedAt || afterSignature !== beforeSignature || attempt === 7) {
          if (selectedRunId) {
            await refreshRunDetail(selectedRunId);
            if (activeTab === "log") {
              await refreshActiveLog(selectedRunId, selectedStepId);
            }
          }
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
    } finally {
      setRefreshLoading(false);
    }
  }

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

  async function refreshActiveLog(runId: string, options: { background?: boolean } = {}): Promise<void> {
    const background = Boolean(options.background);
    if (!background) {
      setLogLoading(true);
      setEventLog([]);
    }
    setLogError(null);
    try {
      const nextEvents = await loadWorkflowEvents(runId, configPath);
      setEventLog(nextEvents);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setEventLog([]);
      setLogError(/^404\b/.test(message) ? null : message);
    } finally {
      if (!background) {
        setLogLoading(false);
      }
    }
  }

  async function refreshRunDetail(runId: string): Promise<void> {
    setDetailLoading(true);
    try {
      const detail = await loadWorkflowDetail(runId, configPath);
      setRunDetail(detail);
    } catch {
      setRunDetail(null);
    } finally {
      setDetailLoading(false);
    }
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
    setEventFilter("all");
    setEventStepFilter("all");
    setEventQuery("");
  }, [selectedRunId]);

  useEffect(() => {
    if (!selectedRunId) {
      setLogError(null);
      setLogLoading(false);
      setEventLog([]);
      setEventError(null);
      setEventLoading(false);
      setRunDetail(null);
      setDetailLoading(false);
      return;
    }
    let cancelled = false;
    setLogError(null);
    setEventLog([]);
    setEventError(null);
    setRunDetail(null);
    setLogLoading(activeTab === "log");
    setEventLoading(false);
    setDetailLoading(true);
    void loadWorkflowDetail(selectedRunId, configPath)
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
      void refreshActiveLog(selectedRunId);
    }
    return () => {
      cancelled = true;
    };
  }, [selectedRunId]);

  useEffect(() => {
    if (!selectedRunId) {
      setLogError(null);
      setLogLoading(false);
      setEventLog([]);
      setEventError(null);
      setEventLoading(false);
      return;
    }
    if (activeTab !== "log") {
      setLogError(null);
      setLogLoading(false);
    }
    if (activeTab === "log") {
      void refreshActiveLog(selectedRunId);
    }
  }, [activeTab, selectedRunId]);

  useEffect(() => {
    if (!runDetail || !selectedStepId) {
      return;
    }
    if (runDetail.steps.some((step) => step.id === selectedStepId)) {
      return;
    }
    setSelectedStepId(null);
    setEventStepFilter("all");
    setActiveTab("overview");
  }, [runDetail, selectedStepId]);

  async function refreshSummaries(): Promise<void> {
    await refreshRunsIndex(configPath, setSummaries, setTotalRuns, setUpdatedAt);
    if (!selectedRunId) {
      return;
    }
    await refreshRunDetail(selectedRunId);
    if (activeTab === "log") {
      await refreshActiveLog(selectedRunId);
    }
  }

  async function onStopWorkflow(runId: string): Promise<void> {
    setActionError(null);
    addLoadingRunId(setStopLoadingRunIds, runId);
    try {
      await postJson(withConfigQuery(`/api/runs/${encodeURIComponent(runId)}/stop`, configPath));
      await refreshRunsIndex(configPath, setSummaries, setTotalRuns, setUpdatedAt);
      await refreshRunDetail(runId);
      if (activeTab === "log") {
        await refreshActiveLog(runId);
      }
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Failed to stop workflow.");
    } finally {
      removeLoadingRunId(setStopLoadingRunIds, runId);
    }
  }

  async function onRemoveWorkflow(runId: string): Promise<void> {
    const summary = summaries.find((entry) => entry.id === runId) || null;
    const label = summary?.workflowName || runId;
    if (!window.confirm(`Remove workflow ${label}?`)) {
      return;
    }
    setActionError(null);
    addLoadingRunId(setRemoveLoadingRunIds, runId);
    try {
      await postJson(withConfigQuery(`/api/runs/${encodeURIComponent(runId)}/remove`, configPath));
      const nextSelectedRunId =
        selectedRunId === runId
          ? nextSelectedRunIdAfterRemoval(summaries, runId)
          : selectedRunId;
      setSelectedRunId(nextSelectedRunId);
      setSelectedStepId(null);
      await refreshRunsIndex(configPath, setSummaries, setTotalRuns, setUpdatedAt);
      if (!nextSelectedRunId) {
        setLogText("");
        setLogError(null);
        setRunDetail(null);
      }
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Failed to remove workflow.");
    } finally {
      removeLoadingRunId(setRemoveLoadingRunIds, runId);
    }
  }

  async function onResumeWorkflow(runId: string, fromStep: string | null): Promise<void> {
    setActionError(null);
    addLoadingRunId(setResumeLoadingRunIds, runId);
    setRerunLoadingStepId(fromStep);
    try {
      setSummaries((current) => current.map((summary) => (
        summary.id === runId
          ? { ...summary, status: "running", completedAt: null }
          : summary
      )));
      setRunDetail((current) => applyOptimisticWorkflowRunState(current, runId, fromStep));
      const query = fromStep ? `?fromStep=${encodeURIComponent(fromStep)}` : "";
      await postJson(withConfigQuery(`/api/runs/${encodeURIComponent(runId)}/resume${query}`, configPath));
      await refreshRunsIndex(configPath, setSummaries, setTotalRuns, setUpdatedAt);
      await refreshRunDetail(runId);
      if (activeTab === "log") {
        await refreshActiveLog(runId);
      }
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Failed to resume workflow.");
    } finally {
      removeLoadingRunId(setResumeLoadingRunIds, runId);
      setRerunLoadingStepId(null);
    }
  }

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
  const graphSequenceEdges = useMemo(
    () => graphEdges.filter((edge) => edge.kind === "sequence"),
    [graphEdges],
  );
  const graphArtifactEdges = useMemo(
    () => graphEdges.filter((edge) => edge.kind === "artifact"),
    [graphEdges],
  );
  const graphLayout = useMemo(
    () => buildGraphLayout(graphNodes, graphEdges, graphViewportWidth),
    [graphEdges, graphNodes, graphViewportWidth],
  );

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
    const events = new EventSource(withConfigQuery("/api/events", configPath));
    events.addEventListener("runs-changed", () => {
      void refreshRunsIndex(configPath, setSummaries, setTotalRuns, setUpdatedAt);
        if (selectedRunId) {
          scheduleDetailRefresh(selectedRunId, 250);
          if (activeTab === "log") {
            void refreshActiveLog(selectedRunId, { background: true });
          }
        }
      });
    return () => {
      events.close();
      if (detailRefreshTimerRef.current) {
        clearTimeout(detailRefreshTimerRef.current);
        detailRefreshTimerRef.current = null;
      }
      if (copyResetTimerRef.current) {
        clearTimeout(copyResetTimerRef.current);
        copyResetTimerRef.current = null;
      }
    };
  }, [activeTab, configPath, selectedRunId, selectedStepId]);

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
            <label className="workflow-topbar-chip" title={workspaceRoot}>
              <span className="workflow-topbar-label">Workspace</span>
              <select
                aria-label="Select workspace config"
                className="workflow-topbar-select"
                onChange={onWorkspaceSelectChange}
                value={configPath || ""}
              >
                {availableConfigs.map((option) => (
                  <option key={option.id} value={option.configPath || ""}>
                    {option.label} · {formatPathLabel(option.workspaceRoot)}
                  </option>
                ))}
              </select>
            </label>
            <div className="workflow-topbar-chip" title={workspaceRoot}>
              <span className="workflow-topbar-label">Active</span>
              <span>{formatPathLabel(workspaceRoot)}</span>
            </div>
            {configPath ? (
              <div className="workflow-topbar-chip" title={configPath}>
                <span className="workflow-topbar-label">Config</span>
                <span>{configLabel}</span>
              </div>
            ) : null}
            {availableWorkflows.length > 0 ? (
              <label className="workflow-topbar-chip">
                <span className="workflow-topbar-label">Workflow</span>
                <select
                  aria-label="Select workflow"
                  className="workflow-topbar-select"
                  onChange={(event) => setSelectedWorkflowName(event.target.value)}
                  value={selectedWorkflowName}
                >
                  {availableWorkflows.map((workflow) => (
                    <option key={workflow.name} value={workflow.name}>
                      {workflow.name} · {workflow.category}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <div className="workflow-topbar-chip">
              <span className="workflow-topbar-label">Updated</span>
              <span>{updatedAt ? formatTimestamp(updatedAt) : "-"}</span>
            </div>
            {availableWorkflows.length > 0 ? (
              <Button
                disabled={runWorkflowLoading || !selectedWorkflowName}
                onClick={() => void onRunWorkflow()}
                variant="outline"
              >
                {runWorkflowLoading ? "Running..." : "Run"}
              </Button>
            ) : null}
            <Button onClick={() => void refreshSummariesWithPolling()} variant="outline">
              {refreshLoading ? "Refreshing..." : "Refresh"}
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
                    const selectionLocked = isRunSelectionLocked(summary.id);
                    const actionLabel = actionLabelForRun(summary.id);
                    return (
                      <button
                        className={`workflow-list-item${isSelected ? " is-selected" : ""}`}
                        disabled={selectionLocked}
                        key={summary.id}
                        onClick={() => setSelectedRunId(summary.id)}
                        title={selectionLocked ? `${summary.workflowName || summary.id} is busy` : undefined}
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
                        <div className="workflow-list-item-subtle">
                          {actionLabel || formatTimestamp(summary.createdAt)}
                        </div>
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
                  {selectedRunCopyId ? (
                    <div className="workflow-pane-meta">
                      <code title={selectedRunCopyId}>{selectedRunCopyId}</code>
                      <Button
                        aria-label={copiedRunId === selectedRunCopyId ? "Copied workflow id" : "Copy workflow id"}
                        onClick={() => void onCopyRunId(selectedRunCopyId)}
                        size="icon"
                        title={copiedRunId === selectedRunCopyId ? "Copied" : "Copy workflow id"}
                        variant="ghost"
                      >
                        {copiedRunId === selectedRunCopyId ? <Check size={14} /> : <Copy size={14} />}
                      </Button>
                    </div>
                  ) : null}
                </div>
                <div className="workflow-pane-actions">
                  {selectedStep ? (
                    <Button
                      onClick={() => {
                        setSelectedStepId(null);
                        setEventFilter("all");
                        setEventStepFilter("all");
                        setEventQuery("");
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
                      disabled={selectedRunActionLocked}
                      onClick={() => void onResumeWorkflow(selectedSummary.id, selectedStep.id)}
                      size="sm"
                      variant="outline"
                    >
                      {rerunLoadingStepId === selectedStep.id ? "Rerunning..." : "Rerun From Step"}
                    </Button>
                  ) : null}
                  {selectedSummary?.format === "workflow-first" && selectedSummary.status === "running" ? (
                    <Button
                      disabled={selectedRunActionLocked}
                      onClick={() => void onStopWorkflow(selectedSummary.id)}
                      size="sm"
                      variant="outline"
                    >
                      {stopLoadingRunIds.includes(selectedSummary.id) ? "Stopping..." : "Stop"}
                    </Button>
                  ) : null}
                  {selectedSummary?.format === "workflow-first" && selectedSummary.status !== "running" ? (
                    <Button
                      disabled={selectedRunActionLocked}
                      onClick={() => void onResumeWorkflow(selectedSummary.id, null)}
                      size="sm"
                      variant="outline"
                    >
                      {resumeLoadingRunIds.includes(selectedSummary.id) && rerunLoadingStepId == null ? "Resuming..." : "Resume"}
                    </Button>
                  ) : null}
                  {selectedSummary ? (
                    <Button
                      disabled={selectedRunActionLocked}
                      onClick={() => void onRemoveWorkflow(selectedSummary.id)}
                      size="sm"
                      variant="outline"
                    >
                      {removeLoadingRunIds.includes(selectedSummary.id) ? "Removing..." : "Remove"}
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
                  <div
                    className="workflow-graph-scroll"
                    onClick={() => {
                      setSelectedStepId(null);
                      setEventFilter("all");
                      setEventStepFilter("all");
                      setEventQuery("");
                      setActiveTab("log");
                    }}
                  >
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
                            <path d="M0,0 L8,4 L0,8 z" fill="#9a8d7a" />
                          </marker>
                          <marker
                            id="workflow-arrow-artifact"
                            markerHeight="8"
                            markerWidth="8"
                            orient="auto-start-reverse"
                            refX="7"
                            refY="4"
                          >
                            <path d="M0,0 L8,4 L0,8 z" fill="#0f766e" />
                          </marker>
                        </defs>
                        {[...graphSequenceEdges, ...graphArtifactEdges].map((edge) => {
                          const source = graphLayout.nodeMap.get(edge.source);
                          const target = graphLayout.nodeMap.get(edge.target);
                          if (!source || !target) {
                            return null;
                          }
                          const label = formatGraphEdge(edge);
                          const labelPosition = edgeLabelPosition(source, target);
                          return (
                            <g key={edge.id}>
                              <path
                                className={`workflow-graph-path is-${edge.kind}${edge.inferred ? " is-inferred" : ""}`}
                                d={edgePath(source, target)}
                                markerEnd={`url(#workflow-arrow-${edge.kind})`}
                              />
                              {label ? (
                                <text
                                  className={`workflow-graph-path-label is-${edge.kind}`}
                                  textAnchor="middle"
                                  x={labelPosition.x}
                                  y={labelPosition.y}
                                >
                                  {label}
                                </text>
                              ) : null}
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
                            onClick={(event) => {
                              event.stopPropagation();
                              setSelectedStepId(node.id);
                              setEventStepFilter(node.id);
                              setActiveTab("log");
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
                              {Array.isArray(node.parameters) && node.parameters.length > 0 ? (
                                <span className="workflow-graph-node-param">{node.parameters.join(" · ")}</span>
                              ) : null}
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
              {activeTab === "log" ? (
                <div className="workflow-events-toolbar">
                  <select
                    aria-label="Filter event type"
                    className="workflow-events-select"
                    onChange={(event) => setEventFilter(event.currentTarget.value)}
                    value={eventFilter}
                  >
                    {eventKinds.map((kind) => (
                      <option key={kind} value={kind}>
                        {kind}
                      </option>
                    ))}
                  </select>
                  <select
                    aria-label="Filter step"
                    className="workflow-events-select"
                    onChange={(event) => setEventStepFilter(event.currentTarget.value)}
                    value={eventStepFilter}
                  >
                    {eventStepOptions.map((stepId) => (
                      <option key={stepId} value={stepId}>
                        {stepId}
                      </option>
                    ))}
                  </select>
                  <input
                    aria-label="Search events"
                    className="workflow-events-search"
                    onChange={(event) => setEventQuery(event.currentTarget.value)}
                    placeholder="Search event payload"
                    type="search"
                    value={eventQuery}
                  />
                </div>
              ) : null}
            </div>
            <div
              aria-labelledby={`inspection-tab-${activeTab}`}
              className="workflow-bottom-body"
              id="inspection-panel"
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
                    <div className="workflow-overview-card is-table">
                      <table className="workflow-overview-table">
                        <tbody>
                          <tr>
                            <th>Workflow</th>
                            <th>ID</th>
                            <th>Status</th>
                            <th>Category</th>
                            <th>Format</th>
                            <th>Scope</th>
                            <th>Steps</th>
                            <th>Artifacts</th>
                            <th>Created</th>
                            <th>Completed</th>
                          </tr>
                          <tr>
                            <td>{selectedSummary?.workflowName || selectedSummary?.id || "-"}</td>
                            <td><code title={selectedSummary?.id || undefined}>{selectedSummary?.id || "-"}</code></td>
                            <td>
                              <span className={`workflow-status-text is-${selectedStep?.status || selectedSummary?.status || "unknown"}`}>
                                {selectedStep?.status || selectedSummary?.status || "unknown"}
                              </span>
                            </td>
                            <td>{selectedSummary?.category || "-"}</td>
                            <td>{selectedSummary?.format || "-"}</td>
                            <td>{selectedStep ? stepDisplayName(selectedStep) : "Workflow"}</td>
                            <td>{overviewStepStats?.stepCount ?? "-"}</td>
                            <td>{overviewStepStats?.artifactCount ?? "-"}</td>
                            <td>{formatTimestamp(selectedSummary?.createdAt)}</td>
                            <td>{formatTimestamp(selectedSummary?.completedAt)}</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                    <div className="workflow-overview-card is-wide">
                      <span className="workflow-overview-label">Run directory</span>
                      <code>{runDetail.runDir || "-"}</code>
                    </div>
                  </div>
                )
              ) : activeTab === "log" ? (
                eventLog.length === 0 && logLoading ? (
                  <div className="workflow-empty-state">Loading log…</div>
                ) : (
                  <>
                    {logError ? <p className="mb-4 text-sm text-destructive">{logError}</p> : null}
                    {renderedLogRows.length === 0 ? (
                      <div className="workflow-empty-state">No log events available.</div>
                    ) : (
                      <div className="workflow-events-list">
                        {renderedLogRows.map((row) => (
                          <div
                            className="workflow-event-row"
                            key={row.key}
                          >
                            <div className="workflow-event-meta">
                              <span>{row.ts || "-"}</span>
                              <strong>{row.event}</strong>
                              <span>{row.stepId || "workflow"}</span>
                            </div>
                            <code>{row.text}</code>
                          </div>
                        ))}
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
