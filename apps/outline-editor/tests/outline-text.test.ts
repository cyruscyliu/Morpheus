import test from "node:test";
import assert from "node:assert/strict";

import { outlineToText, parseTextDocument, textDocumentToOutline } from "../lib/outline-text";

test("outline text round-trip keeps visible structure", () => {
  const source = {
    title: "System Security Research",
    references: [
      {
        ref_id: "r1",
        citation_key: "foo2026",
        title: "Foo",
      },
    ],
    sections: [
      {
        section_id: "sec-01",
        title: "Why",
        purpose: "Explain the motivation.",
        paragraphs: [
          {
            paragraph_id: "p1",
            role: "argument",
            arguments: [
              {
                argument_id: "a1",
                type: "claim",
                text: "Research matters.",
                supports: [
                  {
                    support_id: "s1",
                    type: "example",
                    status: "available",
                    content: "Systems fail in production.",
                    reference_ids: [],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
  const text = outlineToText(source);
  assert.match(text, /Title: System Security Research/);
  assert.match(text, /# Why/);
  assert.match(text, /> Explain the motivation\./);
  assert.match(text, /- Systems fail in production\./);

  const parsed = parseTextDocument(text);
  const rebuilt = textDocumentToOutline(parsed, source);
  assert.equal(rebuilt.title, source.title);
  assert.equal(rebuilt.sections[0].title, "Why");
  assert.equal(rebuilt.sections[0].purpose, "Explain the motivation.");
  assert.equal(rebuilt.sections[0].paragraphs[0].arguments[0].text, "Research matters.");
  assert.equal(rebuilt.sections[0].paragraphs[0].arguments[0].supports[0].content, "Systems fail in production.");
  assert.equal(rebuilt.references?.[0]?.citation_key, "foo2026");
});
