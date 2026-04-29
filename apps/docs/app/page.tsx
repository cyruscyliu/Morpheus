import { DocsShell } from "@/components/docs-shell";
import { getCatalog } from "@/lib/catalog";

export default async function Page() {
  const entries = await getCatalog();
  return <DocsShell entries={entries} />;
}

