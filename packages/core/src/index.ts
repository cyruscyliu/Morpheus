export type OssrKind = "tool" | "workflow";

export interface CatalogEntry {
  name: string;
  summary: string;
  path: string;
  kind: OssrKind;
}
