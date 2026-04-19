import.meta.glob("./themes/*.css", { eager: true });

import { createThemeRegistry, defaultThemeId, getTheme as getThemeFromRegistry } from "./lib/theme-registry.js";

const themeModules = import.meta.glob("./themes/*.css", {
  query: "?inline",
  import: "default",
  eager: true,
}) as Record<string, string>;

export { defaultThemeId };

export const themes = createThemeRegistry(Object.keys(themeModules));

export function getTheme(id: string) {
  return getThemeFromRegistry(themes, id);
}
