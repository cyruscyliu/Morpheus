import test from "node:test";
import assert from "node:assert/strict";

import { createThemeRegistry, defaultThemeId, getTheme } from "../src/lib/theme-registry.js";

const themes = createThemeRegistry([
  "./themes/paper-terminal.css",
  "./themes/ash-console.css",
  "./themes/nord-light.css",
]);

test("theme registry exposes named themes and fallback", () => {
  assert.ok(themes.length >= 3);
  assert.equal(getTheme(themes, defaultThemeId).id, defaultThemeId);
  assert.equal(getTheme(themes, "missing-theme").id, defaultThemeId);
});

test("themes provide required workspace tokens", () => {
  for (const theme of themes) {
    assert.match(theme.id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    assert.ok(theme.label.length > 0);
  }
});
