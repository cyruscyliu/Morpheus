import test from "node:test";
import assert from "node:assert/strict";

import type { CatalogEntry } from "../src/catalog.js";
import { createAppCatalogFromSkills, createToolCatalogFromSkills } from "../src/lib/catalog-discovery.js";
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
  ...createToolCatalogFromSkills(
    {
      "../../../tools/llbic/tool.json": { name: "llbic" },
      "../../../tools/llcg/tool.json": { name: "llcg" },
      "../../../tools/llbase/tool.json": null,
    },
    {
      "../../../skills/omssr-llbic/SKILL.md": [
        "---",
        "name: llbic",
        "description: Compile Linux kernels to LLVM bitcode and kernel images.",
        "---",
        "",
        "# llbic Skill",
        "",
        "Use this skill when you need llbic.",
      ].join("\n"),
      "../../../skills/omssr-llcg/SKILL.md": [
        "---",
        "name: llcg",
        "description: Generate Linux kernel callgraphs from LLVM bitcode inputs.",
        "---",
        "",
        "# llcg Skill",
        "",
        "Use this skill when you need llcg.",
      ].join("\n"),
    },
  ),
  ...createAppCatalogFromSkills(
    {
      "../../../skills/omssr-morpheus/SKILL.md": [
        "---",
        "name: morpheus",
        "description: Manage workspaces and workflow runs.",
        "---",
        "",
        "# morpheus Skill",
        "",
        "Use this skill when you need morpheus.",
      ].join("\n"),
    },
  ),
];

test("overview rendering uses catalog counts", () => {
  const summary = renderOverview(catalog);
  assert.match(summary, /3 entries/);
  assert.match(summary, /2 tools/);
  assert.match(summary, /1 apps/);
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
  assert.match(html, /SKILL\.md/);
});

test("filtering and counts reflect tools and apps", () => {
  const tools = filterCatalog(catalog, "tool");
  assert.equal(tools.length, 2);

  const counts = countByKind(catalog);
  assert.equal(counts.tool, 2);
  assert.equal(counts.app, 1);
});

test("selection falls back to the first entry when the hash is missing", () => {
  assert.equal(getSelectedEntry(catalog, "")?.name, "llbase");
  assert.equal(getSelectedEntry(catalog, "#entry=morpheus")?.name, "morpheus");
});

test("tool catalog only includes directories with tool.json", () => {
  const tools = createToolCatalogFromSkills(
    {
      "../../../tools/buildroot/tool.json": { name: "buildroot" },
    },
    {
      "../../../skills/omssr-buildroot/SKILL.md": [
        "---",
        "name: buildroot",
        "description: Build Linux images.",
        "---",
        "",
        "# buildroot Skill",
      ].join("\n"),
    },
  );

  assert.equal(tools.length, 1);
  assert.equal(tools[0]?.name, "buildroot");
});
