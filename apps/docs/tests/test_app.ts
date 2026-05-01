import test from "node:test";
import assert from "node:assert/strict";

import { extractHeadings, renderMarkdown } from "../lib/markdown";

test("renderMarkdown renders headings and code blocks", () => {
  const html = renderMarkdown([
    "# Title",
    "",
    "1. one",
    "2. two",
    "",
    "```js",
    "x=1",
    "```",
  ].join("\n"));
  assert.match(html, /<h1 id="title">Title<\/h1>/);
  assert.match(html, /<ol>/);
  assert.match(html, /<li>one<\/li>/);
  assert.match(html, /<pre><code[^>]*>/);
  assert.match(html, /x=1/);
});

test("extractHeadings keeps stable heading ids", () => {
  const headings = extractHeadings(["# Title", "## Details", "## Details"].join("\n"));
  assert.deepEqual(headings, [
    { id: "title", level: 1, text: "Title" },
    { id: "details", level: 2, text: "Details" },
    { id: "details-2", level: 2, text: "Details" },
  ]);
});
