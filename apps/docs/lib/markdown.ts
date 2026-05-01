import { marked, type Tokens } from "marked";

export type MarkdownHeading = {
  id: string;
  level: number;
  text: string;
};

marked.setOptions({
  gfm: true,
});

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[`*_~[\]()]/g, "")
    .replace(/&[a-z]+;/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "section";
}

function headingState(markdown: string) {
  const counts = new Map<string, number>();
  const headings: MarkdownHeading[] = [];

  function nextId(text: string) {
    const base = slugify(text);
    const count = counts.get(base) ?? 0;
    counts.set(base, count + 1);
    return count === 0 ? base : `${base}-${count + 1}`;
  }

  for (const token of marked.lexer(markdown)) {
    if (token.type !== "heading") {
      continue;
    }
    const heading = token as Tokens.Heading;
    headings.push({
      id: nextId(heading.text),
      level: heading.depth,
      text: heading.text,
    });
  }

  return headings;
}

export function extractHeadings(markdown: string): MarkdownHeading[] {
  return headingState(markdown);
}

export function renderMarkdown(markdown: string): string {
  const headings = headingState(markdown);
  let headingIndex = 0;

  const renderer = new marked.Renderer();
  renderer.heading = function heading({ tokens, depth }) {
    const text = this.parser.parseInline(tokens);
    const id = headings[headingIndex]?.id ?? slugify(text);
    headingIndex += 1;
    return `<h${depth} id="${id}">${text}</h${depth}>`;
  };

  return marked.parse(markdown, { renderer }) as string;
}
