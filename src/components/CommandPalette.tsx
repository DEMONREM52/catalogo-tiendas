"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";

/**
 * Buscador global (Ctrl+K / ⌘K): páginas, acciones, productos, traslados, pedidos internos, clientes y ventas.
 * «?» (fuera de un campo de texto) abre la lista de atajos de teclado.
 * Cada resultado respeta los permisos: lo que no puedes abrir no aparece.
 */

export type PaletteLink = { href: string; label: string; emoji: string; hint?: string; keywords?: string };
type Hit = PaletteLink & { group: string };

const OPEN_EVENT = "remhub-open-palette";
export const openCommandPalette = () => window.dispatchEvent(new Event(OPEN_EVENT));
const HELP_EVENT = "remhub-open-shortcuts";
export const openShortcuts = () => window.dispatchEvent(new Event(HELP_EVENT));

const fold = (t: string) => t.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const clean = (t: string) => t.replace(/[,()*%\\"]/g, " ").trim();
const isTyping = (el: EventTarget | null) => {
  const n = el as HTMLElement | null;
  return Boolean(n && (n.tagName === "INPUT" || n.tagName === "TEXTAREA" || n.tagName === "SELECT" || n.isContentEditable));
};

export const SHORTCUTS: Array<{ keys: string; text: string; where: string }> = [
  { keys: "Ctrl + K", text: "Buscar cualquier cosa (páginas, productos, traslados, clientes…)", where: "En todo el panel" },
  { keys: "?", text: "Ver esta lista de atajos", where: "En todo el panel" },
  { keys: "F2", text: "Abrir la búsqueda de productos con fotos", where: "POS, ingreso de factura, traslados, corregir traslado" },
  { keys: "Enter", text: "Pasar a la siguiente cantidad o volver al buscador", where: "Ingreso de factura y traslados" },
  { keys: "↑ ↓", text: "Cambiar de producto en la tabla de cantidades", where: "Traslados" },
  { keys: "Ctrl + Enter", text: "Guardar el ingreso de factura", where: "Ingreso de factura" },
  { keys: "Esc", text: "Cerrar ventanas y buscadores", where: "En todo el panel" },
];

export function CommandPalette({ storeId, links, can }: { storeId: string | null; links: PaletteLink[]; can: (permission: string) => boolean }) {
  const mounted = useSyncExternalStore(() => () => {}, () => true, () => false);
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [help, setHelp] = useState(false);
  const [q, setQ] = useState("");
  const [remote, setRemote] = useState<Hit[]>([]);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const requests = useRef<Array<{ id: string; number: number; from_name: string; to_name: string; status: string }> | null>(null);

  const show = useCallback(() => { setQ(""); setRemote([]); setActive(0); setOpen(true); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); show(); return; }
      if (e.key === "?" && !isTyping(e.target) && !e.ctrlKey && !e.metaKey) { e.preventDefault(); setHelp(true); }
    };
    const onOpen = () => show();
    const onHelp = () => setHelp(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_EVENT, onOpen);
    window.addEventListener(HELP_EVENT, onHelp);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener(OPEN_EVENT, onOpen); window.removeEventListener(HELP_EVENT, onHelp); };
  }, [show]);
  useEffect(() => { if (open) window.setTimeout(() => inputRef.current?.focus(), 30); }, [open]);

  // Páginas y acciones: filtro local, al instante.
  const local = useMemo<Hit[]>(() => {
    const words = fold(q.trim()).split(/\s+/).filter(Boolean);
    const all = links.map((l) => ({ ...l, group: l.href.includes("nuevo=") || l.label.startsWith("Nuevo") || l.label.startsWith("Nueva") || l.label.startsWith("Ingresar") ? "Acciones" : "Ir a" }));
    if (!words.length) return all.slice(0, 12);
    return all.filter((l) => { const hay = fold(`${l.label} ${l.hint ?? ""} ${l.keywords ?? ""}`); return words.every((w) => hay.includes(w)); }).slice(0, 8);
  }, [q, links]);

  // Datos: productos, traslados, pedidos internos, clientes y ventas (con una pausa corta al escribir).
  useEffect(() => {
    const term = clean(q);
    if (!open || !storeId || term.length < 2) { const t = window.setTimeout(() => { setRemote([]); setLoading(false); }, 0); return () => window.clearTimeout(t); }
    let alive = true;
    const t = window.setTimeout(async () => {
      setLoading(true);
      const sb = supabaseBrowser();
      const num = term.replace(/^#/, "");
      const isNum = /^\d{1,9}$/.test(num);
      const jobs: Array<Promise<Hit[]>> = [];

      if (can("products") || can("products_view") || can("inventory") || can("pos")) {
        jobs.push((async () => {
          const { data } = await sb.from("products").select("id,name,sku,barcode,stock,active").eq("store_id", storeId)
            .or(`name.ilike.*${term}*,sku.ilike.*${term}*,barcode.ilike.*${term}*`).order("name").limit(6);
          return ((data ?? []) as Array<{ id: string; name: string; sku: string | null; stock: number | null; active: boolean | null }>).map((p) => ({
            group: "Productos", emoji: "📦", label: p.name,
            hint: [p.sku, p.active === false ? "inactivo" : null, p.stock !== null ? `${p.stock} en total` : null].filter(Boolean).join(" · "),
            href: can("products") ? `/dashboard/products/${p.id}` : `/dashboard/lista-productos?q=${encodeURIComponent(p.sku || p.name)}`,
          }));
        })());
      }
      if (isNum && (can("transfers") || can("inventory"))) {
        jobs.push((async () => {
          const { data } = await sb.from("erp_transfers").select("id,number,status").eq("store_id", storeId).eq("number", Number(num)).limit(1);
          return ((data ?? []) as Array<{ number: number; status: string }>).map((r) => ({
            group: "Traslados", emoji: "🚚", label: `Traslado #${r.number}`,
            hint: r.status === "received" ? "Recibido" : r.status === "cancelled" ? "Anulado" : "En tránsito",
            href: `/dashboard/inventario?tab=transfers&q=${encodeURIComponent(`#${r.number}`)}`,
          }));
        })());
      }
      if (isNum && ["stock_requests", "stock_requests_manage", "transfers"].some(can)) {
        jobs.push((async () => {
          if (!requests.current) {
            const { data } = await sb.rpc("erp_stock_requests_list", { p_store: storeId });
            requests.current = (data ?? []) as NonNullable<typeof requests.current>;
          }
          return requests.current.filter((r) => String(r.number) === num).map((r) => ({
            group: "Pedidos internos", emoji: "📨", label: `Pedido interno #${r.number}`, hint: `${r.from_name} pide a ${r.to_name}`,
            href: `/dashboard/pedidos?tab=internos&pedido=${r.id}`,
          }));
        })());
      }
      if (["clients", "receivables", "credit"].some(can)) {
        jobs.push((async () => {
          const { data } = await sb.from("billing_customers").select("id,name,document_number").eq("store_id", storeId)
            .or(`name.ilike.*${term}*,document_number.ilike.*${term}*`).order("name").limit(5);
          return ((data ?? []) as Array<{ name: string; document_number: string | null }>).map((c) => ({
            group: "Clientes y terceros", emoji: "👥", label: c.name, hint: c.document_number ?? undefined,
            href: `/dashboard/clientes?q=${encodeURIComponent(c.document_number || c.name)}`,
          }));
        })());
      }
      if (can("pos") || can("orders")) {
        jobs.push((async () => {
          const { data: metas } = await sb.from("erp_order_meta").select("order_id,doc_number,seller_name").eq("store_id", storeId)
            .ilike("doc_number", `%${term}%`).order("created_at", { ascending: false }).limit(5);
          const list = (metas ?? []) as Array<{ order_id: string; doc_number: string; seller_name: string | null }>;
          if (!list.length) return [];
          const { data: orders } = await sb.from("orders").select("id,token,customer_name,total").in("id", list.map((m) => m.order_id));
          const byId = new Map(((orders ?? []) as Array<{ id: string; token: string; customer_name: string | null; total: number }>).map((o) => [o.id, o]));
          return list.filter((m) => byId.get(m.order_id)?.token).map((m) => {
            const o = byId.get(m.order_id)!;
            return { group: "Ventas", emoji: "🧾", label: m.doc_number, hint: [o.customer_name, `$ ${Math.round(Number(o.total ?? 0)).toLocaleString("es-CO")}`].filter(Boolean).join(" · "), href: `/pedido/${o.token}` };
          });
        })());
      }
      if (can("purchases")) {
        jobs.push(Promise.resolve([{ group: "Facturas de compra", emoji: "🛒", label: `Buscar «${term}» en facturas de compra`, hint: "Proveedor, número o producto", href: `/dashboard/inventario?tab=purchases&q=${encodeURIComponent(term)}` }]));
      }

      const results = (await Promise.all(jobs.map((j) => j.catch(() => [] as Hit[])))).flat();
      if (!alive) return;
      setRemote(results);
      setLoading(false);
    }, 220);
    return () => { alive = false; window.clearTimeout(t); };
  }, [q, open, storeId, can]);

  const hits = useMemo(() => [...local, ...remote], [local, remote]);
  const go = useCallback((h: Hit | undefined) => {
    if (!h) return;
    setOpen(false);
    if (h.href.startsWith("/pedido/")) window.open(h.href, "_blank", "noopener");
    else router.push(h.href);
  }, [router]);

  useEffect(() => {
    listRef.current?.querySelector(`[data-i="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  if (!mounted) return null;
  const groups = hits.reduce<Array<{ name: string; items: Array<Hit & { i: number }> }>>((acc, h, i) => {
    const g = acc.find((x) => x.name === h.group) ?? (acc.push({ name: h.group, items: [] }), acc[acc.length - 1]);
    g.items.push({ ...h, i });
    return acc;
  }, []);

  return createPortal(
    <>
      {open ? (
        <div className="fixed inset-0 z-[200] flex items-start justify-center p-3 pt-[10vh]" onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }} style={{ background: "rgba(0,0,0,.55)", backdropFilter: "blur(3px)" }}>
          <div role="dialog" aria-modal="true" aria-label="Buscar en RemHub" className="w-full max-w-xl overflow-hidden rounded-2xl border shadow-2xl"
            style={{ borderColor: "var(--t-card-border)", background: "var(--t-bg-base)", color: "var(--t-text)" }}>
            <div className="flex items-center gap-3 border-b px-4" style={{ borderColor: "var(--t-card-border)" }}>
              <Search size={18} style={{ color: "var(--t-muted)" }} />
              <input
                ref={inputRef}
                value={q}
                onChange={(e) => { setQ(e.target.value); setActive(0); }}
                onKeyDown={(e) => {
                  if (e.key === "Escape") { e.preventDefault(); setOpen(false); }
                  else if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(hits.length - 1, a + 1)); }
                  else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
                  else if (e.key === "Enter") { e.preventDefault(); go(hits[active]); }
                }}
                placeholder="Buscar página, producto, #traslado, cliente, factura…"
                className="h-14 flex-1 text-base"
                style={{ background: "transparent", border: "none", boxShadow: "none", padding: 0, minHeight: 0, borderRadius: 0, outline: "none", color: "var(--t-text)" }}
                aria-label="Buscar"
              />
              {loading ? <span className="text-xs" style={{ color: "var(--t-muted)" }}>Buscando…</span> : null}
              <kbd className="rounded-md border px-1.5 py-0.5 text-[10px] font-bold" style={{ borderColor: "var(--t-card-border)", color: "var(--t-muted)" }}>Esc</kbd>
            </div>
            <div ref={listRef} className="max-h-[60vh] overflow-y-auto p-2">
              {groups.map((g) => (
                <div key={g.name} className="mb-1">
                  <p className="px-3 pb-1 pt-2 text-[10px] font-bold uppercase tracking-widest" style={{ color: "var(--t-muted)" }}>{g.name}</p>
                  {g.items.map((h) => (
                    <button key={`${h.group}-${h.href}-${h.i}`} type="button" data-i={h.i} onMouseEnter={() => setActive(h.i)} onClick={() => go(h)}
                      className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition"
                      style={{ background: h.i === active ? "color-mix(in oklab, var(--t-accent) 16%, transparent)" : "transparent" }}>
                      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-base" style={{ background: "var(--t-card-bg)" }}>{h.emoji}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold">{h.label}</span>
                        {h.hint ? <span className="block truncate text-[11px]" style={{ color: "var(--t-muted)" }}>{h.hint}</span> : null}
                      </span>
                      {h.i === active ? <span className="text-xs" style={{ color: "var(--t-muted)" }}>↵</span> : null}
                    </button>
                  ))}
                </div>
              ))}
              {!hits.length && !loading ? <p className="px-3 py-8 text-center text-sm" style={{ color: "var(--t-muted)" }}>Nada coincide con «{q}». Prueba con otra palabra, una referencia o un número (#14).</p> : null}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 border-t px-4 py-2 text-[11px]" style={{ borderColor: "var(--t-card-border)", color: "var(--t-muted)" }}>
              <span>↑ ↓ para moverte · Enter para abrir · escribe #14 para un traslado o pedido</span>
              <button type="button" className="font-semibold underline" onClick={() => { setOpen(false); setHelp(true); }}>Atajos de teclado (?)</button>
            </div>
          </div>
        </div>
      ) : null}
      {help ? (
        <div className="fixed inset-0 z-[201] flex items-center justify-center p-3" onMouseDown={(e) => { if (e.target === e.currentTarget) setHelp(false); }} onKeyDown={(e) => { if (e.key === "Escape") setHelp(false); }} style={{ background: "rgba(0,0,0,.55)", backdropFilter: "blur(3px)" }}>
          <div role="dialog" aria-modal="true" aria-label="Atajos de teclado" className="w-full max-w-lg rounded-2xl border p-5 shadow-2xl" style={{ borderColor: "var(--t-card-border)", background: "var(--t-bg-base)", color: "var(--t-text)" }}>
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-black">⌨️ Atajos de teclado</h3>
              <button type="button" autoFocus onClick={() => setHelp(false)} className="rounded-lg border px-2.5 py-1 text-xs font-semibold" style={{ borderColor: "var(--t-card-border)" }}>Cerrar</button>
            </div>
            <ul className="mt-4 space-y-2.5">
              {SHORTCUTS.map((s) => (
                <li key={s.keys} className="flex items-start gap-3">
                  <kbd className="shrink-0 rounded-lg border px-2 py-1 text-xs font-bold tabular-nums" style={{ borderColor: "var(--t-card-border)", background: "var(--t-card-bg)", minWidth: 92, textAlign: "center" }}>{s.keys}</kbd>
                  <span className="text-sm">{s.text}<span className="block text-[11px]" style={{ color: "var(--t-muted)" }}>{s.where}</span></span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}
    </>,
    document.body,
  );
}
