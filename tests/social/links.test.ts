import test from "node:test";
import assert from "node:assert/strict";
import { detectLinkType, isAutoLabel, linkDisplayName, linkVisualType } from "@/lib/social-links";

test("reconoce la red por el enlace", () => {
  assert.equal(detectLinkType("https://www.tiktok.com/@lavitrina03?lang=en"), "tiktok");
  assert.equal(detectLinkType("instagram.com/tienda"), "instagram");
  assert.equal(detectLinkType("https://m.facebook.com/tienda"), "facebook");
  assert.equal(detectLinkType("https://wa.me/573001234567"), "whatsapp");
  assert.equal(detectLinkType("https://youtu.be/abc"), "youtube");
  assert.equal(detectLinkType("https://mitienda.com"), null);
  assert.equal(detectLinkType("https://notiktok.com.co"), null);
});

test("un enlace de TikTok guardado como Instagram se pinta como TikTok", () => {
  const url = "https://www.tiktok.com/@lavitrina03";
  assert.equal(linkVisualType("instagram", url), "tiktok");
  assert.equal(linkDisplayName("instagram", url, "Instagram"), "TikTok");
  assert.equal(linkDisplayName("instagram", url, ""), "TikTok");
  assert.equal(linkDisplayName("tiktok", url, null), "TikTok");
});

test("el texto propio se respeta; el nombre de una red es automático", () => {
  assert.equal(linkDisplayName("tiktok", "https://tiktok.com/@x", "Síguenos 🎵"), "Síguenos 🎵");
  assert.equal(isAutoLabel("instagram"), true);
  assert.equal(isAutoLabel("  "), true);
  assert.equal(isAutoLabel("Intagram"), false);
  assert.equal(linkDisplayName("website", "https://mitienda.com", ""), "Sitio web");
});
