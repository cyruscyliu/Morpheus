import type { IncomingMessage, ServerResponse } from "node:http";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import chokidar from "chokidar";

import { findRunRoot } from "./run-root";
import { debounce } from "./debounce";
import { loadRunDetail, loadRunEvents, loadStepLogText, listRunSummariesWithTotal } from "./runs-store";
import { isSafeId } from "./validate";

export interface RunsViewerServer {
  middleware: (req: IncomingMessage, res: ServerResponse, next: () => void) => void;
  close: () => void;
}

interface Options {
  projectRoot: string;
}

function json(res: ServerResponse, status: number, value: unknown): void {
  const body = `${JSON.stringify(value, null, 2)}\n`;
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.end(body);
}

function text(res: ServerResponse, status: number, value: string): void {
  res.statusCode = status;
  res.setHeader("content-type", "text/plain; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.end(value);
}

function notFound(res: ServerResponse): void {
  text(res, 404, "not found\n");
}

function badRequest(res: ServerResponse, message: string): void {
  text(res, 400, `${message}\n`);
}

function requestPath(req: IncomingMessage): URL | null {
  const raw = req.url || "";
  try {
    return new URL(raw, "http://localhost");
  } catch {
    return null;
  }
}

function writeSse(res: ServerResponse, event: string, data?: unknown): void {
  res.write(`event: ${event}\n`);
  if (data !== undefined) {
    res.write(`data: ${JSON.stringify(data)}\n`);
  }
  res.write("\n");
}

function runIdFromWatcherPath(runRoot: string, filePath: string): string | null {
  const relative = path.relative(runRoot, filePath);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    return null;
  }
  const [runId] = relative.split(path.sep);
  return runId || null;
}

function classifyWatcherEvent(runRoot: string, filePath: string): { event: string; data: Record<string, string> } | null {
  const baseName = path.basename(filePath);
  if (baseName === "events.jsonl") {
    const runId = runIdFromWatcherPath(runRoot, filePath);
    if (!runId) {
      return null;
    }
    return {
      event: "run-events-changed",
      data: { runId, updatedAt: new Date().toISOString() },
    };
  }
  if (baseName === "workflow.json" || baseName === "manifest.json") {
    const runId = runIdFromWatcherPath(runRoot, filePath);
    if (!runId) {
      return null;
    }
    return {
      event: "run-detail-changed",
      data: { runId, updatedAt: new Date().toISOString() },
    };
  }
  if (baseName === "stdout.log" || baseName === "console.log") {
    return null;
  }
  return {
    event: "runs-changed",
    data: { updatedAt: new Date().toISOString() },
  };
}

