import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import {
  filterRepos,
  getSelectedRepo,
  renderDetail,
  renderOverview,
  renderTable,
  sortRepos,
} from "../src/app.mjs";

const snapshot = JSON.parse(fs.readFileSync(new URL("./fixtures/sample_snapshot.json", import.meta.url), "utf8"));

test("overview rendering uses aggregate counts", () => {
  const html = renderOverview(snapshot);
  assert.match(html, /Tracked repos/);
  assert.match(html, />2</);
  assert.match(html, /Drifting/);
});

test("table rendering includes drift values and selection marker", () => {
  const html = renderTable(snapshot.repos, "beta/forked");
  assert.match(html, /beta\/forked/);
  assert.match(html, /-27\/\+1/);
  assert.match(html, /is-selected/);
});

test("detail rendering includes fork metadata and commit details", () => {
  const repo = snapshot.repos[0];
  const html = renderDetail(repo);
  assert.match(html, /Primary project/);
  assert.match(html, /Ship update/);
  assert.match(html, /Open on GitHub/);
});

test("filtering and sorting keep repo logic deterministic", () => {
  const onlyForks = filterRepos(snapshot.repos, { status: "all", type: "fork" });
  assert.equal(onlyForks.length, 1);
  assert.equal(onlyForks[0].id, "beta/forked");

  const byDrift = sortRepos(snapshot.repos, "drift");
  assert.equal(byDrift[0].id, "beta/forked");
});

test("selection falls back to the first repo when the hash is missing", () => {
  assert.equal(getSelectedRepo(snapshot, "").id, "alpha/project");
  assert.equal(getSelectedRepo(snapshot, "#repo=beta%2Fforked").id, "beta/forked");
});

