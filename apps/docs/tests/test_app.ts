import test from "node:test";
import assert from "node:assert/strict";

import { getCatalog } from "../src/catalog.js";
import {
  countByKind,
  filterCatalog,
  getSelectedEntry,
  renderDetail,
  renderOverview,
  renderTable,
} from "../src/lib/catalog-view.js";

const catalog = getCatalog();

test("overview rendering uses catalog counts", () => {
  const html = renderOverview(catalog);
  assert.match(html, /Catalog entries/);
  assert.match(html, />4</);
  assert.match(html, /Workflows/);
});

test("table rendering includes paths and selection marker", () => {
  const html = renderTable(catalog, "llbic");
  assert.match(html, /tools\/llbic/);
  assert.match(html, /is-selected/);
});

test("detail rendering includes highlights and commands", () => {
  const entry = catalog[1];
  const html = renderDetail(entry);
  assert.match(html, /Kernel build automation/);
  assert.match(html, /llbic build 6\.18\.16/);
});

test("filtering and counts reflect tools and workflows", () => {
  const tools = filterCatalog(catalog, "tool");
  assert.equal(tools.length, 3);

  const counts = countByKind(catalog);
  assert.equal(counts.tool, 3);
  assert.equal(counts.workflow, 1);
});

test("selection falls back to the first entry when the hash is missing", () => {
  assert.equal(getSelectedEntry(catalog, "")?.name, "llbase");
  assert.equal(getSelectedEntry(catalog, "#entry=kernel-callgraph")?.name, "kernel-callgraph");
});
