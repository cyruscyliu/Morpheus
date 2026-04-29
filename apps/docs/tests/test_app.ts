import test from "node:test";
import assert from "node:assert/strict";

import { renderMarkdown } from "../lib/markdown";

test("renderMarkdown renders headings and code blocks", () => {
  const html = renderMarkdown(["# Title", "", "```", "x=1", "```"].join("\n"));
  assert.match(html, /<h1>Title<\/h1>/);
  assert.match(html, /<pre><code>/);
  assert.match(html, /x=1/);
});
