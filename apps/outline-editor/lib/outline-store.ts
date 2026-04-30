import fs from "node:fs";
import path from "node:path";

import type { OutlineDocument } from "@/lib/outline-text";

type VersionedOutline = {
  schema_version: number;
  version_id: string;
  updated_at: string;
  source: string | null;
  workflow_run_id: string | null;
  step_id: string | null;
  outline: OutlineDocument;
};

function repoRoot() {
  return path.resolve(process.cwd(), "..", "..");
}

export function workspaceRoot() {
  const configured = String(process.env.OUTLINE_WORKSPACE_ROOT || "hyperarm-workspace-o2p").trim();
  return path.resolve(repoRoot(), configured);
}

export function currentOutlinePath() {
  return path.join(workspaceRoot(), "current-outline.json");
}

export function versionsDir() {
  return path.join(workspaceRoot(), "outline-versions");
}

export function listOutlineFiles() {
  const root = workspaceRoot();
  const currentPath = currentOutlinePath();
  const versions = fs.existsSync(versionsDir())
    ? fs.readdirSync(versionsDir())
        .filter((name) => /^outline-v\d+\.json$/.test(name))
        .sort()
    : [];
  const currentTarget = fs.existsSync(currentPath) && fs.lstatSync(currentPath).isSymbolicLink()
    ? path.basename(fs.readlinkSync(currentPath))
    : null;
  return {
    workspace: root,
    current: fs.existsSync(currentPath) ? {
      name: "current-outline.json",
      target: currentTarget,
    } : null,
    versions: versions.map((name) => ({
      name,
      isCurrent: name === currentTarget,
    })),
  };
}

function readJson(filePath: string) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

export function resolveOutlineFile(name: string) {
  if (name === "current-outline.json") {
    return currentOutlinePath();
  }
  return path.join(versionsDir(), name);
}

export function readOutlineFile(name: string) {
  const filePath = resolveOutlineFile(name);
  const raw = readJson(filePath);
  if (raw && raw.schema_version === 1 && raw.outline) {
    return {
      name,
      path: filePath,
      versioned: true,
      metadata: raw,
      outline: raw.outline as OutlineDocument,
    };
  }
  return {
    name,
    path: filePath,
    versioned: false,
    metadata: null,
    outline: raw as OutlineDocument,
  };
}

function nextVersionName() {
  fs.mkdirSync(versionsDir(), { recursive: true });
  const existing = fs.readdirSync(versionsDir())
    .map((name) => {
      const match = name.match(/^outline-v(\d+)\.json$/);
      return match ? Number(match[1]) : null;
    })
    .filter((value): value is number => Number.isFinite(value));
  const next = (existing.length > 0 ? Math.max(...existing) : 0) + 1;
  return `outline-v${String(next).padStart(4, "0")}.json`;
}

export function saveOutlineVersion(outline: OutlineDocument, options: { makeCurrent: boolean }) {
  const versionName = nextVersionName();
  const versionPath = path.join(versionsDir(), versionName);
  const currentPath = currentOutlinePath();
  const payload: VersionedOutline = {
    schema_version: 1,
    version_id: versionName.replace(/\.json$/, ""),
    updated_at: new Date().toISOString(),
    source: "outline-editor",
    workflow_run_id: null,
    step_id: null,
    outline,
  };
  fs.writeFileSync(versionPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  if (options.makeCurrent) {
    try {
      fs.unlinkSync(currentPath);
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") {
        throw error;
      }
    }
    fs.symlinkSync(path.relative(path.dirname(currentPath), versionPath), currentPath);
  }
  return {
    versionName,
    versionPath,
    currentPath: options.makeCurrent ? currentPath : null,
  };
}
