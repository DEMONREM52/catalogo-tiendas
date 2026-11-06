// Motor de temas Amethyst Glass: validación (entrada no confiable), contraste WCAG, CSS seguro, importar/exportar.
import assert from "node:assert/strict";
import test from "node:test";
import {
  OBSIDIAN, PEARL, accessibilityReport, contrast, exportTheme, fixReadability, importTheme, isReadable, MAX_CONFIG_BYTES,
  normalizeColor, normalizeTheme, themeCss, themeTokens,
} from "../../src/lib/appearance/theme";

test("los temas oficiales usan la paleta pedida y se leen bien (AA)", () => {
  assert.equal(OBSIDIAN.colors.bg, "#09090f");
  assert.equal(OBSIDIAN.colors.accent, "#a78bfa");
  assert.equal(PEARL.colors.bg, "#f8f9fd");
  assert.equal(PEARL.colors.accent, "#7545d6");
  assert.ok(isReadable(OBSIDIAN), JSON.stringify(accessibilityReport(OBSIDIAN)));
  assert.ok(isReadable(PEARL), JSON.stringify(accessibilityReport(PEARL)));
});

test("colores: acepta HEX, RGB y HSL y rechaza lo demás", () => {
  assert.equal(normalizeColor("#ABC"), "#aabbcc");
  assert.equal(normalizeColor(" #A78BFA "), "#a78bfa");
  assert.equal(normalizeColor("rgb(167, 139, 250)"), "#a78bfa");
  assert.equal(normalizeColor("hsl(0, 100%, 50%)"), "#ff0000");
  assert.equal(normalizeColor("red"), null);
  assert.equal(normalizeColor("red; background:url(https://x)"), null);
  assert.equal(normalizeColor("rgb(300, 0, 0)"), null);
  assert.equal(normalizeColor("#12345"), null);
});

test("normalizar: solo propiedades conocidas y valores dentro de límites", () => {
  const t = normalizeTheme({
    base: "light", css: "body{display:none}", colors: { accent: "javascript:alert(1)", bg: "#FFF", hack: "#000000" },
    glass: { blur: 999, opacity: 2, level: "neon" }, layout: { radius: -5, fontScale: "200", density: "x" }, effects: { halo: "si" },
  });
  assert.equal((t as unknown as Record<string, unknown>).css, undefined);
  assert.equal(t.colors.accent, PEARL.colors.accent);
  assert.equal(t.colors.bg, "#ffffff");
  assert.equal((t.colors as unknown as Record<string, unknown>).hack, undefined);
  assert.equal(t.glass.blur, 32);
  assert.equal(t.glass.opacity, 45);
  assert.equal(t.glass.level, PEARL.glass.level);
  assert.equal(t.layout.radius, 0);
  assert.equal(t.layout.fontScale, 115);
  assert.equal(t.layout.density, "normal");
  assert.equal(t.effects.halo, false);
  assert.ok(JSON.stringify(t).length < MAX_CONFIG_BYTES);
});

test("contraste: blanco sobre negro es 21:1 y se detecta texto ilegible", () => {
  assert.equal(Math.round(contrast("#ffffff", "#000000")), 21);
  const bad = normalizeTheme({ ...OBSIDIAN, colors: { ...OBSIDIAN.colors, text: "#2a2a2a", muted: "#222222" } });
  assert.equal(isReadable(bad), false);
  const fixed = fixReadability(bad);
  assert.ok(isReadable(fixed), JSON.stringify(accessibilityReport(fixed)));
});

test("el CSS generado solo trae variables, colores y números (nada de url() ni etiquetas)", () => {
  const css = themeCss(normalizeTheme({ ...OBSIDIAN, colors: { ...OBSIDIAN.colors, accent: "</style><script>" } }));
  assert.ok(!/url\(|<|>|@import|expression\(|javascript:/i.test(css), css.slice(0, 200));
  assert.ok(css.startsWith("html:root[data-user-theme]"));
  const tokens = themeTokens(PEARL);
  assert.equal(tokens["--t-bg-base"], "#f8f9fd");
  assert.equal(tokens["--radius-2xl"], "16px");
  assert.equal(themeCss({ ...PEARL, effects: { ...PEARL.effects, hover: false } }).includes("*:hover"), true);
});

test("exportar e importar devuelve el mismo tema; un archivo ajeno se rechaza", () => {
  const theme = normalizeTheme({ ...OBSIDIAN, colors: { ...OBSIDIAN.colors, accent: "#3b82f6" } });
  const back = importTheme(exportTheme("Mi azul", theme));
  assert.equal(back.name, "Mi azul");
  assert.deepEqual(back.config, theme);
  assert.throws(() => importTheme("no es json"), /JSON/);
  assert.throws(() => importTheme(JSON.stringify({ hola: 1 })), /no es un tema/);
  assert.equal(importTheme(JSON.stringify({ remhub_theme: 1, name: "<b>X</b>", config: {} })).name, "bX/b");
});

test("compatibilidad: un tema guardado con v1 se pinta igual que antes; lo nuevo nace en v2", async () => {
  const { effectiveGlass, THEME_SCHEMA_VERSION } = await import("../../src/lib/appearance/theme");
  const v1 = normalizeTheme({ v: 1, base: "dark", glass: { level: "elegant" } });
  assert.equal(v1.v, 1);
  assert.equal(effectiveGlass(v1).blur, 18);
  assert.equal(effectiveGlass(v1).saturation, 160);
  const fresh = normalizeTheme({ base: "dark", glass: { level: "elegant" } });
  assert.equal(fresh.v, THEME_SCHEMA_VERSION);
  assert.equal(effectiveGlass(fresh).saturation, 125);
  // v2: sin halo violeta en el borde del vidrio.
  assert.ok(!/139, 92, 246|167, 139, 250/.test(themeTokens(OBSIDIAN)["--t-glass-edge"]));
  assert.equal(OBSIDIAN.colors.surface, "#14131f");
});
