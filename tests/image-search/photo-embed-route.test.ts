import { test } from "node:test";
import assert from "node:assert/strict";
import { POST } from "@/app/api/photo-embed/route";

const req = (body: BodyInit | null, type: string, ip = "10.0.0.1", extra: Record<string, string> = {}) =>
  new Request("http://localhost/api/photo-embed", { method: "POST", body, headers: { "content-type": type, "x-forwarded-for": ip, ...extra } });

test("modo liviano: solo acepta imágenes", async () => {
  const res = await POST(req("hola", "text/plain", "10.0.0.2"));
  assert.equal(res.status, 415);
  assert.equal(res.headers.get("cache-control"), "private, no-store");
});

test("modo liviano: rechaza fotos grandes o vacías sin analizarlas", async () => {
  assert.equal((await POST(req(new Uint8Array(500 * 1024), "image/jpeg", "10.0.0.3"))).status, 413);
  assert.equal((await POST(req(new Uint8Array(0), "image/jpeg", "10.0.0.4"))).status, 400);
});

test("modo liviano: una foto dañada responde 400, no error del servidor", async () => {
  const res = await POST(req(new TextEncoder().encode("no soy una foto"), "image/jpeg", "10.0.0.5"));
  assert.equal(res.status, 400);
  assert.equal(((await res.json()) as { ok: boolean }).ok, false);
});

test("modo liviano: frena las ráfagas por IP", async () => {
  let last = 0;
  for (let i = 0; i < 61; i++) last = (await POST(req("x", "text/plain", "10.0.0.9"))).status;
  assert.equal(last, 429);
});
