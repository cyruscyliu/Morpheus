import type { CatalogEntry, CatalogKind } from "../catalog.js";

function summarizeReadme(markdown: string): string {
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

  return paragraph.join(" ") || "README available.";
}

export function createCatalogFromReadmes(
  modules: Record<string, string>,
  kind: CatalogKind,
): CatalogEntry[] {
  return Object.entries(modules)
    .map(([sourcePath, readme]) => {
      const match = sourcePath.match(/(?:tools|workflows)\/([^/]+)\/README\.md$/);
      if (!match) {
        return null;
      }

      const name = match[1];
      const root = kind === "tool" ? "tools" : "workflows";
      return {
        name,
        kind,
        path: `${root}/${name}`,
        summary: summarizeReadme(readme),
        readme,
      };
    })
    .filter((entry): entry is CatalogEntry => entry !== null)
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function createToolCatalog(
  descriptors: Record<string, unknown>,
  readmes: Record<string, string>,
): CatalogEntry[] {
  const entries: Array<CatalogEntry | null> = Object.keys(descriptors)
    .map((sourcePath) => {
      const match = sourcePath.match(/tools\/([^/]+)\/tool\.json$/);
      if (!match) {
        return null;
      }

      const name = match[1];
      const readmePath = sourcePath.replace(/tool\.json$/, "README.md");
      const readme = readmes[readmePath] || `# ${name}\n\nREADME unavailable.`;
      return {
        name,
        kind: "tool",
        path: `tools/${name}`,
        summary: summarizeReadme(readme),
        readme,
      };
    });

  return entries
    .filter((entry): entry is CatalogEntry => entry !== null)
    .sort((left, right) => left.name.localeCompare(right.name));
}
