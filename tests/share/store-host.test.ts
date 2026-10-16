import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanHost, dnsRecordsFor, isPlatformHost, isSubdomainSlug, storeShareUrl, storeSpaceOrigin, mainHostStorePath, mainHostStoreRedirect, shortLinkTarget, storeHostAction, storePublicUrl, subdomainSlug } from "@/lib/share/store-host";

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
  // Vitrina con todos los catálogos: en la raíz si la tienda la escogió, y siempre en /inicio.
  assert.deepEqual(storeHostAction("mitienda", "inicio", "/"), { type: "rewrite", path: "/mitienda" });
  assert.deepEqual(storeHostAction("mitienda", "detal", "/inicio"), { type: "rewrite", path: "/mitienda" });
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

test("enlaces cortos: /z lleva al catálogo y conserva la consulta", () => {
  const links = { z: "/zamora", "la-vitrina-mellos-barber-sede-zamora": "/zamora", vip: "/mayor?key=abc" };
  assert.equal(shortLinkTarget(links, "/z"), "/zamora");
  assert.equal(shortLinkTarget(links, "/Z/", "?utm_source=ig"), "/zamora?utm_source=ig");
  assert.equal(shortLinkTarget(links, "/la-vitrina-mellos-barber-sede-zamora/producto/1"), "/zamora/producto/1");
  assert.equal(shortLinkTarget(links, "/vip", "?key=otra&x=1"), "/mayor?key=abc&x=1");
  assert.equal(shortLinkTarget(links, "/zamora"), null);
  assert.equal(shortLinkTarget({ mal: "//otro.com" }, "/mal"), null);
  assert.equal(shortLinkTarget(null, "/z"), null);
});

test("remhub.co/tienda/…: lleva al subdominio y los nombres viejos al nuevo", () => {
  assert.deepEqual(mainHostStorePath("/lavitrina/la-vitrina-mellos-barber-sede-zamora"), { slug: "lavitrina", rest: "/la-vitrina-mellos-barber-sede-zamora" });
  assert.deepEqual(mainHostStorePath("/lavitrina/"), { slug: "lavitrina", rest: "" });
  for (const p of ["/", "/dashboard/pos", "/login", "/api/x", "/sw.js", "/acceso/lavitrina", "/remhub-icon-128.png"]) assert.equal(mainHostStorePath(p), null, p);
  const info = { slug: "lavitrina", target: "detal", links: { "la-vitrina-mellos-barber-sede-zamora": "/zamora" } };
  assert.equal(mainHostStoreRedirect(info, mainHostStorePath("/lavitrina/la-vitrina-mellos-barber-sede-zamora")!, "", true), "https://lavitrina.remhub.co/zamora");
  assert.equal(mainHostStoreRedirect(info, { slug: "lavitrina", rest: "/mayor" }, "?key=1", true), "https://lavitrina.remhub.co/mayor?key=1");
  assert.equal(mainHostStoreRedirect(info, { slug: "lavitrina", rest: "" }, "", true), "https://lavitrina.remhub.co/");
  // Sin subdominios: solo los nombres viejos se mueven.
  assert.equal(mainHostStoreRedirect(info, { slug: "lavitrina", rest: "/detal" }, "", false), null);
  assert.equal(mainHostStoreRedirect(info, { slug: "lavitrina", rest: "/la-vitrina-mellos-barber-sede-zamora" }, "", false), "/lavitrina/zamora");
  assert.equal(mainHostStoreRedirect({ moved_to: "la-vitrina" }, { slug: "lavitrina", rest: "/detal" }, "?q=1", false), "/la-vitrina/detal?q=1");
  assert.equal(mainHostStoreRedirect({ moved_to: "la-vitrina" }, { slug: "lavitrina", rest: "/detal" }, "", true), "https://la-vitrina.remhub.co/detal");
  // Tiendas viejas con punto en el nombre no tienen subdominio: se quedan en remhub.co.
  assert.equal(mainHostStoreRedirect({ slug: "mi.tienda" }, { slug: "mi.tienda", rest: "/detal" }, "", true), null);
  assert.equal(mainHostStoreRedirect(null, { slug: "nada", rest: "" }, "", true), null);
});

test("espacio de la tienda: el panel vive en su subdominio", () => {
  const space = { subdomainSpace: true };
  for (const p of ["/dashboard", "/dashboard/pos", "/login", "/entrar", "/acceso/lavitrina", "/forgot-password", "/pedido/abc"]) {
    assert.deepEqual(storeHostAction("lavitrina", "detal", p, "", space), { type: "next" }, p);
  }
  // /admin siempre en remhub.co.
  assert.deepEqual(storeHostAction("lavitrina", "detal", "/admin/tiendas", "", space), { type: "redirect", url: "https://remhub.co/admin/tiendas" });
  // Desde un dominio propio, el panel va al subdominio de la tienda.
  assert.deepEqual(storeHostAction("lavitrina", "detal", "/dashboard", "?x=1", { spaceOrigin: "https://lavitrina.remhub.co" }),
    { type: "redirect", url: "https://lavitrina.remhub.co/dashboard?x=1" });
  // El manifiesto del catálogo se atiende tal cual (no se redirige).
  assert.deepEqual(storeHostAction("lavitrina", "detal", "/lavitrina/zamora/app.webmanifest", "", space), { type: "next" });
  // Catálogo normal sigue igual.
  assert.deepEqual(storeHostAction("lavitrina", "detal", "/zamora", "", space), { type: "rewrite", path: "/lavitrina/zamora" });
});

test("espacio de la tienda: nombres que sirven de subdominio", () => {
  assert.equal(isSubdomainSlug("lavitrina"), true);
  for (const s of ["mi.tienda", "mi_tienda", "-x", "admin", "www", "a".repeat(64)]) assert.equal(isSubdomainSlug(s), false, s);
  assert.equal(storeSpaceOrigin("lavitrina"), "https://lavitrina.remhub.co");
  assert.equal(storeSpaceOrigin("mi.tienda"), null);
  assert.equal(storeShareUrl("lavitrina", "/z", true), "https://lavitrina.remhub.co/z");
  assert.equal(storeShareUrl("lavitrina", "/z", false), "https://remhub.co/lavitrina/z");
  assert.equal(storeShareUrl("mi.tienda", "/detal", true, "https://remhub.co"), "https://remhub.co/mi.tienda/detal");
});
