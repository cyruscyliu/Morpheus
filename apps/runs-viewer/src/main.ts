import type { RunDetail, RunSummary, RunsIndexPayload } from "./types.js";

type StatusFilter = "" | "success" | "failure" | "error" | "running" | "unknown";

interface ViewState {
  selectedRunId: string | null;
  selectedStepId: string | null;
  summaries: RunSummary[];
  totalRuns: number;
  runsLimit: number;
  runsOffset: number;
  runDetail: RunDetail | null;
  runRoot: string;
  updatedAt: string;
  statusFilter: StatusFilter;
  logText: string | null;
  logLoading: boolean;
  logError: string | null;
  logWrap: boolean;
  logBeautify: boolean;
  logJsonl: boolean;
  stopLoading: boolean;
  stopError: string | null;
  removeLoadingRunId: string | null;
  removeError: string | null;
}

function requiredElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) {
    throw new Error(`Expected element ${selector}`);
  }
  return element;
}

function optionalElement<T extends Element>(selector: string): T | null {
  return document.querySelector<T>(selector);
}

type PaneRatios = [number, number];

const PANE_RESIZER_PX = 12;
const PANE_GAP_PX = 12;
const PANE_MIN_PX = 260;
const RUNS_PANE_COLLAPSED_WIDTH_PX = 56;
const PANE_RATIOS_STORAGE_KEY = "morpheus:runs-viewer:paneRatios:v2";
const RUNS_PANE_COLLAPSED_STORAGE_KEY = "morpheus:runs-viewer:runsPaneCollapsed:v1";
const NARROW_MEDIA_QUERY = "(max-width: 980px)";

function statusClass(status: string): string {
  const value = status || "unknown";
  return `status-${value}`;
}

function categoryClass(category: string): string {
  const value = category || "unknown";
  return `category-${value}`;
}

function workflowCategoryLabel(category: string): string {
  if (category === "build" || category === "run") {
    return category;
  }
  return "unknown";
}

function renderWorkflowCategoryBadge(category: string): string {
  const label = workflowCategoryLabel(category);
  if (label === "unknown") {
    return "";
  }
  return `<span class="category-pill ${categoryClass(label)}">${escapeHtml(label)}</span>`;
}

