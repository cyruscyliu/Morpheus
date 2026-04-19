export type MorpheusKind = "tool" | "workflow";

export interface CatalogEntry {
  name: string;
  summary: string;
  path: string;
  kind: MorpheusKind;
}
