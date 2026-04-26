import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";

import chokidar from "chokidar";

import { findRunRoot } from "./run-root.js";
import { debounce } from "./debounce.js";
import { loadRunDetail, loadStepLogText, listRunSummariesWithTotal } from "./runs-store.js";
import { isSafeId } from "./validate.js";

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

export function createRunsViewerServer(options: Options): RunsViewerServer {
  void options;
  const repoRoot = path.resolve(process.cwd(), "..", "..");
  const runRootInfo = findRunRoot({ startDir: process.cwd(), repoRoot });
  const { runRoot } = runRootInfo;
  const sseClients = new Set<ServerResponse>();

  const broadcastRunsChanged = debounce(() => {
    for (const client of sseClients) {
      writeSse(client, "runs-changed", { updatedAt: new Date().toISOString() });
    }
  }, 250);

  const watcher = chokidar.watch(runRoot, {
    ignoreInitial: true,
    depth: 5,
  });
  watcher.on("add", broadcastRunsChanged);
  watcher.on("change", broadcastRunsChanged);
  watcher.on("unlink", broadcastRunsChanged);
  watcher.on("addDir", broadcastRunsChanged);
  watcher.on("unlinkDir", broadcastRunsChanged);

  function handleApi(req: IncomingMessage, res: ServerResponse): boolean {
    if (req.method !== "GET") {
      return false;
    }

    const url = requestPath(req);
    if (!url) {
      notFound(res);
      return true;
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
