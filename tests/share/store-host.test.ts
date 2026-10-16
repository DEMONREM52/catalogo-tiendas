import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanHost, dnsRecordsFor, isPlatformHost, storeHostAction, storePublicUrl, subdomainSlug } from "@/lib/share/store-host";

test("dominios: RemHub se atiende normal", () => {
  for (const h of ["remhub.co", "remhub.store", "www.remhub.co", "localhost", "mi-proyecto.vercel.app"]) assert.equal(isPlatformHost(h), true, h);
  for (const h of ["mitienda.remhub.co", "catalogo.mitienda.com"]) assert.equal(isPlatformHost(h), false, h);
  assert.equal(cleanHost(" MiTienda.REMHUB.co:443 "), "mitienda.remhub.co");
});

test("dominios: subdominio de cada tienda", () => {
  assert.equal(subdomainSlug("mitienda.remhub.co"), "mitienda");
  assert.equal(subdomainSlug("www.remhub.co"), null);
  assert.equal(subdomainSlug("admin.remhub.co"), null);
  assert.equal(subdomainSlug("a.b.remhub.co"), null);
  assert.equal(subdomainSlug("remhub.co"), null);
  assert.equal(subdomainSlug("mitienda.otro.com"), null);
});

test("dominios: rutas en el dominio de la tienda", () => {
  assert.deepEqual(storeHostAction("mitienda", "detal", "/"), { type: "rewrite", path: "/mitienda/detal" });
  assert.deepEqual(storeHostAction("mitienda", "navidad", "/", "?q=ollas"), { type: "rewrite", path: "/mitienda/navidad?q=ollas" });
  assert.deepEqual(storeHostAction("mitienda", "detal", "/producto/abc"), { type: "rewrite", path: "/mitienda/producto/abc" });
  assert.deepEqual(storeHostAction("mitienda", "detal", "/mayor"), { type: "rewrite", path: "/mitienda/mayor" });
  // Una sola dirección por página: los enlaces con el slug se limpian.
  assert.deepEqual(storeHostAction("MiTienda", "detal", "/mitienda/producto/abc", "?catalogo=detal"), { type: "redirect", url: "/producto/abc?catalogo=detal" });
  assert.deepEqual(storeHostAction("mitienda", "detal", "/mitienda"), { type: "redirect", url: "/" });
  // El panel y el acceso viven en remhub.co.
  assert.deepEqual(storeHostAction("mitienda", "detal", "/dashboard/pos"), { type: "redirect", url: "https://remhub.co/dashboard/pos" });
  assert.deepEqual(storeHostAction("mitienda", "detal", "/login"), { type: "redirect", url: "https://remhub.co/login" });
  // Archivos, API, robots y sitemap no se tocan.
  for (const p of ["/_next/static/x.js", "/api/og", "/robots.txt", "/sitemap.xml", "/remhub-icon-128.png", "/sw.js"]) {
    assert.deepEqual(storeHostAction("mitienda", "detal", p), { type: "next" }, p);
  }
});

test("dominios: dirección pública", () => {
  assert.equal(storePublicUrl("catalogo.mitienda.com", "detal", "/detal"), "https://catalogo.mitienda.com/");
  assert.equal(storePublicUrl("catalogo.mitienda.com", "detal", "/producto/1"), "https://catalogo.mitienda.com/producto/1");
});

test("dominios: registros DNS para conectar", () => {
  assert.deepEqual(dnsRecordsFor("catalogo.mitienda.com").map((r) => [r.type, r.name, r.value]), [["CNAME", "catalogo", "cname.vercel-dns.com"]]);
  assert.deepEqual(dnsRecordsFor("mitienda.com").map((r) => [r.type, r.name, r.value]), [["A", "@", "76.76.21.21"]]);
  assert.deepEqual(dnsRecordsFor("mitienda.com.co").map((r) => [r.type, r.name]), [["A", "@"]]);
  assert.deepEqual(dnsRecordsFor("tienda.mitienda.com.co").map((r) => [r.type, r.name]), [["CNAME", "tienda"]]);
  assert.equal(dnsRecordsFor("catalogo.mitienda.com", [{ type: "TXT", domain: "_vercel.mitienda.com", value: "vc-domain-verify=x" }]).length, 2);
});
