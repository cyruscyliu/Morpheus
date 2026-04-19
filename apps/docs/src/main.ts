import { getCatalog, type CatalogEntry, type CatalogKind } from "./catalog.js";
import {
  filterCatalog,
  getSelectedEntry,
  renderDetail,
  renderOverview,
  renderTable,
} from "./lib/catalog-view.js";

interface ViewState {
  kind: CatalogKind | "all";
  selectedName: string | null;
}

function requiredElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) {
    throw new Error(`Expected element ${selector}`);
  }
  return element;
}

function refreshTable(entries: CatalogEntry[], state: ViewState): void {
  const filtered = filterCatalog(entries, state.kind);
  const selected = getSelectedEntry(filtered, `#entry=${encodeURIComponent(state.selectedName || "")}`);

  state.selectedName = selected?.name ?? null;
  requiredElement<HTMLTableSectionElement>("#catalog-table-body").innerHTML = renderTable(filtered, state.selectedName);
  requiredElement<HTMLElement>("#catalog-detail").innerHTML = renderDetail(selected);
  requiredElement<HTMLElement>("#empty-state").hidden = filtered.length > 0;
}

function installTableSelection(entries: CatalogEntry[], state: ViewState, tbody: HTMLTableSectionElement): void {
  tbody.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }
    const row = target.closest<HTMLTableRowElement>("tr[data-entry-name]");
    if (!row?.dataset.entryName) {
      return;
    }
    window.location.hash = `entry=${encodeURIComponent(row.dataset.entryName)}`;
    state.selectedName = row.dataset.entryName;
    refreshTable(entries, state);
  });
}

export function bootstrap(entries: CatalogEntry[] = getCatalog()): void {
  const state: ViewState = {
    kind: "all",
    selectedName: getSelectedEntry(entries, window.location.hash)?.name ?? null,
  };

  requiredElement<HTMLElement>("#catalog-overview").innerHTML = renderOverview(entries);

  const kindFilter = requiredElement<HTMLSelectElement>("#kind-filter");
  const tableBody = requiredElement<HTMLTableSectionElement>("#catalog-table-body");
  installTableSelection(entries, state, tableBody);

  kindFilter.addEventListener("change", () => {
    state.kind = kindFilter.value as CatalogKind | "all";
    refreshTable(entries, state);
  });
  window.addEventListener("hashchange", () => {
    state.selectedName = getSelectedEntry(entries, window.location.hash)?.name ?? null;
    refreshTable(entries, state);
  });

  refreshTable(entries, state);
}

if (typeof window !== "undefined") {
  bootstrap();
}
