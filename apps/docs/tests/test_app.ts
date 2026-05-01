import test from "node:test";
import assert from "node:assert/strict";

import { renderMarkdown } from "../lib/markdown";

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
  assert.match(html, /<h1>Title<\/h1>/);
  assert.match(html, /<ol>/);
  assert.match(html, /<li>one<\/li>/);
  assert.match(html, /<pre><code[^>]*>/);
  assert.match(html, /x=1/);
});
