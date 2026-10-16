"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase/client";
import { smartFilter } from "@/lib/search";
import { PRODUCTION_HOST } from "@/lib/share/origin";

type Space = {
  id: string; name: string; slug: string; active: boolean; created_at: string; subdomain_ok: boolean;
  owner_email: string | null; owner_last_sign_in: string | null; history: string[]; links: number; link_hits: number;
  catalogs: number; users: number; domains: { domain: string; status: string; target: string }[];
};

const SUBDOMAINS = process.env.NEXT_PUBLIC_STORE_SUBDOMAINS === "1";
const box = { borderColor: "var(--ap-card-border, rgba(255,255,255,.12))", background: "var(--ap-card-bg, rgba(255,255,255,.04))" } as const;
const muted = { color: "var(--ap-muted)" } as const;

function fmt(iso: string | null) {
  if (!iso) return "nunca";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

const STATUS: Record<string, string> = { active: "✅", pending: "⏳", error: "⚠️" };

/** Espacio de cada tienda: subdominio, dominios propios, nombres viejos, enlaces cortos y visitas. */
export default function AdminSpacesPage() {
  const [rows, setRows] = useState<Space[] | null>(null);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"all" | "legacy" | "domains" | "inactive">("all");

  useEffect(() => {
    void supabaseBrowser().rpc("admin_store_spaces").then(({ data, error: e }) => {
      if (e) setError(/admin_store_spaces|schema cache|Could not find/i.test(e.message) ? "Ejecuta en Supabase la migración 20261202_espacio_tienda.sql." : e.message);
      else setRows((data as Space[]) ?? []);
    });
  }, []);

  const list = useMemo(() => smartFilter((rows ?? []).filter((r) =>
    filter === "all" || (filter === "legacy" && !r.subdomain_ok) || (filter === "domains" && r.domains.length > 0) || (filter === "inactive" && !r.active)),
  q, (r) => `${r.name} ${r.slug} ${r.owner_email ?? ""} ${r.history.join(" ")} ${r.domains.map((d) => d.domain).join(" ")}`), [rows, q, filter]);

  const stats = useMemo(() => {
    const all = rows ?? [];
    return {
      total: all.length,
      legacy: all.filter((r) => !r.subdomain_ok).length,
      domains: all.reduce((s, r) => s + r.domains.length, 0),
      hits: all.reduce((s, r) => s + Number(r.link_hits || 0), 0),
    };
  }, [rows]);

  return (
    <div className="space-y-5" style={{ color: "var(--ap-text)" }}>
      <section className="rounded-3xl border p-5" style={box}>
        <h1 className="text-2xl font-black">🌐 Espacios de las tiendas</h1>
        <p className="mt-1 text-sm" style={muted}>
          Cada tienda trabaja en su subdominio (tienda.{PRODUCTION_HOST}): catálogo, ingreso y panel. Para cambiar un subdominio, ve a <Link href="/admin/tiendas" className="underline">Tiendas</Link>.
          {SUBDOMAINS ? "" : " (Los subdominios están apagados: activa NEXT_PUBLIC_STORE_SUBDOMAINS=1 en Vercel.)"}
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-4">
          {[["Tiendas", stats.total], ["Sin subdominio válido", stats.legacy], ["Dominios propios", stats.domains], ["Visitas por enlaces cortos", stats.hits]].map(([l, v]) => (
            <div key={String(l)} className="rounded-2xl border p-3" style={box}>
              <p className="text-xs" style={muted}>{l}</p>
              <p className="text-xl font-black">{Number(v).toLocaleString("es-CO")}</p>
            </div>
          ))}
        </div>
      </section>

      <div className="flex flex-wrap gap-2">
        <input className="ap-input min-w-0 flex-1 rounded-2xl p-3 text-sm outline-none" placeholder="Buscar tienda, subdominio, nombre viejo, dominio o correo…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="ap-input rounded-2xl p-3 text-sm" value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)}>
          <option value="all">Todas</option>
          <option value="legacy">Sin subdominio válido</option>
          <option value="domains">Con dominio propio</option>
          <option value="inactive">Pausadas</option>
        </select>
      </div>

      {error ? <p className="rounded-2xl border p-4 text-sm" style={{ borderColor: "#ef4444" }}>{error}</p> : null}
      {!rows && !error ? <p className="text-sm" style={muted}>Cargando…</p> : null}

      <div className="grid gap-3 lg:grid-cols-2">
        {list.map((r) => {
          const space = r.subdomain_ok ? `https://${r.slug}.${PRODUCTION_HOST}` : null;
          return (
            <article key={r.id} className="rounded-3xl border p-4" style={{ ...box, opacity: r.active ? 1 : 0.7 }}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-base font-black">{r.name} {r.active ? null : <span className="text-xs font-bold text-amber-500">· pausada</span>}</p>
                  <p className="break-all text-xs" style={muted}>
                    {space ?? `${PRODUCTION_HOST}/${r.slug}`}
                    {r.subdomain_ok ? "" : " · ⚠️ su nombre no sirve de subdominio (cámbialo en Tiendas)"}
                  </p>
                </div>
                {space && SUBDOMAINS ? (
                  <a href={space} target="_blank" rel="noreferrer" className="ap-btn-ghost rounded-xl px-3 py-1.5 text-xs font-bold">Abrir ↗</a>
                ) : null}
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-xs sm:grid-cols-4">
                <div><dt style={muted}>Catálogos</dt><dd className="font-bold">{r.catalogs}</dd></div>
                <div><dt style={muted}>Usuarios</dt><dd className="font-bold">{r.users}</dd></div>
                <div><dt style={muted}>Enlaces cortos</dt><dd className="font-bold">{r.links}</dd></div>
                <div><dt style={muted}>Visitas</dt><dd className="font-bold">{Number(r.link_hits).toLocaleString("es-CO")}</dd></div>
              </dl>
              <p className="mt-2 break-all text-xs" style={muted}>Dueño: {r.owner_email ?? "—"} · último ingreso {fmt(r.owner_last_sign_in)}</p>
              {r.domains.length > 0 ? (
                <p className="mt-1 break-all text-xs">🌍 {r.domains.map((d) => `${STATUS[d.status] ?? "•"} ${d.domain} → /${d.target}`).join(" · ")}</p>
              ) : null}
              {r.history.length > 0 ? (
                <p className="mt-1 break-all text-xs" style={muted}>↪︎ Nombres viejos que redirigen aquí: {r.history.join(", ")}</p>
              ) : null}
            </article>
          );
        })}
      </div>
    </div>
  );
}
