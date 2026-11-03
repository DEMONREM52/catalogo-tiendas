import { test } from "node:test";
import assert from "node:assert/strict";
import { detectTraffic } from "@/lib/traffic-source";

const HOST = "lavitrina.remhub.co";
const CHROME = "Mozilla/5.0 (Linux; Android 14; SM-A546E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36";
const IG = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 345.0.0.0 (iPhone14,3; iOS 17_5)";
const FB = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/480.0.0.0;]";
const TT = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 musical_ly_35.0 BytedanceWebview/d8a21c6";

test("un solo enlace: la app donde se abre dice la red", () => {
  assert.equal(detectTraffic("", "", IG, HOST).source, "instagram");
  assert.equal(detectTraffic("?fbclid=abc", "", IG, HOST).source, "instagram"); // Instagram también pone fbclid
  assert.equal(detectTraffic("", "", FB, HOST).source, "facebook");
  assert.equal(detectTraffic("", "", TT, HOST).source, "tiktok");
});

test("marcas de anuncios", () => {
  assert.deepEqual([detectTraffic("?gclid=x", "", CHROME, HOST).source, detectTraffic("?gclid=x", "", CHROME, HOST).medium], ["google", "paid"]);
  assert.deepEqual([detectTraffic("?ttclid=x", "", CHROME, HOST).source, detectTraffic("?ttclid=x", "", CHROME, HOST).medium], ["tiktok", "paid"]);
  // fbclid lo pone Meta en todos los clics: es Facebook, pero no necesariamente pagado.
  assert.deepEqual([detectTraffic("?fbclid=x", "", CHROME, HOST).source, detectTraffic("?fbclid=x", "", CHROME, HOST).medium], ["facebook", "social"]);
});

test("parámetros dinámicos de Meta: {{site_source_name}}", () => {
  const ig = detectTraffic("?utm_source=ig&utm_medium=paid&utm_campaign=Black Friday&utm_content=Video 1", "", CHROME, HOST);
  assert.equal(ig.source, "instagram");
  assert.equal(ig.medium, "paid");
  assert.equal(ig.campaign, "black_friday");
  assert.equal(ig.content, "video_1");
  assert.equal(detectTraffic("?utm_source=fb&utm_medium=paid", "", CHROME, HOST).source, "facebook");
  assert.equal(detectTraffic("?utm_source=msg", "", CHROME, HOST).source, "messenger");
});

test("página de origen", () => {
  assert.deepEqual(detectTraffic("", "https://www.google.com/", CHROME, HOST).medium, "search");
  assert.equal(detectTraffic("", "https://l.instagram.com/?u=x", CHROME, HOST).source, "instagram");
  assert.equal(detectTraffic("", "https://m.youtube.com/watch?v=1", CHROME, HOST).source, "youtube");
  assert.equal(detectTraffic("", "https://t.co/abc", CHROME, HOST).source, "x");
  assert.deepEqual(detectTraffic("", "https://blog.ejemplo.com/post", CHROME, HOST), { source: "blog.ejemplo.com", medium: "referral", campaign: undefined, content: undefined, how: "referencia" });
});

test("sin pistas: directo (así llega WhatsApp); la propia tienda no cuenta como origen", () => {
  assert.equal(detectTraffic("", "", CHROME, HOST).source, "directo");
  assert.equal(detectTraffic("", "https://lavitrina.remhub.co/detal", CHROME, HOST).source, "directo");
  assert.equal(detectTraffic("", "https://remhub.co/", CHROME, HOST).source, "directo");
});
