import { createAppCatalogFromSkills, createToolCatalogFromSkills } from "./lib/catalog-discovery.js";

export type CatalogKind = "tool" | "app";

export interface CatalogEntry {
  name: string;
  kind: CatalogKind;
  path: string;
  summary: string;
  source: string;
  readme: string;
}

const toolDescriptors = import.meta.glob("../../../tools/*/tool.json", {
  import: "default",
  eager: true,
}) as Record<string, unknown>;

const skillDocs = import.meta.glob("../../../skills/*/SKILL.md", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

export function getCatalog(): CatalogEntry[] {
  return [
    ...createToolCatalogFromSkills(toolDescriptors, skillDocs),
    ...createAppCatalogFromSkills(skillDocs),
  ];
}
