import { getCatalog, type CatalogEntry } from "./catalog.js";
import { defaultThemeId, getTheme, themes } from "./themes.js";
import {
  countByKind,
  filterCatalog,
  getSelectedEntry,
  renderDetail,
  renderList,
  renderOverview,
  renderSectionNav,
} from "./lib/catalog-view.js";

interface ViewState {
  section: "all" | "tool" | "workflow";
  selectedName: string | null;
}

function requiredElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) {
    throw new Error(`Expected element ${selector}`);
  }
  return element;
}

function applyTheme(themeId: string): void {
  const theme = getTheme(themeId);
  document.documentElement.dataset.theme = theme.id;
  window.localStorage.setItem("morpheus-theme", theme.id);
}

function installThemeSelector(): void {
  const select = requiredElement<HTMLSelectElement>("#theme-select");
  select.innerHTML = themes
    .map((theme) => `<option value="${theme.id}">${theme.label}</option>`)
    .join("");
  const savedTheme = window.localStorage.getItem("morpheus-theme") ?? defaultThemeId;
  const activeTheme = getTheme(savedTheme);
  select.value = activeTheme.id;
  applyTheme(activeTheme.id);

  select.addEventListener("change", () => {
    applyTheme(select.value);
  });
}

function refreshTable(entries: CatalogEntry[], state: ViewState): void {
  const filtered = filterCatalog(entries, state.section);
  const selected = getSelectedEntry(filtered, `#entry=${encodeURIComponent(state.selectedName || "")}`);

  state.selectedName = selected?.name ?? null;
  requiredElement<HTMLElement>("#section-nav").innerHTML = renderSectionNav(entries, state.section);
  requiredElement<HTMLElement>("#catalog-summary").textContent = renderOverview(filtered);
  requiredElement<HTMLElement>("#catalog-list").innerHTML = renderList(filtered, state.selectedName);
  requiredElement<HTMLElement>("#catalog-detail").innerHTML = renderDetail(selected);
  requiredElement<HTMLElement>("#readme-path").textContent = selected ? `${selected.path}/README.md` : "Select an entry";
  requiredElement<HTMLElement>("#empty-state").hidden = filtered.length > 0;
  requiredElement<HTMLElement>("#status-left").textContent = selected
    ? `${selected.kind} ${selected.name}`
    : `${state.section} · no selection`;
  const counts = countByKind(entries);
  requiredElement<HTMLElement>("#status-right").textContent =
    `tools:${counts.tool} workflows:${counts.workflow} total:${entries.length}`;
}

function installListSelection(entries: CatalogEntry[], state: ViewState, listNode: HTMLElement): void {
  listNode.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }
    const item = target.closest<HTMLElement>("[data-entry-name]");
    if (!item?.dataset.entryName) {
      return;
    }
    window.location.hash = `entry=${encodeURIComponent(item.dataset.entryName)}`;
    state.selectedName = item.dataset.entryName;
    refreshTable(entries, state);
  });
}

function installSectionSelection(entries: CatalogEntry[], state: ViewState, navNode: HTMLElement): void {
  navNode.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }
    const button = target.closest<HTMLElement>("[data-section]");
    if (!button?.dataset.section) {
      return;
    }
    state.section = button.dataset.section as ViewState["section"];
    const filtered = filterCatalog(entries, state.section);
    if (!filtered.some((entry) => entry.name === state.selectedName)) {
      state.selectedName = filtered[0]?.name ?? null;
      if (state.selectedName) {
        window.location.hash = `entry=${encodeURIComponent(state.selectedName)}`;
      }
    }
    refreshTable(entries, state);
  });
}

export function bootstrap(entries: CatalogEntry[] = getCatalog()): void {
  const state: ViewState = {
    section: "all",
    selectedName: getSelectedEntry(entries, window.location.hash)?.name ?? null,
  };

  const navNode = requiredElement<HTMLElement>("#section-nav");
  const listNode = requiredElement<HTMLElement>("#catalog-list");
  installThemeSelector();
  installSectionSelection(entries, state, navNode);
  installListSelection(entries, state, listNode);

  window.addEventListener("hashchange", () => {
    state.selectedName = getSelectedEntry(entries, window.location.hash)?.name ?? null;
    refreshTable(entries, state);
  });

  refreshTable(entries, state);
}

if (typeof window !== "undefined") {
  bootstrap();
}
