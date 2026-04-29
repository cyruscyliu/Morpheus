"use client";

import { useMemo, useState } from "react";

import type { CatalogEntry, CatalogKind } from "@/lib/types";
import { renderMarkdown } from "@/lib/markdown";

function byName(a: CatalogEntry, b: CatalogEntry) {
  return a.name.localeCompare(b.name);
}

function countByKind(entries: CatalogEntry[]) {
  return entries.reduce(
    (acc, entry) => {
      acc[entry.kind] += 1;
      return acc;
    },
    { tool: 0, app: 0 } satisfies Record<CatalogKind, number>,
  );
}

function filterByKind(entries: CatalogEntry[], kind: CatalogKind | "all") {
  if (kind === "all") {
    return entries;
  }
  return entries.filter((entry) => entry.kind === kind);
}

export function DocsShell({ entries }: { entries: CatalogEntry[] }) {
  const [section, setSection] = useState<CatalogKind | "all">("all");
  const [selectedName, setSelectedName] = useState<string | null>(entries[0]?.name ?? null);

  const filtered = useMemo(() => filterByKind(entries, section).slice().sort(byName), [entries, section]);
  const selected = useMemo(() => {
    if (!filtered.length) {
      return null;
    }
    return filtered.find((entry) => entry.name === selectedName) ?? filtered[0] ?? null;
  }, [filtered, selectedName]);

  const counts = useMemo(() => countByKind(entries), [entries]);

  return (
    <div className="docs-shell">
      <header className="docs-topbar">
        <div className="flex items-center gap-2">
          <strong>Morpheus</strong>
          <span className="text-sm text-muted-foreground">Docs</span>
        </div>
        <div className="text-sm text-muted-foreground">
          tools:{counts.tool} apps:{counts.app} total:{entries.length}
        </div>
      </header>

      <main className="docs-main">
        <aside className="docs-pane">
          <div className="docs-pane-header">
            <div>
              <h2 className="docs-pane-title">Sections</h2>
              <p className="docs-pane-caption">Filter catalog entries</p>
            </div>
          </div>
          <div className="docs-pane-body flex flex-col gap-2">
            {(
              [
                { key: "all", label: `all (${entries.length})` },
                { key: "tool", label: `tools (${counts.tool})` },
                { key: "app", label: `apps (${counts.app})` },
              ] as const
            ).map((item) => (
              <button
                key={item.key}
                className={[
                  "text-left rounded-md border px-3 py-2 text-sm font-semibold transition-colors",
                  section === item.key
                    ? "border-primary/40 bg-muted text-foreground"
                    : "border-border bg-card text-muted-foreground hover:text-foreground hover:border-primary/40",
                ].join(" ")}
                onClick={() => {
                  setSection(item.key);
                  const nextFiltered = filterByKind(entries, item.key).slice().sort(byName);
                  setSelectedName(nextFiltered[0]?.name ?? null);
                }}
                type="button"
              >
                {item.label}
              </button>
            ))}
          </div>
        </aside>

        <section className="docs-pane">
          <div className="docs-pane-header">
            <div>
              <h2 className="docs-pane-title">Catalog</h2>
              <p className="docs-pane-caption">{filtered.length} entries</p>
            </div>
          </div>
          <div className="docs-pane-body flex flex-col gap-2">
            {filtered.map((entry) => {
              const active = entry.name === selected?.name;
              return (
                <button
                  key={`${entry.kind}:${entry.name}`}
                  className={[
                    "text-left rounded-md border px-3 py-2 transition-colors",
                    active
                      ? "border-primary/40 bg-muted text-foreground"
                      : "border-border bg-card text-foreground hover:border-primary/40",
                  ].join(" ")}
                  onClick={() => setSelectedName(entry.name)}
                  type="button"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-semibold">{entry.name}</span>
                    <code className="text-xs text-muted-foreground">{entry.kind}</code>
                  </div>
                  <div className="mt-1 text-sm text-muted-foreground">{entry.summary}</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    <code>{entry.source}</code>
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        <section className="docs-pane">
          <div className="docs-pane-header">
            <div>
              <h2 className="docs-pane-title">Docs</h2>
              <p className="docs-pane-caption">{selected ? selected.source : "Select an entry"}</p>
            </div>
          </div>
          <div className="docs-pane-body">
            {selected ? (
              <article
                className="markdown-body"
                dangerouslySetInnerHTML={{ __html: renderMarkdown(selected.markdown) }}
              />
            ) : (
              <p className="text-sm text-muted-foreground">No entry available.</p>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}