export function createRunsViewerServer(options: Options): RunsViewerServer {
  void options;
  const repoRoot = path.resolve(process.cwd(), "..", "..");
  const runRootInfo = findRunRoot({ startDir: process.cwd(), repoRoot });
  const { runRoot } = runRootInfo;
  const sseClients = new Set<ServerResponse>();

  const broadcastWatcherEvent = debounce((filePath: string) => {
    const classified = classifyWatcherEvent(runRoot, filePath);
    if (!classified) {
      return;
    }
    for (const client of sseClients) {
      writeSse(client, classified.event, classified.data);
    }
  }, 250);

  const watcher = chokidar.watch(runRoot, {
    ignoreInitial: true,
    depth: 5,
  });
  watcher.on("add", broadcastWatcherEvent);
  watcher.on("change", broadcastWatcherEvent);
  watcher.on("unlink", broadcastWatcherEvent);
  watcher.on("addDir", broadcastWatcherEvent);
  watcher.on("unlinkDir", broadcastWatcherEvent);

  function stopWorkflowRun(runId: string): { ok: true; body: unknown } | { ok: false; body: unknown } {
    const result = spawnSync(
      "node",
      [
        path.join(repoRoot, "apps", "morpheus", "dist", "cli.js"),
        "--json",
        "workflow",
        "stop",
        "--id",
        runId,
        "--workspace",
        runRootInfo.workspaceRoot,
      ],
      {
        cwd: repoRoot,
        encoding: "utf8",
      },
    );
    if (result.status !== 0) {
      return {
        ok: false,
        body: {
          status: "error",
          summary: (result.stderr || result.stdout || "failed to stop workflow").trim(),
        },
      };
    }
    return {
      ok: true,
      body: JSON.parse(String(result.stdout || "{}").trim() || "{}"),
    };
  }

  function resumeWorkflowRun(runId: string, fromStep?: string | null): { ok: true; body: unknown } | { ok: false; body: unknown } {
    const args = [
      path.join(repoRoot, "apps", "morpheus", "dist", "cli.js"),
      "--json",
      "workflow",
      "resume",
      "--id",
      runId,
      "--workspace",
      runRootInfo.workspaceRoot,
    ];
    if (fromStep) {
      args.push("--from-step", fromStep);
    }
    const result = spawnSync("node", args, {
      cwd: repoRoot,
      encoding: "utf8",
    });
    if (result.status !== 0) {
      return {
        ok: false,
        body: {
          status: "error",
          summary: (result.stderr || result.stdout || "failed to resume workflow").trim(),
        },
      };
    }
    return {
      ok: true,
      body: JSON.parse(String(result.stdout || "{}").trim() || "{}"),
    };
  }

  function handleApi(req: IncomingMessage, res: ServerResponse): boolean {
    const url = requestPath(req);
    if (!url) {
      notFound(res);
      return true;
    }

    if (req.method === "POST") {
      const stopMatch = url.pathname.match(/^\/api\/runs\/([^/]+)\/stop$/);
      if (stopMatch) {
        const runId = decodeURIComponent(stopMatch[1] || "");
        if (!isSafeId(runId)) {
          notFound(res);
          return true;
        }
        const detail = loadRunDetail(runRoot, runId);
        if (!detail) {
          notFound(res);
          return true;
        }
        if (detail.format !== "workflow-first") {
          badRequest(res, "stop only supports workflow-first runs");
          return true;
        }
        const stopResult = stopWorkflowRun(runId);
        if (!stopResult.ok) {
          json(res, 500, stopResult.body);
          return true;
        }
        json(res, 200, stopResult.body);
        return true;
      }

      const resumeMatch = url.pathname.match(/^\/api\/runs\/([^/]+)\/resume$/);
      if (resumeMatch) {
        const runId = decodeURIComponent(resumeMatch[1] || "");
        if (!isSafeId(runId)) {
          notFound(res);
          return true;
        }
        const detail = loadRunDetail(runRoot, runId);
        if (!detail) {
          notFound(res);
          return true;
        }
        if (detail.format !== "workflow-first") {
          badRequest(res, "resume only supports workflow-first runs");
          return true;
        }
        const resumeResult = resumeWorkflowRun(runId, url.searchParams.get("fromStep"));
        if (!resumeResult.ok) {
          json(res, 500, resumeResult.body);
          return true;
        }
        json(res, 200, resumeResult.body);
        return true;
      }

      const removeMatch = url.pathname.match(/^\/api\/runs\/([^/]+)\/remove$/);
      if (removeMatch) {
        const runId = decodeURIComponent(removeMatch[1] || "");
        if (!isSafeId(runId)) {
          notFound(res);
          return true;
        }
        const detail = loadRunDetail(runRoot, runId);
        if (!detail) {
          notFound(res);
          return true;
        }
        const runDir = path.resolve(runRoot, runId);
        const relative = path.relative(runRoot, runDir);
        if (relative.startsWith("..") || path.isAbsolute(relative)) {
          badRequest(res, "invalid run directory");
          return true;
        }
        if (detail.format === "workflow-first" && detail.status === "running") {
          const stopResult = stopWorkflowRun(runId);
          if (!stopResult.ok) {
            json(res, 500, stopResult.body);
            return true;
          }
        }
        fs.rmSync(runDir, { recursive: true, force: true });
        json(res, 200, {
          command: "remove workflow",
          status: "success",
          exit_code: 0,
          summary: "removed workflow run",
          details: {
            id: runId,
            run_dir: runDir,
          },
        });
        return true;
      }
      return false;
    }

    if (req.method !== "GET") {
      return false;
    }

    if (url.pathname === "/api/events") {
      res.statusCode = 200;
      res.setHeader("content-type", "text/event-stream; charset=utf-8");
      res.setHeader("cache-control", "no-store");
      res.setHeader("connection", "keep-alive");
      res.setHeader("x-accel-buffering", "no");
      res.write("\n");
      sseClients.add(res);
      writeSse(res, "runs-changed", { updatedAt: new Date().toISOString() });
      req.on("close", () => {
        sseClients.delete(res);
      });
      return true;
    }

    if (url.pathname === "/api/runs") {
      const result = listRunSummariesWithTotal(runRoot, {
        limit: url.searchParams.get("limit"),
        offset: url.searchParams.get("offset"),
      });
      json(res, 200, {
        runRoot,
        workspaceRoot: runRootInfo.workspaceRoot,
        configPath: runRootInfo.configPath,
        updatedAt: new Date().toISOString(),
        runs: result.runs,
        totalRuns: result.total,
        offset: result.offset,
        limit: result.limit,
      });
      return true;
    }

    const runMatch = url.pathname.match(/^\/api\/runs\/([^/]+)$/);
    if (runMatch) {
      const runId = decodeURIComponent(runMatch[1] || "");
      if (!isSafeId(runId)) {
        notFound(res);
        return true;
      }
      const detail = loadRunDetail(runRoot, runId);
      if (!detail) {
        notFound(res);
        return true;
      }
      json(res, 200, detail);
      return true;
    }

    const runEventsMatch = url.pathname.match(/^\/api\/runs\/([^/]+)\/events$/);
    if (runEventsMatch) {
      const runId = decodeURIComponent(runEventsMatch[1] || "");
      if (!isSafeId(runId)) {
        notFound(res);
        return true;
      }
      const events = loadRunEvents(runRoot, runId);
      if (events == null) {
        notFound(res);
        return true;
      }
      json(res, 200, { events });
      return true;
    }

    const logMatch = url.pathname.match(/^\/api\/runs\/([^/]+)\/steps\/([^/]+)\/log$/);
    if (logMatch) {
      const runId = decodeURIComponent(logMatch[1] || "");
      const stepId = decodeURIComponent(logMatch[2] || "");
      if (!isSafeId(runId) || !isSafeId(stepId)) {
        notFound(res);
        return true;
      }
      const logText = loadStepLogText(runRoot, runId, stepId);
      if (logText == null) {
        notFound(res);
        return true;
      }
      text(res, 200, logText);
      return true;
    }

    return false;
  }

  return {
    middleware(req, res, next) {
      if (handleApi(req, res)) {
        return;
      }
      next();
    },
    close() {
      for (const client of sseClients) {
        try {
          client.end();
        } catch {
          // ignore
        }
      }
      sseClients.clear();
      void watcher.close();
    },
  };
}
