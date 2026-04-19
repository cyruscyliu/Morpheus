export interface ThemeDefinition {
  id: string;
  label: string;
}

function labelFromThemeId(id: string): string {
  return id
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function themeIdFromPath(path: string): string {
  return path.split("/").pop()?.replace(/\.css$/, "") ?? path;
}

export function createThemeRegistry(paths: string[]): ThemeDefinition[] {
  return paths
    .map(themeIdFromPath)
    .sort((left, right) => left.localeCompare(right))
    .map((id) => ({
      id,
      label: labelFromThemeId(id),
    }));
}

export const defaultThemeId = "nord-light";

export function getTheme(themes: ThemeDefinition[], id: string): ThemeDefinition {
  return themes.find((theme) => theme.id === id) ?? themes.find((theme) => theme.id === defaultThemeId) ?? themes[0];
}
