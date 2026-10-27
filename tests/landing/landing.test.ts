import { test } from "node:test";
import assert from "node:assert/strict";
import { deliveryWindow, discounted, landingTotals, normalizeLanding, DEFAULT_LANDING } from "../../src/lib/landing/config";
import { applyTemplate, adCopies, trackedLink, AD_CHANNELS, fillText } from "../../src/lib/landing/templates";
import { landingInsights, type LandingTotals } from "../../src/lib/landing/insights";
import { buildOrderEvent, hashPhone } from "../../src/lib/landing/meta-capi";

test("precios con descuento redondeados a $100 como en la base", () => {
  assert.equal(discounted(99900, 8), 91900);
  assert.equal(discounted(99900, 0, 5), 94900);
  assert.equal(discounted(30000, 20, 5), 22800);
  const t = landingTotals({ price: 99900, bundle: { qty: 2, pct: 8, label: "", highlight: false }, payment: "cod", onlinePct: 5 });
  assert.equal(t.total, 183800);
  assert.equal(t.saving, 199800 - 183800);
});

test("la configuración se limpia: colores, paquetes repetidos, píxeles y precio anterior", () => {
  const c = normalizeLanding({ accent: "rojo", compare_at_price: -5, bundles: [{ qty: 2, pct: 200 }, { qty: 2, pct: 5 }, { qty: 1 }], meta_pixel_id: "abc", tiktok_pixel_id: "C1234567890ABC" });
  assert.equal(c.accent, DEFAULT_LANDING.accent);
  assert.equal(c.compare_at_price, null);
  assert.deepEqual(c.bundles.map((b) => [b.qty, b.pct]), [[1, 0], [2, 90]]);
  assert.equal(c.meta_pixel_id, "");
  assert.equal(c.tiktok_pixel_id, "C1234567890ABC");
});

test("entrega en días hábiles (sin domingos) y corte de la tarde", () => {
  // Domingo 25/10/2026 a las 4 p. m. en Colombia (21:00 UTC): despacha el lunes 26.
  const w = deliveryWindow(new Date("2026-10-25T21:00:00Z"), { free: true, text: "", days_min: 2, days_max: 4, cutoff_hour: 15 });
  assert.equal(w.dispatch.getUTCDay(), 1);
  assert.equal(w.from.toISOString().slice(0, 10), "2026-10-28");
  assert.equal(w.to.toISOString().slice(0, 10), "2026-10-30");
});

test("las plantillas conservan fotos, opciones y píxeles", () => {
  const cur = { ...DEFAULT_LANDING, images: ["https://x.co/1.jpg"], meta_pixel_id: "123456789", compare_at_price: 199800 };
  const next = applyTemplate(cur, "calzado");
  assert.equal(next.option_label, "Talla");
  assert.deepEqual(next.images, cur.images);
  assert.equal(next.meta_pixel_id, "123456789");
  assert.equal(next.compare_at_price, 199800);
  assert.equal(fillText("{producto} a {precio}", "Tenis", "$90.000"), "Tenis a $90.000");
});

test("kit de pauta: enlaces con utm y textos con datos reales", () => {
  const link = trackedLink("https://remhub.co/vitrina/oferta/enterizo", AD_CHANNELS[0], "Octubre Fuerte");
  assert.match(link, /utm_source=facebook/);
  assert.match(link, /utm_campaign=octubre-fuerte/);
  const ads = adCopies({ product: "Enterizo", price: "$99.900", before: null, bundlePct: 15, cod: true, freeShipping: true, endsAt: null });
  assert.ok(ads.every((a) => !a.text.includes("ANTES") && !a.text.includes("null")));
  assert.ok(ads[0].text.includes("Pagas al recibir"));
});

test("consejos según el embudo", () => {
  const base: LandingTotals = { visits: 400, form: 20, started: 15, orders: 4, units: 5, revenue: 400000, upsells: 0, cod: 4, online: 0, addi: 0, confirmed: 4, leads: 11, live: 0, scroll50: 80, scroll90: 20, bounce: 260, avg_seconds: 9, mobile: 380, desktop: 20 };
  const tips = landingInsights(base, [{ source: "facebook", visits: 300, orders: 4, form: 15, avg_seconds: 9 }, { source: "tiktok", visits: 100, orders: 0, form: 5, avg_seconds: 5 }], { upsellOn: false, openLeads: 11 });
  assert.equal(tips[0].tone, "bad");
  assert.ok(tips.some((t) => t.title.includes("se va en segundos")));
  assert.ok(tips.some((t) => t.text.includes("11 por recuperar")));
  assert.ok(tips.some((t) => t.title.startsWith("facebook")));
  assert.equal(landingInsights({ ...base, visits: 5 }, [], { upsellOn: false, openLeads: 0 })[0].title, "Aún hay pocas visitas");
});