function renderWorkflowStatusIndicator(status: string): string {
  const normalized = status || "unknown";
  return [
    `<span class="workflow-status-indicator ${statusClass(normalized)}"`,
    ` title="${escapeHtml(normalized)}"`,
    ` aria-label="${escapeHtml(normalized)} status"></span>`,
  ].join("");
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function unescapeLogEscapes(value: string): string {
  // Best-effort readability for logs that embed JSON-escaped strings.
  // Keep this intentionally small and predictable: only handle a few common
  // sequences, and leave everything else unchanged.
  let output = "";
  for (let index = 0; index < value.length; index += 1) {
    const ch = value[index];
    if (ch !== "\\") {
      output += ch;
      continue;
    }
    const next = value[index + 1];
    if (next === undefined) {
      output += ch;
      continue;
    }
    if (next === "n") {
      output += "\n";
      index += 1;
      continue;
    }
    if (next === "r") {
      output += "\r";
      index += 1;
      continue;
    }
    if (next === "t") {
      output += "\t";
      index += 1;
      continue;
    }
    if (next === "\"") {
      output += "\"";
      index += 1;
      continue;
    }
    if (next === "\\") {
      output += "\\";
      index += 1;
      continue;
    }
    output += ch;
  }
  return output;
}

interface StructuredPayload {
  prefix: string;
  value: unknown;
}

function tryParseJson(value: string): unknown | null {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function extractStructuredPayload(line: string): StructuredPayload | null {
  const trimmed = line.trim();
  if (!trimmed) {
    return null;
  }

  const full = tryParseJson(trimmed);
  if (full !== null) {
    return { prefix: "", value: full };
  }

  const argvIndex = trimmed.indexOf("argv=");
  if (argvIndex !== -1) {
    const after = trimmed.slice(argvIndex + "argv=".length).trim();
    if (after.startsWith("[") && after.endsWith("]")) {
      const parsed = tryParseJson(after);
      if (parsed !== null) {
        return { prefix: trimmed.slice(0, argvIndex).trim(), value: parsed };
      }
    }
  }

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    const candidate = trimmed.slice(firstBrace, lastBrace + 1);
    const parsed = tryParseJson(candidate);
    if (parsed !== null) {
      return { prefix: trimmed.slice(0, firstBrace).trim(), value: parsed };
    }
  }

  return null;
}

function jsonlSummary(value: unknown): string | null {
  if (!isPlainObject(value)) {
    return null;
  }
  const summary = typeof value.summary === "string" ? value.summary : null;
  const message = typeof value.message === "string" ? value.message : null;
  const event = typeof value.event === "string" ? value.event : null;
  return summary || message || event;
}

function jsonlStatus(value: unknown): string | null {
  if (!isPlainObject(value)) {
    return null;
  }
  const status = typeof value.status === "string" ? value.status : null;
  return status && status.trim() ? status : null;
}

function jsonlBadges(value: unknown): Array<{ label: string; cls: string }> {
  if (!isPlainObject(value)) {
    if (Array.isArray(value)) {
      return [{ label: `argv ${value.length}`, cls: "jsonl-badge argv" }];
    }
    return [];
  }

  const badges: Array<{ label: string; cls: string }> = [];
  const command = typeof value.command === "string" ? value.command : null;
  const status = typeof value.status === "string" ? value.status : null;
  const exitCode = typeof value.exit_code === "number" ? value.exit_code : null;

  if (command) {
    badges.push({ label: command, cls: "jsonl-badge command" });
  }
  if (status) {
    badges.push({ label: status, cls: "jsonl-badge status" });
  }
  if (exitCode != null) {
    badges.push({ label: `exit ${exitCode}`, cls: "jsonl-badge exit" });
  }
  return badges;
}

function jsonToHtml(value: unknown): string {
  const text = JSON.stringify(value, null, 2);
  const escaped = escapeHtml(text);
  const withStrings = escaped.replace(
    /&quot;([^&\n]*?)&quot;/g,
    `<span class="tok-json-str">&quot;$1&quot;</span>`,
  );
  const withKeys = withStrings.replace(
    /<span class="tok-json-str">(&quot;[^&\n]*?&quot;)<\/span>(?=:\s)/g,
    `<span class="tok-json-key">$1</span>`,
  );
  return withKeys
    .replace(/\b-?\d+(?:\.\d+)?\b/g, `<span class="tok-json-num">$&</span>`)
    .replace(/\btrue\b|\bfalse\b/g, `<span class="tok-json-bool">$&</span>`)
    .replace(/\bnull\b/g, `<span class="tok-json-null">null</span>`);
}

function renderJsonlLine(payload: StructuredPayload, beautify: boolean): string {
  const { prefix, value } = payload;
  const status = jsonlStatus(value);
  const statusCls = status ? ` jsonl-status-${escapeHtml(status)}` : "";
  const summary = jsonlSummary(value);
  const badges = jsonlBadges(value);

  let summaryText = summary ? summary : "";
  if (!summaryText) {
    summaryText = "JSON";
  }
  if (prefix) {
    summaryText = summaryText ? `${prefix} · ${summaryText}` : prefix;
  }
  if (beautify) {
    summaryText = unescapeLogEscapes(summaryText);
  }
  if (summaryText.length > 180) {
    summaryText = `${summaryText.slice(0, 177)}…`;
  }

  const badgesHtml = badges.length
    ? `<span class="jsonl-badges">${badges
        .slice(0, 3)
        .map((badge) => `<span class="${badge.cls}">${escapeHtml(badge.label)}</span>`)
        .join("")}</span>`
    : "";

  return [
    `<details class="jsonl-line${statusCls}">`,
    `<summary><span class="jsonl-summary">${escapeHtml(summaryText)}</span>${badgesHtml}</summary>`,
    `<pre class="jsonl-pre">${jsonToHtml(value)}</pre>`,
    `</details>`,
  ].join("");
}

function isFailureLikePayload(value: unknown): boolean {
  const status = jsonlStatus(value);
  if (!status) {
    return false;
  }
  const lowered = status.toLowerCase();
  return lowered === "error" || lowered === "failure" || lowered === "failed";
}

function shouldHideStructuredPayload(payload: StructuredPayload): boolean {
  const { prefix, value } = payload;
  if (Array.isArray(value)) {
    return true;
  }
  if (prefix.includes("argv=")) {
    return true;
  }
  if (isFailureLikePayload(value)) {
    return false;
  }
  return false;
}

function defaultPaneRatios(): PaneRatios {
  const raw: PaneRatios = [1, 1];
  return normalizePaneRatios(raw);
}

function normalizePaneRatios(ratios: PaneRatios): PaneRatios {
  const sanitized = ratios.map((value) => (Number.isFinite(value) && value > 0 ? value : 0));
  const sum = sanitized[0] + sanitized[1];
  if (!sum) {
    return [1 / 2, 1 / 2];
  }
  return [sanitized[0] / sum, sanitized[1] / sum];
}

function loadPaneRatios(): PaneRatios {
  try {
    const raw = localStorage.getItem(PANE_RATIOS_STORAGE_KEY);
    if (!raw) {
      return defaultPaneRatios();
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed) || parsed.length !== 2) {
      return defaultPaneRatios();
    }
    return normalizePaneRatios([Number(parsed[0]), Number(parsed[1])]);
  } catch {
    return defaultPaneRatios();
  }
}

