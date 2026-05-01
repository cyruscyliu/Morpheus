"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import type { CatalogEntry, CatalogKind } from "@/lib/types";
import { extractHeadings, renderMarkdown } from "@/lib/markdown";

function byName(a: CatalogEntry, b: CatalogEntry) {
  if (a.name.toLowerCase() === "morpheus" && b.name.toLowerCase() !== "morpheus") {
    return -1;
  }
  if (b.name.toLowerCase() === "morpheus" && a.name.toLowerCase() !== "morpheus") {
    return 1;
  }
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

function defaultSelectedName(entries: CatalogEntry[], kind: CatalogKind | "all") {
  const filtered = filterByKind(entries, kind).slice().sort(byName);
  return filtered[0]?.name ?? null;
}

const sectionStorageKey = "morpheus-docs-section";
const selectedStorageKey = "morpheus-docs-selected";
const docsScrollStorageKey = "morpheus-docs-scroll";

function isSavedSection(value: string | null): value is CatalogKind | "all" {
  return value === "all" || value === "tool" || value === "app";
}

export function DocsShell({ entries }: { entries: CatalogEntry[] }) {
  const [section, setSection] = useState<CatalogKind | "all">("all");
  const [selectedName, setSelectedName] = useState<string | null>(() => defaultSelectedName(entries, "all"));
  const docsPaneRef = useRef<HTMLDivElement | null>(null);
  const restoreScrollRef = useRef<number | null>(null);
  const previousSelectedRef = useRef<string | null>(selectedName);

  const filtered = useMemo(() => filterByKind(entries, section).slice().sort(byName), [entries, section]);
  const selected = useMemo(() => {
    if (!filtered.length) {
      return null;
    }
    return filtered.find((entry) => entry.name === selectedName) ?? filtered[0] ?? null;
  }, [filtered, selectedName]);

  const counts = useMemo(() => countByKind(entries), [entries]);
  const headings = useMemo(
    () => (selected ? extractHeadings(selected.markdown).filter((heading) => heading.level <= 3) : []),
    [selected],
  );

  useEffect(() => {
    const savedSection = window.localStorage.getItem(sectionStorageKey);
    const nextSection = isSavedSection(savedSection) ? savedSection : "all";
    const nextSelected = window.localStorage.getItem(selectedStorageKey);
    const nextScroll = window.localStorage.getItem(docsScrollStorageKey);

    setSection(nextSection);
    setSelectedName(
      nextSelected && entries.some((entry) => entry.name === nextSelected)
        ? nextSelected
        : defaultSelectedName(entries, nextSection),
    );
    restoreScrollRef.current = nextScroll ? Number.parseInt(nextScroll, 10) : 0;
  }, [entries]);

  useEffect(() => {
    window.localStorage.setItem(sectionStorageKey, section);
  }, [section]);

  useEffect(() => {
    if (selectedName) {
      window.localStorage.setItem(selectedStorageKey, selectedName);
      return;
    }
    window.localStorage.removeItem(selectedStorageKey);
  }, [selectedName]);

  useEffect(() => {
    const docsPane = docsPaneRef.current;
    if (!docsPane || !selected?.name) {
      return;
    }

    if (restoreScrollRef.current !== null) {
      docsPane.scrollTop = restoreScrollRef.current;
      restoreScrollRef.current = null;
      previousSelectedRef.current = selected.name;
      return;
    }

    if (previousSelectedRef.current !== selected.name) {
      docsPane.scrollTop = 0;
      previousSelectedRef.current = selected.name;
    }
  }, [selected]);

  return (
    <div className="docs-shell">
      <header className="docs-topbar">
        <div className="flex items-center gap-2">
          <strong>Morpheus</strong>
          <span className="text-sm text-muted-foreground">Docs</span>
        </div>
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <a
            className="docs-repo-link"
            aria-label="Open repository"
            href="https://github.com/cyruscyliu/Morpheus"
            rel="noreferrer"
            target="_blank"
          >
            <svg
              aria-hidden="true"
              fill="currentColor"
              height="18"
              viewBox="0 0 16 16"
              width="18"
            >
              <path d="M8 0C3.58 0 0 3.58 0 8a8 8 0 0 0 5.47 7.59c.4.07.55-.17.55-.38
              0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52
              0-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.5-1.07-1.78-.2-3.64-.89-3.64-3.95
              0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.5 7.5 0 0 1 4 0c1.53-1.04
              2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54
              1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8 8 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
            </svg>
          </a>
          <span>
            tools:{counts.tool} apps:{counts.app} total:{entries.length}
          </span>
        </div>
      </header>

      <main className="docs-main">
        <aside className="docs-pane">
          <div className="docs-pane-header">
            <div>
              <h2 className="docs-pane-title">Tools</h2>
              <p className="docs-pane-caption">{filtered.length} entries</p>
            </div>
          </div>
          <div className="docs-pane-body flex flex-col gap-2">
            <div className="docs-filter-row">
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
                    setSelectedName(defaultSelectedName(entries, item.key));
                  }}
                  type="button"
                >
                  {item.label}
                </button>
              ))}
            </div>
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
                </button>
              );
            })}
          </div>
        </aside>

        <section className="docs-pane">
          <div className="docs-pane-header">
            <div>
              <h2 className="docs-pane-title">Docs</h2>
              <p className="docs-pane-caption">{selected ? selected.source : "Select an entry"}</p>
            </div>
          </div>
          <div className="docs-pane-body docs-content-shell">
            <aside className="docs-toc">
              {headings.length > 0 ? (
                <nav className="docs-toc-list">
                  {headings.map((heading) => (
                    <a
                      className={`docs-toc-link docs-toc-level-${heading.level}`}
                      href={`#${heading.id}`}
                      key={heading.id}
                    >
                      {heading.text}
                    </a>
                  ))}
                </nav>
              ) : (
                <p className="docs-toc-empty">No headings</p>
              )}
            </aside>
            <div
              className="docs-content-scroll"
              onScroll={(event) => {
                window.localStorage.setItem(docsScrollStorageKey, String(event.currentTarget.scrollTop));
              }}
              ref={docsPaneRef}
            >
              {selected ? (
                <article
                  className="markdown-body"
                  dangerouslySetInnerHTML={{ __html: renderMarkdown(selected.markdown) }}
                />
              ) : (
                <p className="text-sm text-muted-foreground">No entry available.</p>
              )}
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
