import fs from "node:fs/promises";
import path from "node:path";

import type { CatalogEntry } from "@/lib/types";

function repoRootFromDocsApp(): string {
  return path.resolve(process.cwd(), "..", "..");
}

async function readText(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return null;
  }
}

async function readJson(filePath: string): Promise<unknown | null> {
  const text = await readText(filePath);
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function stripFrontmatter(markdown: string): string {
  const normalized = markdown.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  if (lines[0] !== "---") {
    return normalized.trim();
  }
  const end = lines.indexOf("---", 1);
  if (end === -1) {
    return normalized.trim();
  }
  return lines.slice(end + 1).join("\n").trim();
}

function parseSkillDescription(markdown: string): string | null {
  const normalized = markdown.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  if (lines[0] !== "---") {
    return null;
  }
  const end = lines.indexOf("---", 1);
  if (end === -1) {
    return null;
  }
  const fm = lines.slice(1, end);
  for (let index = 0; index < fm.length; index += 1) {
    const line = fm[index];
    const match = /^\s*description:\s*(.*)\s*$/.exec(line);
    if (!match) {
      continue;
    }
    const first = (match[1] || "").trim();
    const parts: string[] = [];
    if (first && !first.endsWith("|") && !first.endsWith(">")) {
      parts.push(first.replace(/^["']|["']$/g, ""));
    }
    for (let next = index + 1; next < fm.length; next += 1) {
      const nextLine = fm[next];
      if (!/^\s+/.test(nextLine)) {
        break;
      }
      parts.push(nextLine.trim());
      index = next;
    }
    const joined = parts.join(" ").trim();
    return joined || null;
  }
  return null;
}

function summarize(markdown: string): string {
  return parseSkillDescription(markdown) || "Documentation available.";
}

function toolNameFromDir(toolDir: string): string {
  return path.basename(toolDir);
}

function skillDirForTool(toolName: string): string {
  return `omssr-${toolName}`;
}

function formatToolJsonMarkdown(toolJson: unknown): string {
  if (!toolJson) {
    return "";
  }
  return [
    "## tool.json",
    "",
    "```json",
    JSON.stringify(toolJson, null, 2),
    "```",
    "",
  ].join("\n");
}

export async function getCatalog(): Promise<CatalogEntry[]> {
  const repoRoot = repoRootFromDocsApp();
  const skillsRoot = path.join(repoRoot, "skills");
  const toolsRoot = path.join(repoRoot, "tools");

  const toolDirs = await fs.readdir(toolsRoot, { withFileTypes: true });
  const toolEntries: CatalogEntry[] = [];

  for (const entry of toolDirs) {
    if (!entry.isDirectory()) {
      continue;
    }
    const toolName = toolNameFromDir(entry.name);
    const toolJsonPath = path.join(toolsRoot, toolName, "tool.json");
    const toolJson = await readJson(toolJsonPath);
    if (!toolJson) {
      continue;
    }

    const skillDir = skillDirForTool(toolName);
    const skillPath = path.join(skillsRoot, skillDir, "SKILL.md");
    const skillMarkdown = await readText(skillPath);
    const body = stripFrontmatter(skillMarkdown || `# ${toolName}\n\nSKILL.md unavailable.`);

    toolEntries.push({
      name: toolName,
      kind: "tool",
      summary: summarize(skillMarkdown || ""),
      source: `skills/${skillDir}/SKILL.md`,
      markdown: `${formatToolJsonMarkdown(toolJson)}${body}\n`,
    });
  }

  const appEntries: CatalogEntry[] = [];
  {
    const morpheusSkill = path.join(skillsRoot, "omssr-morpheus", "SKILL.md");
    const markdown = await readText(morpheusSkill);
    if (markdown) {
      appEntries.push({
        name: "morpheus",
        kind: "app",
        summary: summarize(markdown),
        source: "skills/omssr-morpheus/SKILL.md",
        markdown: stripFrontmatter(markdown),
      });
    }
  }

  return [...toolEntries.sort((a, b) => a.name.localeCompare(b.name)), ...appEntries];
}

