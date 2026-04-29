import type { CatalogEntry, CatalogKind } from "../catalog.js";

function stripSkillFrontmatter(markdown: string): { frontmatter: string | null; body: string } {
  const normalized = markdown.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  if (lines[0] !== "---") {
    return { frontmatter: null, body: normalized };
  }
  const end = lines.indexOf("---", 1);
  if (end === -1) {
    return { frontmatter: null, body: normalized };
  }
  return {
    frontmatter: lines.slice(1, end).join("\n"),
    body: lines.slice(end + 1).join("\n"),
  };
}

function parseSkillName(frontmatter: string | null, fallback: string): string {
  if (!frontmatter) {
    return fallback;
  }
  const match = frontmatter.match(/^\s*name:\s*(.+?)\s*$/m);
  if (!match) {
    return fallback;
  }
  return match[1].trim().replace(/^["']|["']$/g, "") || fallback;
}

function parseSkillDescription(frontmatter: string | null): string | null {
  if (!frontmatter) {
    return null;
  }

  const lines = frontmatter.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const match = /^\s*description:\s*(.*)\s*$/.exec(line);
    if (!match) {
      continue;
    }
    const first = (match[1] || "").trim();
    const parts: string[] = [];
    if (first && !first.endsWith("|") && !first.endsWith(">")) {
      parts.push(first.replace(/^["']|["']$/g, ""));
    }
    for (let next = index + 1; next < lines.length; next += 1) {
      const nextLine = lines[next];
      if (!/^\s+/.test(nextLine)) {
        break;
      }
      parts.push(nextLine.trim().replace(/^["']|["']$/g, ""));
      index = next;
    }
    const joined = parts.join(" ").trim();
    return joined || null;
  }

  return null;
}

function summarizeDoc(markdown: string): string {
  const { frontmatter, body } = stripSkillFrontmatter(markdown);
  const description = parseSkillDescription(frontmatter);
  if (description) {
    return description;
  }

  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const paragraph: string[] = [];
  let inCodeBlock = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.startsWith("```")) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock || !line) {
      if (paragraph.length > 0) {
        break;
      }
      continue;
    }
    if (
      line.startsWith("#") ||
      line.startsWith("[!") ||
      line.startsWith("![") ||
      line.startsWith("- ") ||
      line.startsWith("* ") ||
      /^\d+\.\s+/.test(line)
    ) {
      if (paragraph.length > 0) {
        break;
      }
      continue;
    }
    paragraph.push(line);
  }

  return paragraph.join(" ") || "Documentation available.";
}

function normalizeSkillBody(markdown: string): string {
  return stripSkillFrontmatter(markdown).body.trim() || markdown.trim();
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

function guessSkillDirName(toolName: string): string[] {
  return [`omssr-${toolName}`, toolName];
}

function findSkillForName(
  skills: Record<string, string>,
  name: string,
): { source: string; markdown: string } | null {
  for (const candidate of guessSkillDirName(name)) {
    const suffix = `/skills/${candidate}/SKILL.md`;
    const hit = Object.entries(skills).find(([key]) => key.endsWith(suffix));
    if (hit) {
      return { source: hit[0], markdown: hit[1] };
    }
  }

  const entries = Object.entries(skills);
  for (const [source, markdown] of entries) {
    const fallback = source.split("/").slice(-2, -1)[0] || name;
    const parsed = parseSkillName(stripSkillFrontmatter(markdown).frontmatter, fallback);
    if (parsed === name) {
      return { source, markdown };
    }
  }

  return null;
}

export function createToolCatalogFromSkills(
  descriptors: Record<string, unknown>,
  skills: Record<string, string>,
): CatalogEntry[] {
  const entries: Array<CatalogEntry | null> = Object.keys(descriptors)
    .map((sourcePath) => {
      const match = sourcePath.match(/tools\/([^/]+)\/tool\.json$/);
      if (!match) {
        return null;
      }

      const name = match[1];
      const toolJson = descriptors[sourcePath];
      const skill = findSkillForName(skills, name);
      const fallbackSkill = `# ${name}\n\nSKILL.md unavailable.`;
      const body = normalizeSkillBody(skill?.markdown || fallbackSkill);
      const readme = `${formatToolJsonMarkdown(toolJson)}${body}\n`;
      return {
        name,
        kind: "tool",
        path: `tools/${name}`,
        summary: summarizeDoc(skill?.markdown || fallbackSkill),
        source: skill ? skill.source.replace(/^.*?skills\//, "skills/") : "SKILL.md unavailable",
        readme,
      };
    });

  return entries
    .filter((entry): entry is CatalogEntry => entry !== null)
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function createAppCatalogFromSkills(
  skills: Record<string, string>,
): CatalogEntry[] {
  const entries: Array<CatalogEntry | null> = Object.entries(skills).map(([sourcePath, markdown]) => {
    const match = sourcePath.match(/skills\/([^/]+)\/SKILL\.md$/);
    if (!match) {
      return null;
    }
    const skillDir = match[1];
    const fallback = skillDir.replace(/^omssr-/, "");
    const parts = stripSkillFrontmatter(markdown);
    const name = parseSkillName(parts.frontmatter, fallback);
    if (name !== "morpheus") {
      return null;
    }
    const body = normalizeSkillBody(markdown);
    return {
      name,
      kind: "app",
      path: `apps/${name}`,
      summary: summarizeDoc(markdown),
      source: sourcePath.replace(/^.*?skills\//, "skills/"),
      readme: body,
    };
  });

  return entries
    .filter((entry): entry is CatalogEntry => entry !== null)
    .sort((left, right) => left.name.localeCompare(right.name));
}
