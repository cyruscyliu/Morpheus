import test from "node:test";
import assert from "node:assert/strict";

import type { CatalogEntry } from "../src/catalog.js";
import { createCatalogFromReadmes, createToolCatalog } from "../src/lib/catalog-discovery.js";
import {
  countByKind,
  filterCatalog,
  getSelectedEntry,
  renderDetail,
  renderList,
  renderOverview,
  renderSectionNav,
} from "../src/lib/catalog-view.js";

const catalog: CatalogEntry[] = [
  ...createToolCatalog(
    {
      "../../../tools/llbic/tool.json": { name: "llbic" },
      "../../../tools/llcg/tool.json": { name: "llcg" },
      "../../../tools/llbase/tool.json": null,
    },
    {
      "../../../tools/llbase/README.md": "# llbase\n\nShared container runtime images for the LLVM Linux tooling family.",
      "../../../tools/llbic/README.md": "# llbic\n\nCompile Linux kernels to LLVM bitcode and kernel images.",
      "../../../tools/llcg/README.md": "# llcg\n\nGenerate Linux kernel callgraphs from LLVM bitcode inputs.",
    },
  ),
  ...createCatalogFromReadmes(
    {
      "../../../workflows/kernel-callgraph/README.md":
        "# kernel-callgraph\n\nCompile a kernel to LLVM bitcode with llbic, then generate a scoped callgraph with llcg.",
    },
    "workflow",
  ),
];

test("overview rendering uses catalog counts", () => {
  const summary = renderOverview(catalog);
  assert.match(summary, /4 entries/);
  assert.match(summary, /3 tools/);
  assert.match(summary, /1 workflows/);
});

test("list rendering includes paths and selection marker", () => {
  const html = renderList(catalog, "llbic");
  assert.match(html, /tools\/llbic/);
  assert.match(html, /is-selected/);
});

test("section nav renders counts and current state", () => {
  const html = renderSectionNav(catalog, "tool");
  assert.match(html, /tools/);
  assert.match(html, /aria-current="true"/);
});

test("detail rendering includes highlights and commands", () => {
  const entry = catalog[1];
  const html = renderDetail(entry);
  assert.match(html, /<h1>llbic<\/h1>/);
  assert.match(html, /Compile Linux kernels to LLVM bitcode and kernel images\./);
  assert.match(html, /README\.md/);
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

test("tool catalog only includes directories with tool.json", () => {
  const tools = createToolCatalog(
    {
      "../../../tools/buildroot/tool.json": { name: "buildroot" },
    },
    {
      "../../../tools/buildroot/README.md": "# buildroot\n\nBuild Linux images.",
      "../../../tools/llbase/README.md": "# llbase\n\nShared images.",
    },
  );

  assert.equal(tools.length, 1);
  assert.equal(tools[0]?.name, "buildroot");
});
