import { marked } from "marked";

marked.setOptions({
  gfm: true,
});

export function renderMarkdown(markdown: string): string {
  return marked.parse(markdown) as string;
}
