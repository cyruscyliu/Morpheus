import { createCatalogFromReadmes } from "./lib/catalog-discovery.js";

export type CatalogKind = "tool" | "workflow";

export interface CatalogEntry {
  name: string;
  kind: CatalogKind;
  path: string;
  summary: string;
  readme: string;
}

const toolReadmes = import.meta.glob("../../../tools/*/README.md", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const workflowReadmes = import.meta.glob("../../../workflows/*/README.md", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

export function getCatalog(): CatalogEntry[] {
  return [
    ...createCatalogFromReadmes(toolReadmes, "tool"),
    ...createCatalogFromReadmes(workflowReadmes, "workflow"),
  ];
}