function savePaneRatios(ratios: PaneRatios): void {
  try {
    localStorage.setItem(PANE_RATIOS_STORAGE_KEY, JSON.stringify(ratios));
  } catch {
    // ignore
  }
}

function loadRunsPaneCollapsed(): boolean {
  try {
    return localStorage.getItem(RUNS_PANE_COLLAPSED_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function saveRunsPaneCollapsed(collapsed: boolean): void {
  try {
    localStorage.setItem(RUNS_PANE_COLLAPSED_STORAGE_KEY, collapsed ? "1" : "0");
  } catch {
    // ignore
  }
}

function isNarrowViewport(): boolean {
  try {
    return window.matchMedia(NARROW_MEDIA_QUERY).matches;
  } catch {
    return false;
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function availablePaneWidthPx(workspace: HTMLElement): number {
  const listPane = optionalElement<HTMLElement>(".list-pane");
  const measuredRunsWidth = listPane ? Math.round(listPane.getBoundingClientRect().width) : 0;
  const fallbackWidth = workspace.classList.contains("runs-pane-collapsed")
    ? RUNS_PANE_COLLAPSED_WIDTH_PX
    : 420;
  const runsWidth = measuredRunsWidth > 0 ? measuredRunsWidth : fallbackWidth;
  return Math.max(0, workspace.clientWidth - runsWidth - PANE_GAP_PX - PANE_RESIZER_PX);
}

function applyPaneRatios(workspace: HTMLElement, ratios: PaneRatios): void {
  if (isNarrowViewport()) {
    workspace.style.gridTemplateColumns = "";
    return;
  }
  if (workspace.classList.contains("runs-pane-collapsed")) {
    const [currentDetailWidth] = currentPaneWidthsPx(workspace);
    const available = workspace.clientWidth - RUNS_PANE_COLLAPSED_WIDTH_PX - PANE_GAP_PX - PANE_RESIZER_PX;
    if (available <= 0) {
      return;
    }
    const effectiveMin = available < 2 * PANE_MIN_PX ? Math.floor(available / 2) : PANE_MIN_PX;
    const preferredDetailWidth = currentDetailWidth > 0 ? currentDetailWidth : Math.round(normalizePaneRatios(ratios)[0] * available);
    const wDetail = clamp(Math.round(preferredDetailWidth), effectiveMin, available - effectiveMin);
    const wLog = Math.max(effectiveMin, available - wDetail);
    workspace.style.gridTemplateColumns = `${RUNS_PANE_COLLAPSED_WIDTH_PX}px ${PANE_GAP_PX}px ${wDetail}px ${PANE_RESIZER_PX}px ${wLog}px`;
    return;
  }
  const available = availablePaneWidthPx(workspace);
  if (!available) {
    return;
  }

  const normalized = normalizePaneRatios(ratios);
  const minTotal = 2 * PANE_MIN_PX;
  const effectiveMin = available < minTotal ? Math.floor(available / 2) : PANE_MIN_PX;

  let wDetail = Math.round(normalized[0] * available);
  let wLog = available - wDetail;

  wDetail = clamp(wDetail, effectiveMin, available - effectiveMin);
  wLog = Math.max(effectiveMin, available - wDetail);

  const sum = wDetail + wLog;
  if (sum !== available) {
    wLog = Math.max(effectiveMin, wLog + (available - sum));
  }

  workspace.style.gridTemplateColumns = `var(--runs-pane-width) ${PANE_GAP_PX}px ${wDetail}px ${PANE_RESIZER_PX}px ${wLog}px`;
}

function currentPaneWidthsPx(workspace: HTMLElement): [number, number] {
  const detailPane = requiredElement<HTMLElement>(".detail-pane");
  const logPane = requiredElement<HTMLElement>(".log-pane");
  return [
    detailPane.getBoundingClientRect().width,
    logPane.getBoundingClientRect().width,
  ];
}

function adjustedPair(sum: number, a: number, delta: number, min: number): [number, number] {
  const effectiveMin = Math.min(min, Math.floor(sum / 2));
  const nextA = clamp(a + delta, effectiveMin, sum - effectiveMin);
  return [nextA, sum - nextA];
}

function installPaneResizers(): void {
  const workspace = requiredElement<HTMLElement>(".workspace-main");
  const rightResizer = optionalElement<HTMLElement>("[data-resizer=\"right\"]");
  const toggleRunsPane = optionalElement<HTMLButtonElement>("#toggle-runs-pane");
  if (!rightResizer) {
    return;
  }

  let ratios = loadPaneRatios();
  let runsPaneCollapsed = loadRunsPaneCollapsed();
  const syncRunsPane = () => {
    const collapsed = runsPaneCollapsed && !isNarrowViewport();
    workspace.classList.toggle("runs-pane-collapsed", collapsed);
    if (toggleRunsPane) {
      toggleRunsPane.textContent = runsPaneCollapsed ? ">>" : "<<";
      toggleRunsPane.setAttribute("aria-expanded", runsPaneCollapsed ? "false" : "true");
      toggleRunsPane.setAttribute(
        "aria-label",
        runsPaneCollapsed ? "Expand workflows pane" : "Collapse workflows pane",
      );
    }
    applyPaneRatios(workspace, ratios);
  };

  const toggleCollapsedState = () => {
    runsPaneCollapsed = !runsPaneCollapsed;
    saveRunsPaneCollapsed(runsPaneCollapsed);
    syncRunsPane();
  };

  toggleRunsPane?.addEventListener("click", toggleCollapsedState);

  applyPaneRatios(workspace, ratios);
  syncRunsPane();

  const handleResize = () => syncRunsPane();
  window.addEventListener("resize", handleResize, { passive: true });

  const startDrag = (resizer: HTMLElement, event: PointerEvent) => {
    if (event.button !== 0) {
      return;
    }
    if (isNarrowViewport()) {
      return;
    }

    const startX = event.clientX;
    const [startWDetail, startWLog] = currentPaneWidthsPx(workspace);
    resizer.classList.add("dragging");
    resizer.setPointerCapture(event.pointerId);

    const onMove = (moveEvent: PointerEvent) => {
      const dx = moveEvent.clientX - startX;
      const sum = startWDetail + startWLog;
      const [wDetail, wLog] = adjustedPair(sum, startWDetail, dx, PANE_MIN_PX);

      const total = wDetail + wLog;
      if (total > 0) {
        ratios = normalizePaneRatios([wDetail / total, wLog / total]);
        savePaneRatios(ratios);
        applyPaneRatios(workspace, ratios);
      }
    };

    const stop = () => {
      resizer.classList.remove("dragging");
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", stop, { once: true });
    window.addEventListener("pointercancel", stop, { once: true });
  };

  rightResizer.addEventListener("pointerdown", (event) => startDrag(rightResizer, event));

  const reset = () => {
    ratios = defaultPaneRatios();
    savePaneRatios(ratios);
    applyPaneRatios(workspace, ratios);
  };

  rightResizer.addEventListener("dblclick", reset);

  const onKey = (resizer: HTMLElement, event: KeyboardEvent) => {
    if (isNarrowViewport()) {
      return;
    }
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
      return;
    }
    event.preventDefault();

    const [startWDetail, startWLog] = currentPaneWidthsPx(workspace);
    const step = event.key === "ArrowLeft" ? -24 : 24;

    const sum = startWDetail + startWLog;
    const [wDetail, wLog] = adjustedPair(sum, startWDetail, step, PANE_MIN_PX);

    const total = wDetail + wLog;
    ratios = normalizePaneRatios([wDetail / total, wLog / total]);
    savePaneRatios(ratios);
    applyPaneRatios(workspace, ratios);
  };

  rightResizer.addEventListener("keydown", (event) => onKey(rightResizer, event));

  try {
    const media = window.matchMedia(NARROW_MEDIA_QUERY);
    const onMediaChange = () => {
      if (media.matches) {
        workspace.style.gridTemplateColumns = "";
      } else {
        applyPaneRatios(workspace, ratios);
      }
    };
    if ("addEventListener" in media) {
      media.addEventListener("change", onMediaChange);
    }
  } catch {
    // ignore
  }
}

function highlightLogLine(rawLine: string): string {
  const escaped = escapeHtml(rawLine);
  const patterns: Array<{ re: RegExp; cls: string }> = [
    { re: /\bTraceback\b/g, cls: "tok-error" },
    { re: /\bAssertionError\b/g, cls: "tok-error" },
    { re: /\bError\b/g, cls: "tok-error" },
    { re: /\bERROR\b/g, cls: "tok-error" },
    { re: /\bwarning\b/gi, cls: "tok-warn" },
    { re: /^\s*#/g, cls: "tok-dim" },
  ];

  let value = escaped;
  for (const { re, cls } of patterns) {
    value = value.replace(re, (match) => `<span class="${cls}">${match}</span>`);
  }
  return value;
}

function renderLogHtml(
  logText: string,
  wrap: boolean,
  beautify: boolean,
  jsonl: boolean,
): string {
  const maxLines = 5000;
  const lines = logText.replace(/\r\n/g, "\n").split("\n");
  const truncated = lines.length > maxLines;
  const start = truncated ? lines.length - maxLines : 0;
  const slice = truncated ? lines.slice(start) : [...lines];

  while (slice.length > 0 && slice[slice.length - 1] === "") {
    slice.pop();
  }
  if (slice.length > 1 && slice[0] === "") {
    slice.shift();
  }
  const note = truncated
    ? `<p class="log-note">Showing last ${maxLines} lines of ${lines.length}.</p>`
    : "";

  const items = slice
    .map((line, index) => {
      const lineNumber = start + index + 1;
      const payload = jsonl ? extractStructuredPayload(line) : null;
      if (payload !== null) {
        if (shouldHideStructuredPayload(payload)) {
          return "";
        }
        return `<li class="log-line"><span class="log-ln">${lineNumber}</span><span class="log-lc">${renderJsonlLine(
          payload,
          beautify,
        )}</span></li>`;
      }
      const displayLine = beautify ? unescapeLogEscapes(line) : line;
      return `<li class="log-line"><span class="log-ln">${lineNumber}</span><span class="log-lc">${highlightLogLine(
        displayLine,
      )}</span></li>`;
    })
    .join("");

  const className = wrap ? "log-viewer wrap" : "log-viewer";
  return `${note}<div class="${className}"><ul class="log-lines">${items}</ul></div>`;
}

function formatText(value: string | null | undefined): string {
  return value && value.trim() ? value : "-";
}

let timestampFormatter: Intl.DateTimeFormat | null = null;
try {
  timestampFormatter = new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "medium",
    timeZoneName: "short",
  });
} catch {
  timestampFormatter = null;
}

function formatTimestamp(value: string | null | undefined): string {
  if (!value || !value.trim()) {
    return "-";
  }

  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return value;
  }

  const date = new Date(parsed);
  try {
    if (timestampFormatter) {
      return timestampFormatter.format(date);
    }
  } catch {
    // ignore
  }

  try {
    return date.toLocaleString();
  } catch {
    return value;
  }
}

async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(path, { headers: { accept: "application/json" } });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
  return (await response.json()) as T;
}

async function fetchText(path: string): Promise<string> {
  const response = await fetch(path, { headers: { accept: "text/plain" } });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
  return await response.text();
}

async function postJson<T>(path: string): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    headers: { accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error((await response.text()) || `${response.status} ${response.statusText}`);
  }
  return (await response.json()) as T;
}

function matchesFilter(summary: RunSummary, state: ViewState): boolean {
  if (state.statusFilter && summary.status !== state.statusFilter) {
    return false;
  }
  return true;
}

function renderRunList(state: ViewState): void {
  const list = requiredElement<HTMLElement>("#runs-list");
  const emptyState = requiredElement<HTMLElement>("#empty-state");
  const summaryLabel = requiredElement<HTMLElement>("#runs-summary");
  const filtered = state.summaries.filter((item) => matchesFilter(item, state));

  const loaded = state.summaries.length;
  const total = state.totalRuns || loaded;
  summaryLabel.textContent = `${filtered.length} / ${total}`;
  emptyState.hidden = filtered.length > 0;

  list.innerHTML = filtered
    .map((summary) => {
      const selected = summary.id === state.selectedRunId ? " selected" : "";
      const removeDisabled = state.removeLoadingRunId != null ? " disabled" : "";
      const removeLabel = state.removeLoadingRunId === summary.id ? "..." : "x";
      return [
        `<article class="run-item${selected}" data-run-id="${summary.id}">`,
        `<div class="workflow-item-head">`,
        `<div class="workflow-item-id" title="${escapeHtml(summary.id)}">${escapeHtml(summary.id)}</div>`,
        `<div class="workflow-item-actions">`,
        `${renderWorkflowStatusIndicator(summary.status)}`,
        `<button type="button" class="workflow-remove-button" data-action="remove-workflow" data-run-id="${summary.id}" title="Remove workflow" aria-label="Remove workflow ${escapeHtml(summary.id)}"${removeDisabled}>${removeLabel}</button>`,
        `</div>`,
        `</div>`,
        `</article>`,
      ].join("");
    })
    .join("");
}

function renderRunDetail(state: ViewState): void {
  const container = requiredElement<HTMLElement>("#run-detail");
  const pathLabel = requiredElement<HTMLElement>("#run-path");
  const run = state.runDetail;

  if (!run) {
    pathLabel.textContent = "Select a workflow";
    pathLabel.removeAttribute("title");
    container.innerHTML = `<p class="empty-state">Select a workflow to inspect steps and logs.</p>`;
    return;
  }

  const category = workflowCategoryLabel(run.category);
  const canStop = run.format === "workflow-first" && run.status === "running";
  pathLabel.textContent = `${run.id} · ${category} · ${run.status}`;
  if (run.runDir) {
    pathLabel.title = run.runDir;
  } else {
    pathLabel.removeAttribute("title");
  }

  const steps = run.steps
    .map((step) => {
      const logControl = step.logUrl
        ? `<button type="button" class="button" data-action="view-log" data-step-id="${step.id}">View log</button>`
        : `<span class="empty-state">no log</span>`;
      const artifactsList = Array.isArray(step.artifacts) ? step.artifacts : [];
      const artifactsCount = typeof step.artifactCount === "number" ? step.artifactCount : artifactsList.length;
      const artifactsControl =
        artifactsCount > 0
          ? [
              `<details class="step-artifacts">`,
              `<summary>artifacts ${artifactsCount}</summary>`,
              `<ul>`,
              ...artifactsList.slice(0, 20).map((artifact) => {
                const pathLabel = artifact.path ? escapeHtml(artifact.path) : "(artifact)";
                const locationLabel = artifact.location ? escapeHtml(artifact.location) : "";
                return `<li><span class="step-artifact-path">${pathLabel}</span><span class="step-artifact-location" title="${locationLabel}">${locationLabel}</span></li>`;
              }),
              artifactsList.length > 20
                ? `<li class="step-artifact-more">…and ${artifactsList.length - 20} more</li>`
                : ``,
              `</ul>`,
              `</details>`,
            ].join("")
          : "";
      const selected = state.selectedStepId === step.id ? " selected" : "";

      return [
        `<div class="step-card${selected}">`,
        `<div class="step-card-header">`,
        `<div class="step-name">${step.name || step.id}</div>`,
        `<span class="status-pill ${statusClass(step.status)}">${step.status}</span>`,
        `</div>`,
        `<div class="run-item-meta">`,
        `<div>id ${step.id}</div>`,
        `<div>${logControl}</div>`,
        `</div>`,
        `<div class="step-actions">${artifactsControl}</div>`,
        `</div>`,
      ].join("");
    })
    .join("");

  container.innerHTML = [
    `<section class="workflow-overview">`,
    `<div class="workflow-overview-header">`,
    `${renderWorkflowCategoryBadge(category)}`,
    `<span class="status-pill ${statusClass(run.status)}">${escapeHtml(run.status)}</span>`,
    canStop
      ? `<button type="button" class="button small" data-action="stop-workflow"${state.stopLoading ? " disabled" : ""}>${state.stopLoading ? "Stopping..." : "Stop"}</button>`
      : ``,
    `</div>`,
    state.stopError ? `<p class="empty-state">${escapeHtml(state.stopError)}</p>` : ``,
    state.removeError ? `<p class="empty-state">${escapeHtml(state.removeError)}</p>` : ``,
    `<div class="workflow-overview-grid">`,
    `<div><span class="meta-label">Workflow</span><span>${escapeHtml(run.id)}</span></div>`,
    `<div><span class="meta-label">Created</span><span>${escapeHtml(formatTimestamp(run.createdAt))}</span></div>`,
    `<div><span class="meta-label">Completed</span><span>${escapeHtml(formatTimestamp(run.completedAt))}</span></div>`,
    `<div><span class="meta-label">Change</span><span>${escapeHtml(formatText(run.changeName))}</span></div>`,
    `<div><span class="meta-label">Steps</span><span>${escapeHtml(String(run.stepCount))}</span></div>`,
    `<div class="workflow-overview-path"><span class="meta-label">Path</span><span title="${escapeHtml(run.runDir || "")}">${escapeHtml(formatText(run.runDir))}</span></div>`,
    `</div>`,
    `</section>`,
    `<div class="steps">${steps || `<p class="empty-state">No steps recorded.</p>`}</div>`,
  ].join("");
}

function renderLogPane(state: ViewState): void {
  const container = requiredElement<HTMLElement>("#log-detail");
  const pathLabel = requiredElement<HTMLElement>("#log-path");
  const jsonlButton = requiredElement<HTMLButtonElement>("#log-jsonl");
  const beautifyButton = requiredElement<HTMLButtonElement>("#log-beautify");
  const wrapButton = requiredElement<HTMLButtonElement>("#log-wrap");
  const copyButton = requiredElement<HTMLButtonElement>("#log-copy");

  jsonlButton.setAttribute("aria-pressed", state.logJsonl ? "true" : "false");
  beautifyButton.setAttribute("aria-pressed", state.logBeautify ? "true" : "false");
  wrapButton.setAttribute("aria-pressed", state.logWrap ? "true" : "false");
  copyButton.disabled = !state.logText;

  if (!state.selectedRunId || !state.runDetail) {
    pathLabel.textContent = "Select a step";
    container.innerHTML = `<p class="empty-state">Select a step to view its log.</p>`;
    return;
  }

  if (!state.selectedStepId) {
    pathLabel.textContent = "Select a step";
    container.innerHTML = `<p class="empty-state">Select a step to view its log.</p>`;
    return;
  }

  pathLabel.textContent = `${state.selectedRunId} / ${state.selectedStepId}`;

  if (state.logLoading) {
    container.innerHTML = `<p class="empty-state">Loading log…</p>`;
    return;
  }

  if (state.logError) {
    container.innerHTML = `<p class="empty-state">${escapeHtml(state.logError)}</p>`;
    return;
  }

  if (state.logText == null) {
    container.innerHTML = `<p class="empty-state">No log loaded.</p>`;
    return;
  }

  container.innerHTML = renderLogHtml(
    state.logText,
    state.logWrap,
    state.logBeautify,
    state.logJsonl,
  );
}

function selectedRunFromHash(hash: string): string | null {
  const match = (hash || "").match(/(?:^|#|&)run=([^&]+)/);
  if (!match) {
    return null;
  }
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

async function refreshSummaries(state: ViewState): Promise<void> {
  const payload = await fetchJson<RunsIndexPayload>("/api/runs");
  state.summaries = payload.runs;
  state.totalRuns = payload.totalRuns;
  state.runsLimit = payload.limit;
  state.runsOffset = payload.offset;
  state.runRoot = payload.runRoot;
  state.updatedAt = payload.updatedAt;
  const updatedAt = optionalElement<HTMLElement>("#updated-at");
  if (updatedAt) {
    updatedAt.textContent = formatTimestamp(payload.updatedAt);
  }
  renderRunList(state);
}

async function refreshSelectedRun(state: ViewState): Promise<void> {
  if (!state.selectedRunId) {
    state.runDetail = null;
    state.selectedStepId = null;
    state.logText = null;
    state.logError = null;
    state.logLoading = false;
    state.stopError = null;
    state.stopLoading = false;
    renderRunDetail(state);
    renderLogPane(state);
    return;
  }
  try {
    const detail = await fetchJson<RunDetail>(`/api/runs/${encodeURIComponent(state.selectedRunId)}`);
    state.runDetail = detail;
    state.stopError = null;
    renderRunDetail(state);
    renderLogPane(state);
  } catch (error) {
    state.runDetail = null;
    state.selectedStepId = null;
    state.logText = null;
    state.logError = null;
    state.logLoading = false;
    state.stopError = null;
    state.stopLoading = false;
    renderRunDetail(state);
    renderLogPane(state);
    console.error(error);
  }
}

function installSse(state: ViewState): void {
  const source = new EventSource("/api/events");
  source.addEventListener("runs-changed", () => {
    void refreshSummaries(state)
      .then(() => refreshSelectedRun(state))
      .then(() => {
        if (state.selectedRunId && state.selectedStepId) {
          void loadStepLog(state, state.selectedStepId);
        }
      });
  });
  source.addEventListener("error", () => {
    // Ignore; Vite dev server reloads and reconnects frequently.
  });
}

async function loadStepLog(state: ViewState, stepId: string): Promise<void> {
  if (!state.selectedRunId) {
    return;
  }
  state.selectedStepId = stepId;
  state.logLoading = true;
  state.logError = null;
  state.logText = null;
  renderRunDetail(state);
  renderLogPane(state);

  try {
    const text = await fetchText(
      `/api/runs/${encodeURIComponent(state.selectedRunId)}/steps/${encodeURIComponent(stepId)}/log`,
    );
    state.logText = text;
    state.logLoading = false;
    state.logError = null;
    renderRunDetail(state);
    renderLogPane(state);
  } catch (error) {
    state.logLoading = false;
    state.logError = "Failed to load log.";
    state.logText = null;
    renderRunDetail(state);
    renderLogPane(state);
    console.error(error);
  }
}

async function stopWorkflow(state: ViewState): Promise<void> {
  if (!state.selectedRunId || !state.runDetail) {
    return;
  }
  state.stopLoading = true;
  state.stopError = null;
  renderRunDetail(state);
  try {
    await postJson(`/api/runs/${encodeURIComponent(state.selectedRunId)}/stop`);
    state.stopLoading = false;
    await refreshSummaries(state);
    await refreshSelectedRun(state);
  } catch (error) {
    state.stopLoading = false;
    state.stopError = error instanceof Error ? error.message.trim() : "Failed to stop workflow.";
    renderRunDetail(state);
  }
}

async function removeWorkflow(state: ViewState, runId: string): Promise<void> {
  if (!runId || state.removeLoadingRunId) {
    return;
  }
  state.removeLoadingRunId = runId;
  state.removeError = null;
  renderRunList(state);
  if (state.selectedRunId === runId) {
    renderRunDetail(state);
  }
  try {
    await postJson(`/api/runs/${encodeURIComponent(runId)}/remove`);
    if (state.selectedRunId === runId) {
      state.selectedRunId = null;
      state.selectedStepId = null;
      state.runDetail = null;
      state.logText = null;
      state.logError = null;
      state.logLoading = false;
      window.location.hash = "";
    }
    await refreshSummaries(state);
    await refreshSelectedRun(state);
  } catch (error) {
    state.removeError = error instanceof Error ? error.message.trim() : "Failed to remove workflow.";
  } finally {
    state.removeLoadingRunId = null;
    renderRunList(state);
    renderRunDetail(state);
    renderLogPane(state);
  }
}

export async function bootstrap(): Promise<void> {
  installPaneResizers();

  const state: ViewState = {
    selectedRunId: selectedRunFromHash(window.location.hash),
    selectedStepId: null,
    summaries: [],
    totalRuns: 0,
    runsLimit: 0,
    runsOffset: 0,
    runDetail: null,
    runRoot: "",
    updatedAt: "",
    statusFilter: "",
    logText: null,
    logLoading: false,
    logError: null,
    logWrap: false,
    logBeautify: true,
    logJsonl: true,
    stopLoading: false,
    stopError: null,
    removeLoadingRunId: null,
    removeError: null,
  };

  requiredElement<HTMLButtonElement>("#refresh-button").addEventListener("click", () => {
    void refreshSummaries(state).then(() => refreshSelectedRun(state));
  });

  requiredElement<HTMLSelectElement>("#status-filter").addEventListener("change", (event) => {
    state.statusFilter = (event.target as HTMLSelectElement).value as StatusFilter;
    renderRunList(state);
  });

  requiredElement<HTMLElement>("#runs-list").addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }
    const removeButton = target.closest<HTMLElement>("[data-action=\"remove-workflow\"]");
    if (removeButton?.dataset.runId) {
      void removeWorkflow(state, removeButton.dataset.runId);
      return;
    }
    const item = target.closest<HTMLElement>("[data-run-id]");
    if (!item?.dataset.runId) {
      return;
    }
    state.selectedRunId = item.dataset.runId;
    window.location.hash = `run=${encodeURIComponent(state.selectedRunId)}`;
    state.selectedStepId = null;
    state.logText = null;
    state.logError = null;
    state.logLoading = false;
    renderRunList(state);
    void refreshSelectedRun(state);
  });

  requiredElement<HTMLElement>("#run-detail").addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }
    if (target.closest("[data-action=\"stop-workflow\"]")) {
      void stopWorkflow(state);
      return;
    }
    const button = target.closest<HTMLElement>("[data-action=\"view-log\"]");
    if (!button?.dataset.stepId) {
      return;
    }
    void loadStepLog(state, button.dataset.stepId);
  });

  requiredElement<HTMLButtonElement>("#log-jsonl").addEventListener("click", () => {
    state.logJsonl = !state.logJsonl;
    renderLogPane(state);
  });

  requiredElement<HTMLButtonElement>("#log-beautify").addEventListener("click", () => {
    state.logBeautify = !state.logBeautify;
    renderLogPane(state);
  });

  requiredElement<HTMLButtonElement>("#log-wrap").addEventListener("click", () => {
    state.logWrap = !state.logWrap;
    renderLogPane(state);
  });

  requiredElement<HTMLButtonElement>("#log-copy").addEventListener("click", async () => {
    if (!state.logText) {
      return;
    }
    try {
      await navigator.clipboard.writeText(state.logText);
    } catch (error) {
      console.error(error);
    }
  });

  window.addEventListener("hashchange", () => {
    state.selectedRunId = selectedRunFromHash(window.location.hash);
    state.selectedStepId = null;
    state.logText = null;
    state.logError = null;
    state.logLoading = false;
    renderRunList(state);
    void refreshSelectedRun(state);
  });

  try {
    installSse(state);
  } catch (error) {
    console.error(error);
  }

  try {
    await refreshSummaries(state);
    await refreshSelectedRun(state);
  } catch (error) {
    console.error(error);
  }
}

if (typeof window !== "undefined") {
  void bootstrap();
}
