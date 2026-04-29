export type CatalogKind = "tool" | "app";

export interface CatalogEntry {
  name: string;
  kind: CatalogKind;
  summary: string;
  source: string;
  markdown: string;
}

