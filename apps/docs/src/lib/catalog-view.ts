import type { CatalogEntry, CatalogKind } from "../catalog.js";

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
  const cards: Array<[string, number]> = [
    ["Catalog entries", entries.length],
    ["Tools", counts.tool],
    ["Workflows", counts.workflow],
  ];
  return cards
    .map(
      ([label, value]) =>
        `<article class="card"><span class="muted">${label}</span><strong>${value}</strong></article>`,
    )
    .join("");
}

export function renderTable(entries: CatalogEntry[], selectedName: string | null): string {
  return entries
    .map((entry) => {
      const rowClass = entry.name === selectedName ? "is-selected" : "";
      return `
        <tr data-entry-name="${entry.name}" class="${rowClass}">
          <td>
            <a class="repo-link" href="#entry=${encodeURIComponent(entry.name)}">${entry.name}</a>
          </td>
          <td>${entry.kind}</td>
          <td>${entry.summary}</td>
          <td><code>${entry.path}</code></td>
        </tr>
      `;
    })
    .join("");
}

export function renderDetail(entry: CatalogEntry | null): string {
  if (!entry) {
    return `<p class="empty-state">No catalog entry is available.</p>`;
  }

  const highlights = entry.highlights.map((item) => `<li>${item}</li>`).join("");
  const commands = entry.commands.map((item) => `<li><code>${item}</code></li>`).join("");

  return `
    <div class="detail-grid">
      <div class="detail-block">
        <h3>${entry.name}</h3>
        <p>${entry.description}</p>
      </div>
      <div class="detail-block">
        <h3>Kind</h3>
        <p><span class="status-pill" data-tone="${entry.kind}">${entry.kind}</span></p>
      </div>
      <div class="detail-block">
        <h3>Path</h3>
        <p><code>${entry.path}</code></p>
      </div>
    </div>
    <div class="detail-block">
      <h3>Highlights</h3>
      <ul class="commit-list">${highlights}</ul>
    </div>
    <div class="detail-block">
      <h3>Example commands</h3>
      <ul class="commit-list">${commands}</ul>
    </div>
  `;
}