test("API de Conversiones: teléfono con 57 cifrado y evento con el mismo id del píxel", () => {
  assert.equal(hashPhone("+57 310 555 1234")?.length, 64);
  assert.equal(hashPhone("123"), null);
  const e = buildOrderEvent({ eventName: "Purchase", eventId: "vitrina-12", orderId: "12", items: [{ id: "p1", quantity: 2, price: 91900 }], total: 183800,
    customer: { name: "María José López", whatsapp: "3105551234", city: "Medellín" }, ctx: { ip: "1.2.3.4", userAgent: "UA", fbp: "fb.1.123.456", fbc: null, url: "https://remhub.co/x" } });
  assert.equal(e.event_id, "vitrina-12");
  assert.equal(e.custom_data.num_items, 2);
  const ud = e.user_data as Record<string, unknown>;
  assert.ok(Array.isArray(ud.ph) && Array.isArray(ud.ln) && ud.fbp === "fb.1.123.456" && !("fbc" in ud));
  assert.ok(!JSON.stringify(e).includes("3105551234"));
});

test("opciones dobles (estilo / color) y orden de secciones", async () => {
  const { optionDims, SECTION_KEYS } = await import("../../src/lib/landing/config");
  const d = optionDims(["Manga larga / Negro", "Manga larga / Blanco", "Manga corta / Negro"], "Estilo / Color");
  assert.deepEqual(d?.labels, ["Estilo", "Color"]);
  assert.deepEqual(d?.values, [["Manga larga", "Manga corta"], ["Negro", "Blanco"]]);
  assert.equal(optionDims(["Negro", "Blanco"], "Color"), null);
  const c = normalizeLanding({ sections: [{ key: "poster", on: true }, { key: "hero", on: false }, { key: "poster" }, { key: "nada" }] });
  assert.equal(c.sections[0].key, "poster");
  assert.equal(c.sections[1].on, false);
  assert.equal(c.sections.length, SECTION_KEYS.length);
  assert.equal(applyTemplate(DEFAULT_LANDING, "combo").bundles[0].qty, 3);
});

test("crear desde un enlace: JSON-LD, Open Graph, Shopify y bloqueo de redes internas", async () => {
  const { parseProductPage, isPrivateHost } = await import("../../src/lib/landing/import");
  const html = `<html><head><title>Vestido Relax | AliExpress</title>
    <meta property="og:image" content="https://img.example.com/og.jpg">
    <script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"Product","name":"Vestido Relax &amp; Co","description":"<p>Suave y fresco</p>","image":["https://img.example.com/1.jpg","//img.example.com/2.webp"],"offers":{"@type":"Offer","price":"25.99","priceCurrency":"USD"}}]}</script>
    </head><body><img src="/logo.png"></body></html>`;
  const p = parseProductPage(html, "https://es.aliexpress.com/item/1.html");
  assert.equal(p.title, "Vestido Relax & Co");
  assert.equal(p.description, "Suave y fresco");
  assert.deepEqual(p.images, ["https://img.example.com/1.jpg", "https://img.example.com/2.webp", "https://img.example.com/og.jpg"]);
  assert.equal(p.price, 25.99);
  const s = parseProductPage("<html></html>", "https://tienda.com/products/x", { title: "Enterizo", description: "<ul><li>Tela fría</li><li>No transparenta</li></ul>", images: ["//cdn.shopify.com/a.jpg"], price: 9990000, variants: [{ title: "Negro / S" }, { title: "Blanco / M" }] });
  assert.equal(s.price, 99900);
  assert.deepEqual(s.bullets, ["Tela fría", "No transparenta"]);
  assert.deepEqual(s.options, ["Negro / S", "Blanco / M"]);
  assert.ok(isPrivateHost("localhost") && isPrivateHost("x.com", "10.0.0.5") && isPrivateHost("x.com", "169.254.169.254") && isPrivateHost("x.com", "::1"));
  assert.ok(!isPrivateHost("aliexpress.com", "47.246.1.1"));
});

test("contadores configurables: periodos válidos y valores por defecto", () => {
  const c = normalizeLanding({ urgency: { viewers_window: "1h", viewers_min: 0, sold_window: "nada", recent_hours: 50, recent_every: 2, countdown_mode: "midnight" } });
  assert.equal(c.urgency.viewers_window, "1h");
  assert.equal(c.urgency.viewers_min, 1);
  assert.equal(c.urgency.sold_window, "week");
  assert.equal(c.urgency.recent_hours, 72);
  assert.equal(c.urgency.recent_every, 8);
  assert.equal(c.urgency.countdown_mode, "midnight");
  assert.equal(normalizeLanding({}).urgency.viewers_window, "now");
});
