import type { CatalogEntry, CatalogKind } from "../catalog.js";
import { renderMarkdown } from "./markdown.js";

export function filterCatalog(entries: CatalogEntry[], kind: CatalogKind | "all"): CatalogEntry[] {
  if (kind === "all") {
    return [...entries];
  }
  return entries.filter((entry) => entry.kind === kind);
}

export function countByKind(entries: CatalogEntry[]): Record<CatalogKind, number> {
  return entries.reduce(
    (counts, entry) => {
      counts[entry.kind] += 1;
      return counts;
    },
    { tool: 0, workflow: 0 },
  );
}

export function getSelectedEntry(entries: CatalogEntry[], hash: string): CatalogEntry | null {
  const entryName = decodeURIComponent((hash || "").replace(/^#entry=/, ""));
  if (!entryName) {
    return entries[0] || null;
  }
  return entries.find((entry) => entry.name === entryName) || entries[0] || null;
}

export function renderOverview(entries: CatalogEntry[]): string {
  const counts = countByKind(entries);
  return `${entries.length} entries · ${counts.tool} tools · ${counts.workflow} workflows`;
}

export function renderSectionNav(
  entries: CatalogEntry[],
  activeSection: CatalogKind | "all",
): string {
  const counts = countByKind(entries);
  const items: Array<{ key: CatalogKind | "all"; label: string; count: number }> = [
    { key: "all", label: "all", count: entries.length },
    { key: "tool", label: "tools", count: counts.tool },
    { key: "workflow", label: "workflows", count: counts.workflow },
  ];

  return items
    .map((item) => {
      const current = item.key === activeSection ? 'aria-current="true"' : "";
      return `
        <button class="nav-item" data-section="${item.key}" ${current}>
          <span>${item.label}</span>
          <span class="nav-count">${item.count}</span>
        </button>
      `;
    })
    .join("");
}

export function renderList(entries: CatalogEntry[], selectedName: string | null): string {
  return entries
    .map((entry) => {
      const rowClass = entry.name === selectedName ? "is-selected" : "";
      return `
        <article data-entry-name="${entry.name}" class="entry-item ${rowClass}">
          <a class="entry-link" href="#entry=${encodeURIComponent(entry.name)}">
            <span class="entry-name">${entry.name}</span>
            <span class="entry-summary">${entry.summary}</span>
            <code class="entry-path">${entry.path}</code>
          </a>
        </article>
      `;
    })
    .join("");
}

export function renderDetail(entry: CatalogEntry | null): string {
  if (!entry) {
    return `<p class="empty-state">No catalog entry is available.</p>`;
  }

  return `
    <article class="detail-block markdown-body">
      <div class="readme-meta">
        <span class="status-pill" data-tone="${entry.kind}">${entry.kind}</span>
        <code>${entry.path}/README.md</code>
      </div>
      ${renderMarkdown(entry.readme || `# ${entry.name}\n\nREADME unavailable.`)}
    </article>
  `;
}
