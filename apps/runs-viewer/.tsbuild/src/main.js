function requiredElement(selector) {
    const element = document.querySelector(selector);
    if (!element) {
        throw new Error(`Expected element ${selector}`);
    }
    return element;
}
function optionalElement(selector) {
    return document.querySelector(selector);
}
const PANE_RESIZER_PX = 12;
const PANE_GAP_PX = 12;
const PANE_MIN_PX = 260;
const PANE_RATIOS_STORAGE_KEY = "morpheus:runs-viewer:paneRatios:v2";
const NARROW_MEDIA_QUERY = "(max-width: 980px)";
function statusClass(status) {
    const value = status || "unknown";
    return `status-${value}`;
}
function escapeHtml(value) {
    return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
function isPlainObject(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function unescapeLogEscapes(value) {
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
function tryParseJson(value) {
    try {
        return JSON.parse(value);
    }
    catch {
        return null;
    }
}
function extractStructuredPayload(line) {
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
function jsonlSummary(value) {
    if (!isPlainObject(value)) {
        return null;
    }
    const summary = typeof value.summary === "string" ? value.summary : null;
    const message = typeof value.message === "string" ? value.message : null;
    const event = typeof value.event === "string" ? value.event : null;
    return summary || message || event;
}
function jsonlStatus(value) {
    if (!isPlainObject(value)) {
        return null;
    }
    const status = typeof value.status === "string" ? value.status : null;
    return status && status.trim() ? status : null;
}
function jsonlBadges(value) {
    if (!isPlainObject(value)) {
        if (Array.isArray(value)) {
            return [{ label: `argv ${value.length}`, cls: "jsonl-badge argv" }];
        }
        return [];
    }
    const badges = [];
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
function jsonToHtml(value) {
    const text = JSON.stringify(value, null, 2);
    const escaped = escapeHtml(text);
    const withStrings = escaped.replace(/&quot;([^&\n]*?)&quot;/g, `<span class="tok-json-str">&quot;$1&quot;</span>`);
    const withKeys = withStrings.replace(/<span class="tok-json-str">(&quot;[^&\n]*?&quot;)<\/span>(?=:\s)/g, `<span class="tok-json-key">$1</span>`);
    return withKeys
        .replace(/\b-?\d+(?:\.\d+)?\b/g, `<span class="tok-json-num">$&</span>`)
        .replace(/\btrue\b|\bfalse\b/g, `<span class="tok-json-bool">$&</span>`)
        .replace(/\bnull\b/g, `<span class="tok-json-null">null</span>`);
}
function renderJsonlLine(payload, beautify) {
    const { prefix, value } = payload;
    const status = jsonlStatus(value);
    const statusCls = status ? ` jsonl-status-${escapeHtml(status)}` : "";
    const summary = jsonlSummary(value);
    const badges = jsonlBadges(value);
    let summaryText = summary ? summary : "";
    if (!summaryText && Array.isArray(value)) {
        summaryText = `argv (${value.length} args)`;
    }
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
function isMessageLikePayload(value) {
    if (!isPlainObject(value)) {
        return false;
    }
    if (typeof value.summary === "string" && value.summary.trim()) {
        return true;
    }
    if (typeof value.message === "string" && value.message.trim()) {
        return true;
    }
    if (typeof value.event === "string" && value.event.trim()) {
        return true;
    }
    return false;
}
function isFailureLikePayload(value) {
    const status = jsonlStatus(value);
    if (!status) {
        return false;
    }
    const lowered = status.toLowerCase();
    return lowered === "error" || lowered === "failure" || lowered === "failed";
}
function shouldHideStructuredPayload(payload, messagesOnly) {
    if (!messagesOnly) {
        return false;
    }
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
    if (isMessageLikePayload(value)) {
        return false;
    }
    return true;
}
function defaultPaneRatios() {
    const raw = [1, 1];
    return normalizePaneRatios(raw);
}
function normalizePaneRatios(ratios) {
    const sanitized = ratios.map((value) => (Number.isFinite(value) && value > 0 ? value : 0));
    const sum = sanitized[0] + sanitized[1];
    if (!sum) {
        return [1 / 2, 1 / 2];
    }
    return [sanitized[0] / sum, sanitized[1] / sum];
}
function loadPaneRatios() {
    try {
        const raw = localStorage.getItem(PANE_RATIOS_STORAGE_KEY);
        if (!raw) {
            return defaultPaneRatios();
        }
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed) || parsed.length !== 2) {
            return defaultPaneRatios();
        }
        return normalizePaneRatios([Number(parsed[0]), Number(parsed[1])]);
    }
    catch {
        return defaultPaneRatios();
    }
}
function savePaneRatios(ratios) {
    try {
        localStorage.setItem(PANE_RATIOS_STORAGE_KEY, JSON.stringify(ratios));
    }
    catch {
        // ignore
    }
}
function isNarrowViewport() {
    try {
        return window.matchMedia(NARROW_MEDIA_QUERY).matches;
    }
    catch {
        return false;
    }
}
function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}
function availablePaneWidthPx(workspace) {
    const listPane = optionalElement(".list-pane");
    const measuredRunsWidth = listPane ? Math.round(listPane.getBoundingClientRect().width) : 0;
    const runsWidth = measuredRunsWidth > 0 ? measuredRunsWidth : 420;
    return Math.max(0, workspace.clientWidth - runsWidth - PANE_GAP_PX - PANE_RESIZER_PX);
}
function applyPaneRatios(workspace, ratios) {
    if (isNarrowViewport()) {
        workspace.style.gridTemplateColumns = "";
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
function currentPaneWidthsPx(workspace) {
    const detailPane = requiredElement(".detail-pane");
    const logPane = requiredElement(".log-pane");
    return [
        detailPane.getBoundingClientRect().width,
        logPane.getBoundingClientRect().width,
    ];
}
function adjustedPair(sum, a, delta, min) {
    const effectiveMin = Math.min(min, Math.floor(sum / 2));
    const nextA = clamp(a + delta, effectiveMin, sum - effectiveMin);
    return [nextA, sum - nextA];
}
function installPaneResizers() {
    const workspace = requiredElement(".workspace-main");
    const rightResizer = optionalElement("[data-resizer=\"right\"]");
    if (!rightResizer) {
        return;
    }
    let ratios = loadPaneRatios();
    applyPaneRatios(workspace, ratios);
    const handleResize = () => applyPaneRatios(workspace, ratios);
    window.addEventListener("resize", handleResize, { passive: true });
    const startDrag = (resizer, event) => {
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
        const onMove = (moveEvent) => {
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
    const onKey = (resizer, event) => {
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
            }
            else {
                applyPaneRatios(workspace, ratios);
            }
        };
        if ("addEventListener" in media) {
            media.addEventListener("change", onMediaChange);
        }
    }
    catch {
        // ignore
    }
}
function highlightLogLine(rawLine) {
    const escaped = escapeHtml(rawLine);
    const patterns = [
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
function renderLogHtml(logText, wrap, beautify, jsonl, messagesOnly) {
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
            if (shouldHideStructuredPayload(payload, messagesOnly)) {
                return "";
            }
            return `<li class="log-line"><span class="log-ln">${lineNumber}</span><span class="log-lc">${renderJsonlLine(payload, beautify)}</span></li>`;
        }
        const displayLine = beautify ? unescapeLogEscapes(line) : line;
        return `<li class="log-line"><span class="log-ln">${lineNumber}</span><span class="log-lc">${highlightLogLine(displayLine)}</span></li>`;
    })
        .join("");
    const className = wrap ? "log-viewer wrap" : "log-viewer";
    return `${note}<div class="${className}"><ul class="log-lines">${items}</ul></div>`;
}
function formatText(value) {
    return value && value.trim() ? value : "-";
}
let timestampFormatter = null;
try {
    timestampFormatter = new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "medium",
        timeZoneName: "short",
    });
}
catch {
    timestampFormatter = null;
}
function formatTimestamp(value) {
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
    }
    catch {
        // ignore
    }
    try {
        return date.toLocaleString();
    }
    catch {
        return value;
    }
}
function matchesFilter(summary, state) {
    if (state.statusFilter && summary.status !== state.statusFilter) {
        return false;
    }
    return true;
}
async function fetchJson(path) {
    const response = await fetch(path, { headers: { accept: "application/json" } });
    if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText}`);
    }
    return (await response.json());
}
async function fetchText(path) {
    const response = await fetch(path, { headers: { accept: "text/plain" } });
    if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText}`);
    }
    return await response.text();
}
function renderRunList(state) {
    const list = requiredElement("#runs-list");
    const emptyState = requiredElement("#empty-state");
    const summaryLabel = requiredElement("#runs-summary");
    const filtered = state.summaries.filter((item) => matchesFilter(item, state));
    const loaded = state.summaries.length;
    const total = state.totalRuns || loaded;
    summaryLabel.textContent =
        loaded < total
            ? `${filtered.length} shown · ${loaded} of ${total} loaded`
            : `${filtered.length} shown · ${loaded} loaded`;
    emptyState.hidden = filtered.length > 0;
    list.innerHTML = filtered
        .map((summary) => {
        const selected = summary.id === state.selectedRunId ? " selected" : "";
        return [
            `<article class="run-item${selected}" data-run-id="${summary.id}">`,
            `<div class="run-item-title"><span>${summary.id}</span>`,
            `<span class="status-pill ${statusClass(summary.status)}">${summary.status}</span></div>`,
            `<div class="run-item-meta">`,
            `<div>created ${formatTimestamp(summary.createdAt)}</div>`,
            `<div>steps ${summary.stepCount}</div>`,
            `</div>`,
            `</article>`,
        ].join("");
    })
        .join("");
}
function renderRunDetail(state) {
    const container = requiredElement("#run-detail");
    const pathLabel = requiredElement("#run-path");
    const run = state.runDetail;
    if (!run) {
        pathLabel.textContent = "Select a run";
        pathLabel.removeAttribute("title");
        container.innerHTML = `<p class="empty-state">Select a run to inspect steps and logs.</p>`;
        return;
    }
    pathLabel.textContent = `${run.id} · ${run.status}`;
    if (run.runDir) {
        pathLabel.title = run.runDir;
    }
    else {
        pathLabel.removeAttribute("title");
    }
    const steps = run.steps
        .map((step) => {
        const logControl = step.logUrl
            ? `<button type="button" class="button" data-action="view-log" data-step-id="${step.id}">View log</button>`
            : `<span class="empty-state">no log</span>`;
        const artifactsList = Array.isArray(step.artifacts) ? step.artifacts : [];
        const artifactsCount = typeof step.artifactCount === "number" ? step.artifactCount : artifactsList.length;
        const artifactsControl = artifactsCount > 0
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
        `<div class="steps">${steps || `<p class="empty-state">No steps recorded.</p>`}</div>`,
    ].join("");
}
function renderLogPane(state) {
    const container = requiredElement("#log-detail");
    const pathLabel = requiredElement("#log-path");
    const jsonlButton = requiredElement("#log-jsonl");
    const messagesButton = requiredElement("#log-messages");
    const beautifyButton = requiredElement("#log-beautify");
    const wrapButton = requiredElement("#log-wrap");
    const copyButton = requiredElement("#log-copy");
    jsonlButton.setAttribute("aria-pressed", state.logJsonl ? "true" : "false");
    messagesButton.setAttribute("aria-pressed", state.logMessagesOnly ? "true" : "false");
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
    container.innerHTML = renderLogHtml(state.logText, state.logWrap, state.logBeautify, state.logJsonl, state.logMessagesOnly);
}
function selectedRunFromHash(hash) {
    const match = (hash || "").match(/(?:^|#|&)run=([^&]+)/);
    if (!match) {
        return null;
    }
    try {
        return decodeURIComponent(match[1]);
    }
    catch {
        return null;
    }
}
async function refreshSummaries(state) {
    const payload = await fetchJson("/api/runs");
    state.summaries = payload.runs;
    state.totalRuns = payload.totalRuns;
    state.runsLimit = payload.limit;
    state.runsOffset = payload.offset;
    state.runRoot = payload.runRoot;
    state.updatedAt = payload.updatedAt;
    const updatedAt = optionalElement("#updated-at");
    if (updatedAt) {
        updatedAt.textContent = formatTimestamp(payload.updatedAt);
    }
    renderRunList(state);
}
async function refreshSelectedRun(state) {
    if (!state.selectedRunId) {
        state.runDetail = null;
        state.selectedStepId = null;
        state.logText = null;
        state.logError = null;
        state.logLoading = false;
        renderRunDetail(state);
        renderLogPane(state);
        return;
    }
    try {
        const detail = await fetchJson(`/api/runs/${encodeURIComponent(state.selectedRunId)}`);
        state.runDetail = detail;
        renderRunDetail(state);
        renderLogPane(state);
    }
    catch (error) {
        state.runDetail = null;
        state.selectedStepId = null;
        state.logText = null;
        state.logError = null;
        state.logLoading = false;
        renderRunDetail(state);
        renderLogPane(state);
        console.error(error);
    }
}
function installSse(state) {
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
async function loadStepLog(state, stepId) {
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
        const text = await fetchText(`/api/runs/${encodeURIComponent(state.selectedRunId)}/steps/${encodeURIComponent(stepId)}/log`);
        state.logText = text;
        state.logLoading = false;
        state.logError = null;
        renderRunDetail(state);
        renderLogPane(state);
    }
    catch (error) {
        state.logLoading = false;
        state.logError = "Failed to load log.";
        state.logText = null;
        renderRunDetail(state);
        renderLogPane(state);
        console.error(error);
    }
}
export async function bootstrap() {
    installPaneResizers();
    const state = {
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
        logMessagesOnly: false,
    };
    requiredElement("#refresh-button").addEventListener("click", () => {
        void refreshSummaries(state).then(() => refreshSelectedRun(state));
    });
    requiredElement("#status-filter").addEventListener("change", (event) => {
        state.statusFilter = event.target.value;
        renderRunList(state);
    });
    requiredElement("#runs-list").addEventListener("click", (event) => {
        const target = event.target;
        if (!(target instanceof Element)) {
            return;
        }
        const item = target.closest("[data-run-id]");
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
    requiredElement("#run-detail").addEventListener("click", (event) => {
        const target = event.target;
        if (!(target instanceof Element)) {
            return;
        }
        const button = target.closest("[data-action=\"view-log\"]");
        if (!button?.dataset.stepId) {
            return;
        }
        void loadStepLog(state, button.dataset.stepId);
    });
    requiredElement("#log-jsonl").addEventListener("click", () => {
        state.logJsonl = !state.logJsonl;
        renderLogPane(state);
    });
    requiredElement("#log-messages").addEventListener("click", () => {
        state.logMessagesOnly = !state.logMessagesOnly;
        renderLogPane(state);
    });
    requiredElement("#log-beautify").addEventListener("click", () => {
        state.logBeautify = !state.logBeautify;
        renderLogPane(state);
    });
    requiredElement("#log-wrap").addEventListener("click", () => {
        state.logWrap = !state.logWrap;
        renderLogPane(state);
    });
    requiredElement("#log-copy").addEventListener("click", async () => {
        if (!state.logText) {
            return;
        }
        try {
            await navigator.clipboard.writeText(state.logText);
        }
        catch (error) {
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
    }
    catch (error) {
        console.error(error);
    }
    try {
        await refreshSummaries(state);
        await refreshSelectedRun(state);
    }
    catch (error) {
        console.error(error);
    }
}
if (typeof window !== "undefined") {
    void bootstrap();
}
