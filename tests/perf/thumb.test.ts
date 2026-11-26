import { test } from "node:test";
import assert from "node:assert/strict";
import { thumbPath, thumbTarget, thumbUrl } from "../../src/lib/images/thumb";

const BASE = "https://abc.supabase.co/storage/v1/object/public";

test("thumbTarget: foto de producto con versión ?t=", () => {
  const t = thumbTarget(`${BASE}/product-images/u1/products/p9.png?t=1732550000000`);
  assert.deepEqual(t, {
    bucket: "product-images", path: "u1/products/p9.png", version: "1732550000000",
    thumbUrl: `${BASE}/product-images/u1/products/p9.png.v1732550000000.thumb.webp`,
  });
});

test("thumbTarget: sin versión, categorías y rutas con espacios", () => {
  assert.equal(thumbTarget(`${BASE}/category-images/s1/cat.webp`)?.thumbUrl, `${BASE}/category-images/s1/cat.webp.thumb.webp`);
  const t = thumbTarget(`${BASE}/product-images/u1/mi%20foto.jpg?t=5`);
  assert.equal(t?.path, "u1/mi foto.jpg");
  assert.equal(t?.thumbUrl, `${BASE}/product-images/u1/mi%20foto.jpg.v5.thumb.webp`);
});

test("thumbTarget: no aplica a otros buckets, GIF/SVG, miniaturas ni direcciones de afuera", () => {
  assert.equal(thumbTarget(`${BASE}/store-assets/logo.png`), null);
  assert.equal(thumbTarget(`${BASE}/product-images/a.gif`), null);
  assert.equal(thumbTarget(`${BASE}/product-images/a.svg`), null);
  assert.equal(thumbTarget(`${BASE}/product-images/a.png.v1.thumb.webp`), null);
  assert.equal(thumbTarget("https://cdn.otro.com/product-images/a.png"), null);
  assert.equal(thumbTarget(null), null);
  assert.equal(thumbTarget(""), null);
});

test("thumbTarget: un ?t= raro no se usa como versión", () => {
  assert.equal(thumbTarget(`${BASE}/product-images/a.png?t=abc`)?.version, null);
  assert.equal(thumbTarget(`${BASE}/product-images/a.png?x=1&t=77`)?.version, "77");
});

test("thumbPath arma la ruta igual que el script y la subida", () => {
  assert.equal(thumbPath("u1/p.png", 12), "u1/p.png.v12.thumb.webp");
  assert.equal(thumbPath("u1/p.png", null), "u1/p.png.thumb.webp");
});

test("thumbUrl: apagadas por defecto; encendidas con NEXT_PUBLIC_IMAGE_THUMBS=1", () => {
  const url = `${BASE}/product-images/u1/p.png?t=9`;
  const prev = process.env.NEXT_PUBLIC_IMAGE_THUMBS;
  try {
    delete process.env.NEXT_PUBLIC_IMAGE_THUMBS;
    assert.equal(thumbUrl(url), null);
    process.env.NEXT_PUBLIC_IMAGE_THUMBS = "1";
    assert.equal(thumbUrl(url), `${BASE}/product-images/u1/p.png.v9.thumb.webp`);
  } finally {
    if (prev === undefined) delete process.env.NEXT_PUBLIC_IMAGE_THUMBS; else process.env.NEXT_PUBLIC_IMAGE_THUMBS = prev;
  }
});
