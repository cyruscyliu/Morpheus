"use client";

import { useEffect, useState } from "react";

import { parseTextDocument } from "@/lib/outline-text";

type VersionItem = {
  name: string;
  isCurrent: boolean;
};

type VersionsPayload = {
  current: {
    name: string;
    target: string | null;
  } | null;
  versions: VersionItem[];
};

type DocumentPayload = {
  name: string;
  path: string;
  text: string;
};

export function OutlineEditor() {
  const [versions, setVersions] = useState<VersionsPayload | null>(null);
  const [selectedName, setSelectedName] = useState("current-outline.json");
  const [baseName, setBaseName] = useState("current-outline.json");
  const [text, setText] = useState("");
  const [status, setStatus] = useState("Loading outline...");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function loadVersions() {
    const response = await fetch("/api/outline/versions");
    const payload = await response.json();
    setVersions(payload);
  }

  async function loadDocument(name: string) {
    setError(null);
    setStatus("Loading document...");
    const response = await fetch(`/api/outline/document?name=${encodeURIComponent(name)}`);
    const payload = (await response.json()) as DocumentPayload;
    setText(payload.text);
    setSelectedName(name);
    setBaseName(name);
    setStatus(payload.path);
  }

  useEffect(() => {
    loadVersions()
      .then(() => loadDocument("current-outline.json"))
      .catch((loadError) => {
        setError(loadError instanceof Error ? loadError.message : String(loadError));
        setStatus("Failed to load outline files.");
      });
  }, []);

  async function save(makeCurrent: boolean) {
    setSaving(true);
    setError(null);
    setStatus(makeCurrent ? "Saving and updating current outline..." : "Saving new outline version...");
    try {
      const response = await fetch("/api/outline/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseName,
          text,
          makeCurrent,
        }),
      });
      const payload = await response.json();
      await loadVersions();
      await loadDocument(makeCurrent ? "current-outline.json" : payload.version);
      setStatus(makeCurrent ? `Saved and promoted ${payload.version}` : `Saved ${payload.version}`);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
      setStatus("Save failed.");
    } finally {
      setSaving(false);
    }
  }

  const parsed = parseTextDocument(text);

  return (
    <div className="outline-shell">
      <aside className="outline-sidebar">
        <h1 style={{ margin: 0, fontSize: "1.35rem" }}>Outline Editor</h1>
        <p className="sidebar-caption" style={{ marginTop: 8 }}>
          Edit plain text. Arguments render as body text. Supports render as bullets with a subtle wash.
        </p>
        <div className="outline-version-list">
          <button
            className={`outline-version-button${selectedName === "current-outline.json" ? " is-active" : ""}`}
            type="button"
            onClick={() => void loadDocument("current-outline.json")}
          >
            <span className="outline-version-label">current-outline.json</span>
            <span className="outline-version-meta">
              {versions?.current?.target ? `points to ${versions.current.target}` : "workspace current outline"}
            </span>
          </button>
          {versions?.versions.map((version) => (
            <button
              key={version.name}
              className={`outline-version-button${selectedName === version.name ? " is-active" : ""}`}
              type="button"
              onClick={() => void loadDocument(version.name)}
            >
              <span className="outline-version-label">{version.name}</span>
              <span className="outline-version-meta">
                {version.isCurrent ? "current target" : "version snapshot"}
              </span>
            </button>
          ))}
        </div>
        {error ? <p className="sidebar-error">{error}</p> : null}
      </aside>
      <main className="outline-main">
        <div className="outline-topbar">
          <div>
            <strong>{selectedName}</strong>
            <div className={error ? "outline-status is-error" : "outline-status"}>{error || status}</div>
          </div>
          <div className="outline-actions">
            <button className="outline-button" type="button" disabled={saving} onClick={() => void save(false)}>
              Save New Version
            </button>
            <button className="outline-button is-primary" type="button" disabled={saving} onClick={() => void save(true)}>
              Save And Make Current
            </button>
          </div>
        </div>
        <div className="outline-grid">
          <section className="outline-editor-pane">
            <div className="outline-pane-header">
              <h2 className="outline-pane-title">Plain Text</h2>
              <p className="outline-pane-caption">Use `#` for sections, `&gt;` for purpose, and `-` for supports.</p>
            </div>
            <textarea
              className="outline-textarea"
              spellCheck={false}
              value={text}
              onChange={(event) => setText(event.target.value)}
            />
          </section>
          <section className="outline-preview-pane">
            <div className="outline-pane-header">
              <h2 className="outline-pane-title">Rendered Text</h2>
              <p className="outline-pane-caption">Arguments and supports are visually distinguished without metadata labels.</p>
            </div>
            <div className="preview-doc">
              <h1 className="preview-title">{parsed.title || "Untitled outline"}</h1>
              {parsed.sections.map((section) => (
                <section key={section.title} className="preview-section">
                  <h2 className="preview-section-title">{section.title}</h2>
                  {section.purpose ? <p className="preview-purpose">{section.purpose}</p> : null}
                  {section.arguments.map((argument, index) => (
                    <div key={`${section.title}-${index}`}>
                      <p className="preview-argument">{argument.text}</p>
                      {argument.supports.length > 0 ? (
                        <ul className="preview-supports">
                          {argument.supports.map((support, supportIndex) => (
                            <li key={`${section.title}-${index}-${supportIndex}`}>{support}</li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                  ))}
                </section>
              ))}
              {parsed.references.length > 0 ? (
                <section className="preview-references">
                  <h2 className="preview-section-title">References</h2>
                  {parsed.references.map((reference) => (
                    <div className="preview-reference-item" key={`${reference.citationKey}-${reference.title}`}>
                      <strong>{reference.citationKey}</strong>
                      {reference.title ? ` | ${reference.title}` : ""}
                    </div>
                  ))}
                </section>
              ) : null}
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
