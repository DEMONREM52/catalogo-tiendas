"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import dynamic from "next/dynamic";
import { Camera, EyeOff, KeyRound, Minus, Plus, ScanBarcode, Share2, Trash2, Users, X } from "lucide-react";
import Swal from "@/lib/swal";
import { supabaseBrowser } from "@/lib/supabase/client";
import { startPoll } from "@/lib/net/poll";
import { parseScan, sameCode } from "@/lib/scan/parse";
import { scanBeep } from "@/components/scan/CameraScanner";
import { ProductPicker, Thumb } from "./LineEditor";
import { Btn, errorMessage, toast, type ErpCtx, type Warehouse } from "./shared";
import { cleanPin, isValidPin } from "./group-pin";

const CameraScanner = dynamic(() => import("@/components/scan/CameraScanner").then((m) => m.CameraScanner), { ssr: false });
const MISSING = "Para contar en grupo, ejecuta en Supabase la migración 20261351_conteo_en_grupo.sql.";
const swal = { background: "var(--t-bg-base)", color: "var(--t-text)", confirmButtonColor: "#8b5cf6" };
const isMissing = (m?: string) => /Could not find the function|schema cache/i.test(m ?? "");

export type GroupCountItem = { product_id: string; name: string; sku: string | null; qty: number; current: number };
type Session = { id: string; warehouse_id: string; warehouse: string; name: string | null; blind: boolean; status: "open" | "closed" | "applied" | "cancelled";
  created_by_name: string | null; created_at: string; updated_at: string; people: number; products: number; units: number };
type RoomLine = { product_id: string; name: string; sku: string | null; barcode: string | null; image_url: string | null; total: number; mine: number | null;
  by: Array<{ name: string | null; qty: number }>; updated_at: string; system: number | null };
type Room = {
  count: { id: string; store_id: string; warehouse_id: string; warehouse: string; name: string | null; blind: boolean; status: Session["status"];
    created_by_name: string | null; created_at: string; closed_by_name: string | null; finished_by_name: string | null;
    /** Contraseña para invitados (20261352): enlace público /conteo/<share_token>, solo para el anfitrión. */
    has_pin?: boolean; share_token?: string | null; guests?: number };
  can_adjust: boolean; can_host?: boolean; me: string; people: Array<{ name: string | null; products: number; units: number; mine: boolean }>; lines: RoomLine[];
};

function newKey(): string {
  const c = globalThis.crypto as Crypto & { randomUUID?: () => string };
  if (typeof c.randomUUID === "function") return c.randomUUID();
  const b = c.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
const linkFor = (id: string) => `${window.location.origin}/dashboard/inventario?tab=adjustments&grupo=${id}`;

/**
 * Conteo en grupo (20261351): varias personas cuentan la misma bodega a la vez, cada una lo suyo, y se suma.
 * Aquí: los conteos abiertos de la bodega, abrir uno nuevo y entrar a contar.
 */
export function GroupCountBar({ ctx, warehouses, warehouse, canAdjust, onLoad }: {
  ctx: ErpCtx;
  warehouses: Warehouse[];
  /** Bodega elegida en el ajuste (si no, se elige al abrir). */
  warehouse: string;
  canAdjust: boolean;
  /** Terminar y pasar al ajuste: el total por producto. */
  onLoad: (items: GroupCountItem[], countId: string, warehouseId: string) => void;
}) {
  const [list, setList] = useState<Session[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const places = warehouses.filter((w) => w.active && (!ctx.pointId || w.id === ctx.pointId));

  const load = useCallback(async () => {
    const { data, error: e } = await supabaseBrowser().rpc("erp_gc_list", { p_store: ctx.storeId });
    if (e) return setError(isMissing(e.message) ? MISSING : errorMessage(e));
    setError(null);
    setList((data ?? []) as Session[]);
  }, [ctx.storeId]);

  useEffect(() => {
    const poll = startPoll(() => load(), { every: 30_000, firstDelay: 0 });
    return () => poll.stop();
  }, [load]);

  // Enlace compartido: ?tab=adjustments&grupo=<id> abre el conteo de una vez.
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("grupo");
    if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return;
    const t = window.setTimeout(() => setOpenId(id), 0);
    const u = new URL(window.location.href);
    u.searchParams.delete("grupo");
    window.history.replaceState(null, "", u.toString());
    return () => window.clearTimeout(t);
  }, []);

  async function start() {
    const opts = places.map((w) => `<option value="${w.id}" ${w.id === warehouse ? "selected" : ""}>${w.name.replace(/[<>&"]/g, "")}</option>`).join("");
    const res = await Swal.fire({
      ...swal, title: "👥 Contar en grupo",
      html: `<div style="text-align:left;font-size:13px;display:grid;gap:8px">
        <p style="margin:0;opacity:.85">Abre un conteo y comparte el enlace: cada persona cuenta desde su celular y se suma lo de todos. Contar no mueve inventario; al final se aplica con el ajuste de siempre.</p>
        <select id="gcw" class="swal2-select" style="width:100%;margin:0">${opts}</select>
        <input id="gcn" class="swal2-input" style="width:100%;margin:0" maxlength="80" placeholder="Nombre (opcional): Conteo de diciembre, Vitrina y fondo…" />
        <label style="display:flex;gap:8px;align-items:center"><input id="gcb" type="checkbox" /> <span><b>A ciegas</b>: mientras cuentan no ven lo que dice el sistema.</span></label>
      </div>`,
      showCancelButton: true, confirmButtonText: "Abrir conteo", cancelButtonText: "Cancelar",
      preConfirm: () => ({
        w: (document.getElementById("gcw") as HTMLSelectElement | null)?.value ?? "",
        n: (document.getElementById("gcn") as HTMLInputElement | null)?.value ?? "",
        b: Boolean((document.getElementById("gcb") as HTMLInputElement | null)?.checked),
      }),
    });
    if (!res.isConfirmed || !res.value?.w) return;
    const { data, error: e } = await supabaseBrowser().rpc("erp_gc_start", { p_store: ctx.storeId, p_warehouse: res.value.w, p_name: res.value.n || null, p_blind: res.value.b });
    const r = data as { ok: boolean; id: string; existing: boolean } | null;
    if (e || !r?.id) return void toast("No se pudo abrir", "error", isMissing(e?.message) ? MISSING : e ? errorMessage(e) : undefined);
    if (r.existing) void toast("Ya había un conteo abierto en esa bodega: entras a ese", "warning");
    void load();
    setOpenId(r.id);
  }

  const shown = (list ?? []).filter((s) => (s.status === "open" || s.status === "closed") && (!warehouse || s.warehouse_id === warehouse));
  return (
    <div className="mt-3 rounded-2xl border p-3" style={{ borderColor: "color-mix(in oklab, var(--t-accent) 40%, var(--t-card-border))" }}>
      <div className="flex flex-wrap items-center gap-2">
        <Users size={17} style={{ color: "var(--t-accent)" }} />
        <span className="text-sm font-bold">Contar en grupo</span>
        <span className="text-[11px]" style={{ color: "var(--t-muted)" }}>Varias personas a la vez, cada una desde su celular; se suma lo de todos.</span>
        <span className="flex-1" />
        <Btn variant="ghost" onClick={() => void start()}>👥 Nuevo conteo en grupo</Btn>
      </div>
      {error ? <p className="mt-2 text-[11px]" style={{ color: "#d97706" }}>⚠️ {error}</p> : null}
      {shown.length ? (
        <div className="mt-2 grid gap-1.5">
          {shown.map((s) => (
            <button key={s.id} type="button" onClick={() => setOpenId(s.id)} className="flex flex-wrap items-center gap-2 rounded-xl border p-2.5 text-left text-sm"
              style={{ borderColor: s.status === "closed" ? "#f59e0b" : "var(--t-card-border)", background: "var(--t-card-bg)" }}>
              <span className="font-bold">{s.status === "closed" ? "⏳" : "🟢"} {s.name || `Conteo de ${s.warehouse}`}</span>
              {s.blind ? <span className="rounded-full px-1.5 py-px text-[10px] font-bold" style={{ background: "color-mix(in oklab, var(--t-accent) 15%, transparent)" }}>a ciegas</span> : null}
              <span className="text-[11px]" style={{ color: "var(--t-muted)" }}>{s.warehouse} · {s.people} persona{s.people === 1 ? "" : "s"} · {s.products} productos · {s.units} und.{s.status === "closed" ? " · terminado, por aplicar" : ""}</span>
              <span className="ml-auto text-xs font-black" style={{ color: "var(--t-accent)" }}>{s.status === "closed" ? (canAdjust ? "Revisar →" : "Ver →") : "Entrar a contar →"}</span>
            </button>
          ))}
        </div>
      ) : null}
      {openId ? <GroupCountRoom id={openId} onClose={() => { setOpenId(null); void load(); }} onLoad={(items, wh) => { onLoad(items, openId, wh); setOpenId(null); void load(); }} /> : null}
    </div>
  );
}

const subscribeNoop = () => () => {};

/** La sala del conteo: buscar o escanear, anotar lo tuyo y ver lo de todos en vivo. */
function GroupCountRoom({ id, onClose, onLoad }: { id: string; onClose: () => void; onLoad: (items: GroupCountItem[], warehouseId: string) => void }) {
  const mounted = useSyncExternalStore(subscribeNoop, () => true, () => false);
  const [room, setRoom] = useState<Room | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const [scanMode, setScanMode] = useState<"one" | "ask">("one");
  const [code, setCode] = useState("");
  const [camera, setCamera] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [filter, setFilter] = useState<"all" | "mine">("all");
  const pollRef = useRef<ReturnType<typeof startPoll> | null>(null);
  const chain = useRef<Promise<void>>(Promise.resolve());

  const load = useCallback(async () => {
    const { data, error: e } = await supabaseBrowser().rpc("erp_gc_get", { p_id: id });
    if (e) return setError(isMissing(e.message) ? MISSING : errorMessage(e));
    if (!data) return setError("No encontramos ese conteo o no es de tus puntos.");
    setError(null);
    setRoom(data as Room);
  }, [id]);

  // En vivo: revisa cada 4 s con la pestaña a la vista (y al volver a ella); después de cada cambio tuyo, de una.
  useEffect(() => {
    const poll = startPoll(() => load(), { every: 4000, firstDelay: 0, minGap: 1500 });
    pollRef.current = poll;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { poll.stop(); pollRef.current = null; document.body.style.overflow = prev; };
  }, [load]);

  const open = room?.count.status === "open";
  const lines = useMemo(() => (room?.lines ?? []).filter((l) => filter === "all" || l.mine !== null), [room, filter]);
  const addedQty = useMemo(() => Object.fromEntries((room?.lines ?? []).map((l) => [l.product_id, l.total])), [room]);

  async function setQty(productId: string, qty: number, add: boolean, key?: string) {
    const { data, error: e } = await supabaseBrowser().rpc("erp_gc_set", { p_id: id, p_product: productId, p_qty: qty, p_add: add, p_key: key ?? null });
    if (e) { void toast("No se guardó", "error", errorMessage(e)); return null; }
    pollRef.current?.run();
    return data as { mine: number; total: number };
  }

  async function addFromPicker(hit: { id: string; name: string }) {
    const mine = room?.lines.find((l) => l.product_id === hit.id)?.mine ?? 0;
    const r = await Swal.fire({ ...swal, title: hit.name, text: mine ? `Llevas ${mine}. ¿Cuántas más contaste aquí?` : "¿Cuántas contaste?", input: "number", inputValue: "1",
      inputAttributes: { min: "0", step: "1" }, showCancelButton: true, confirmButtonText: "Anotar", cancelButtonText: "Cancelar",
      inputValidator: (v) => (Number.isInteger(Number(v)) && Number(v) >= 0 && Number(v) <= 1000000 ? null : "Escribe un número entero (0 si no hay)") });
    if (!r.isConfirmed) return;
    const q = Number(r.value);
    const res = q === 0 && !mine ? await setQty(hit.id, 0, false) : await setQty(hit.id, q, true);
    if (res) void toast(`${hit.name}: llevas ${res.mine} · entre todos ${res.total}`, "success");
  }

  async function handleScan(raw: string) {
    const p = parseScan(raw, { hosts: [window.location.hostname] });
    if (p.kind !== "code") { if (p.kind !== "empty") { scanBeep(false); setMsg({ ok: false, text: "Eso no es un código de producto." }); } return; }
    const safe = p.code.replace(/[,()*%\\"]/g, "");
    const { data } = await supabaseBrowser().from("products").select("id,name,sku,barcode").eq("store_id", room?.count.store_id ?? "")
      .or(`barcode.eq.${safe},sku.ilike.${safe}`).limit(5);
    // Solo coincidencia exacta (los ceros y el «_» cuentan).
    const hits = ((data ?? []) as Array<{ id: string; name: string; sku: string | null; barcode: string | null }>).filter((h) => sameCode(p.code, h.sku, h.barcode));
    if (!hits.length) { scanBeep(false); return setMsg({ ok: false, text: `No hay ningún producto con el código «${p.code}».` }); }
    if (hits.length > 1) { scanBeep(false); return setMsg({ ok: false, text: `«${p.code}» es de ${hits.length} productos: búscalo por nombre.` }); }
    const h = hits[0];
    if (scanMode === "ask") return void (await addFromPicker(h));
    const res = await setQty(h.id, 1, true, newKey());
    if (!res) { scanBeep(false); return; }
    scanBeep(true);
    setMsg({ ok: true, text: `+1 ${h.name} · llevas ${res.mine} · entre todos ${res.total}` });
  }
  const enqueue = (raw: string) => { chain.current = chain.current.then(() => handleScan(raw)).catch(() => undefined); };

  async function share() {
    // Con contraseña: el enlace público (entra cualquiera con la contraseña). Sin ella: el del panel (solo el equipo).
    const pub = room?.count.has_pin && room.count.share_token ? `${window.location.origin}/conteo/${room.count.share_token}` : null;
    const url = pub ?? linkFor(id);
    const text = `👥 Conteo en grupo${room?.count.name ? ` «${room.count.name}»` : ""} en ${room?.count.warehouse ?? "la bodega"}. Entra y anota lo que cuentes${pub ? " (te paso la contraseña aparte)" : ""}:`;
    try { if (navigator.share) return void (await navigator.share({ title: "Conteo en grupo", text, url })); } catch { return; }
    try { await navigator.clipboard.writeText(url); void toast("Enlace copiado", "success"); } catch { window.open(`https://wa.me/?text=${encodeURIComponent(`${text}\n${url}`)}`, "_blank"); }
  }

  /** Anfitrión: poner, cambiar o quitar la contraseña para invitados, o cambiar el enlace. */
  async function pinMenu() {
    if (!room) return;
    const has = Boolean(room.count.has_pin);
    type PinAction = "set" | "remove" | "link";
    let action = "set" as PinAction;
    if (has) {
      const pick = await Swal.fire({ ...swal, title: "🔑 Contraseña para invitados",
        html: `<p style="font-size:13px;margin:0 0 8px">Con el enlace y la contraseña entra cualquiera a contar, sin cuenta. Hay ${room.count.guests ?? 0} invitado(s) adentro.</p>`,
        input: "select", inputOptions: { set: "Cambiar la contraseña", link: "Enlace nuevo (el anterior deja de servir)", remove: "Quitar la contraseña (cierra el enlace)" }, inputValue: "set",
        showCancelButton: true, confirmButtonText: "Seguir", cancelButtonText: "Cerrar" });
      if (!pick.isConfirmed) return;
      action = pick.value as PinAction;
    } else {
      const pick = await Swal.fire({ ...swal, title: "🔑 Poner contraseña",
        html: `<p style="font-size:13px">Así cualquier persona con el enlace y la contraseña puede contar, sin cuenta. Solo anotan lo que cuentan: no ven lo que dice el sistema, ni precios; terminar y aplicar lo haces tú.</p>`,
        showCancelButton: true, confirmButtonText: "Poner contraseña", cancelButtonText: "Cancelar" });
      if (!pick.isConfirmed) return;
    }
    if (action === "link") {
      const { error: e } = await supabaseBrowser().rpc("erp_gc_new_link", { p_id: id });
      if (e) return void toast("No se pudo", "error", errorMessage(e));
      pollRef.current?.run();
      return void toast("Enlace nuevo listo", "success", "Los invitados deben volver a entrar. Lo que anotaron se queda.");
    }
    if (action === "remove") {
      const { error: e } = await supabaseBrowser().rpc("erp_gc_set_pin", { p_id: id, p_pin: "" });
      if (e) return void toast("No se pudo", "error", errorMessage(e));
      pollRef.current?.run();
      return void toast("Contraseña quitada", "success", "El enlace para invitados ya no abre.");
    }
    const r = await Swal.fire({ ...swal, title: has ? "Nueva contraseña" : "Contraseña", text: "De 4 a 8 números. Díselo a quienes van a contar.", input: "text",
      inputAttributes: { inputmode: "numeric", maxlength: "8", autocomplete: "off" }, showCancelButton: true, confirmButtonText: "Guardar", cancelButtonText: "Cancelar",
      inputValidator: (v) => (isValidPin(v) ? null : "Escribe de 4 a 8 números") });
    if (!r.isConfirmed) return;
    const { data, error: e } = await supabaseBrowser().rpc("erp_gc_set_pin", { p_id: id, p_pin: cleanPin(r.value) });
    if (e) return void toast("No se pudo", "error", errorMessage(e));
    pollRef.current?.run();
    const tok = (data as { share_token?: string } | null)?.share_token;
    if (tok) {
      const url = `${window.location.origin}/conteo/${tok}`;
      const done = await Swal.fire({ ...swal, icon: "success", title: "Listo", html: `<p style="font-size:13px">Comparte este enlace y di la contraseña aparte:</p><p style="font-size:12px;word-break:break-all"><b>${url}</b></p>`,
        showCancelButton: true, confirmButtonText: "Compartir enlace", cancelButtonText: "Cerrar" });
      if (done.isConfirmed) {
        const text = `👥 Conteo en grupo en ${room.count.warehouse}. Entra y anota lo que cuentes (te paso la contraseña aparte):`;
        try { if (navigator.share) return void (await navigator.share({ title: "Conteo en grupo", text, url })); } catch { return; }
        window.open(`https://wa.me/?text=${encodeURIComponent(`${text}
${url}`)}`, "_blank");
      }
    }
  }

  async function finish() {
    if (!room) return;
    const people = room.people.length;
    const units = room.lines.reduce((s, l) => s + l.total, 0);
    const go = await Swal.fire({ ...swal, icon: "question", title: "¿Terminar y pasar al ajuste?",
      html: `<p style="font-size:13px">${room.lines.length} productos · ${units} und. · ${people} persona${people === 1 ? "" : "s"}.<br/>Nadie más podrá anotar. Se abre el ajuste con el total de cada producto para revisarlo y aplicarlo (con el informe de siempre). Si no lo aplicas, puedes reabrir el conteo.</p>`,
      showCancelButton: true, confirmButtonText: "Terminar y pasar al ajuste", cancelButtonText: "Seguir contando" });
    if (!go.isConfirmed) return;
    setBusy(true);
    const { data, error: e } = await supabaseBrowser().rpc("erp_gc_close", { p_id: id });
    setBusy(false);
    const r = data as { items: GroupCountItem[]; warehouse_id: string } | null;
    if (e || !r) return void toast("No se pudo terminar", "error", e ? errorMessage(e) : undefined);
    onLoad(r.items, r.warehouse_id);
  }
  async function simple(fn: "erp_gc_reopen" | "erp_gc_cancel", ask: string) {
    const go = await Swal.fire({ ...swal, icon: "question", title: ask, showCancelButton: true, confirmButtonText: "Sí", cancelButtonText: "No" });
    if (!go.isConfirmed) return;
    const { error: e } = await supabaseBrowser().rpc(fn, { p_id: id });
    if (e) return void toast("No se pudo", "error", errorMessage(e));
    if (fn === "erp_gc_cancel") return onClose();
    pollRef.current?.run();
  }

  if (!mounted) return null;
  const c = room?.count;
  return createPortal(
    <div className="fixed inset-0 z-120 flex items-stretch justify-center bg-black/60 sm:p-4" role="dialog" aria-modal="true" aria-label="Conteo en grupo">
      <section className="flex w-full max-w-3xl flex-col overflow-hidden border sm:rounded-[26px]" style={{ borderColor: "var(--t-card-border)", background: "var(--t-bg-base)", color: "var(--t-text)" }}>
        <header className="flex items-start gap-2 border-b px-4 py-3" style={{ borderColor: "var(--t-card-border)" }}>
          <div className="min-w-0 flex-1">
            <h3 className="flex flex-wrap items-center gap-2 text-base font-black">
              👥 {c?.name || (c ? `Conteo de ${c.warehouse}` : "Conteo en grupo")}
              {c?.blind ? <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ background: "color-mix(in oklab, var(--t-accent) 15%, transparent)" }}><EyeOff size={11} /> a ciegas</span> : null}
              {c && c.status !== "open" ? <span className="rounded-full px-2 py-0.5 text-[10px] font-bold text-white" style={{ background: c.status === "closed" ? "#f59e0b" : c.status === "applied" ? "#16a34a" : "#94a3b8" }}>{c.status === "closed" ? "Terminado" : c.status === "applied" ? "Aplicado" : "Anulado"}</span> : null}
            </h3>
            <p className="text-[11px]" style={{ color: "var(--t-muted)" }}>
              {c ? `${c.warehouse} · abrió ${c.created_by_name ?? "—"}` : ""}{room?.people.length ? ` · ${room.people.map((p) => `${p.name ?? "—"} (${p.units})`).join(", ")}` : ""}
            </p>
          </div>
          {room?.can_host && (c?.status === "open" || c?.status === "closed") ? (
            <button type="button" onClick={() => void pinMenu()} className="inline-flex h-9 items-center gap-1 rounded-full border px-2.5 text-[11px] font-bold"
              style={room.count.has_pin ? { borderColor: "#16a34a", color: "#16a34a" } : { borderColor: "var(--t-card-border)" }} title="Contraseña para que entre cualquiera con el enlace">
              <KeyRound size={14} /> {room.count.has_pin ? `Con contraseña${room.count.guests ? ` · ${room.count.guests}` : ""}` : "Contraseña"}
            </button>
          ) : null}
          <button type="button" onClick={() => void share()} className="grid h-9 w-9 place-items-center rounded-full border" style={{ borderColor: "var(--t-card-border)" }} aria-label="Compartir el enlace del conteo" title="Compartir el enlace (WhatsApp, copiar)"><Share2 size={16} /></button>
          <button type="button" onClick={onClose} className="grid h-9 w-9 place-items-center rounded-full border" style={{ borderColor: "var(--t-card-border)" }} aria-label="Cerrar"><X size={16} /></button>
        </header>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain p-4">
          {error ? <p className="rounded-xl border p-3 text-sm" style={{ borderColor: "#f59e0b", color: "#d97706" }}>⚠️ {error}</p> : null}
          {!room && !error ? <div className="h-40 animate-pulse rounded-2xl" style={{ background: "var(--t-card-bg)" }} /> : null}
          {c?.status === "closed" ? <p className="rounded-xl px-3 py-2 text-sm font-semibold" style={{ background: "color-mix(in oklab, #f59e0b 14%, transparent)" }}>⏳ {c.closed_by_name ?? "Alguien"} terminó el conteo: lo están revisando para aplicarlo. Ya no se anota.</p> : null}

          {open && room ? (
            <>
              <ProductPicker storeId={room.count.store_id} warehouseId={room.count.warehouse_id} keepOpen addedQty={addedQty} addedHint="Toca para sumar más"
                placeholder="🔎 Busca lo que contaste (nombre, referencia o código)…  (F2)" onPick={(h) => void addFromPicker(h)} />
              {!scanOpen ? (
                <button type="button" onClick={() => setScanOpen(true)} className="flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed p-2.5 text-sm font-bold" style={{ borderColor: "color-mix(in oklab, var(--t-accent) 45%, var(--t-card-border))", color: "var(--t-accent)" }}>
                  <ScanBarcode size={17} /> Contar escaneando (lector o cámara)
                </button>
              ) : (
                <div className="rounded-2xl border-2 p-2.5" style={{ borderColor: "var(--t-accent)" }}>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <ScanBarcode size={16} style={{ color: "var(--t-accent)" }} />
                    <button type="button" onClick={() => setScanMode("one")} className="rounded-full border px-2.5 py-1 text-[11px] font-bold" style={scanMode === "one" ? { borderColor: "var(--t-accent)", color: "var(--t-accent)" } : { borderColor: "var(--t-card-border)" }}>+1 por lectura</button>
                    <button type="button" onClick={() => setScanMode("ask")} className="rounded-full border px-2.5 py-1 text-[11px] font-bold" style={scanMode === "ask" ? { borderColor: "var(--t-accent)", color: "var(--t-accent)" } : { borderColor: "var(--t-card-border)" }}>Pregunta cuántas</button>
                    <span className="flex-1" />
                    <button type="button" onClick={() => { setScanOpen(false); setMsg(null); }} className="grid h-7 w-7 place-items-center rounded-full border" style={{ borderColor: "var(--t-card-border)" }} aria-label="Dejar de escanear"><X size={13} /></button>
                  </div>
                  <div className="mt-2 flex gap-2">
                    <input autoFocus value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" enterKeyHint="go" placeholder="Pistolea o escribe el código y Enter"
                      onKeyDown={(e) => { if ((e.key === "Enter" || e.key === "Tab") && code.trim()) { e.preventDefault(); const v = code; setCode(""); enqueue(v); } }}
                      className="h-11 min-w-0 flex-1 rounded-xl border px-3 text-sm font-bold outline-none" style={{ borderColor: "var(--t-card-border)", background: "var(--t-card-bg)", color: "var(--t-text)" }} aria-label="Código contado" />
                    <button type="button" onClick={() => setCamera(true)} className="grid h-11 w-11 place-items-center rounded-xl border" style={{ borderColor: "var(--t-card-border)" }} aria-label="Escanear con la cámara"><Camera size={18} /></button>
                  </div>
                  {msg ? <p className="mt-2 rounded-xl px-3 py-2 text-xs font-bold" style={{ background: msg.ok ? "color-mix(in oklab, #22c55e 14%, transparent)" : "color-mix(in oklab, #ef4444 14%, transparent)", color: msg.ok ? "#16a34a" : "#dc2626" }}>{msg.ok ? "✓ " : "✕ "}{msg.text}</p> : null}
                  <p className="mt-1.5 text-[11px]" style={{ color: "var(--t-muted)" }}>Solo cuenta si el código es exacto. Cada lectura suma a lo tuyo.</p>
                </div>
              )}
            </>
          ) : null}

          {room ? (
            <div>
              <div className="mb-1.5 flex items-center gap-2">
                <p className="flex-1 text-[11px] font-bold uppercase tracking-wide" style={{ color: "var(--t-muted)" }}>
                  Contado · {room.lines.length} productos · {room.lines.reduce((s, l) => s + l.total, 0)} und.
                </p>
                {(["all", "mine"] as const).map((k) => (
                  <button key={k} type="button" onClick={() => setFilter(k)} className="rounded-full border px-2.5 py-1 text-[11px] font-bold" style={filter === k ? { background: "var(--t-accent)", color: "#fff", borderColor: "var(--t-accent)" } : { borderColor: "var(--t-card-border)" }}>
                    {k === "all" ? "De todos" : "Lo mío"}
                  </button>
                ))}
              </div>
              {!lines.length ? <p className="rounded-2xl border p-4 text-center text-sm" style={{ borderColor: "var(--t-card-border)", color: "var(--t-muted)" }}>{filter === "mine" ? "Aún no anotas nada." : "Aún no hay nada contado. Busca o escanea el primer producto."}</p> : null}
              <div className="space-y-1.5">
                {lines.map((l) => {
                  const diff = l.system === null ? null : l.total - l.system;
                  return (
                    <div key={l.product_id} className="flex items-center gap-2 rounded-xl border p-2" style={{ borderColor: "var(--t-card-border)" }}>
                      <Thumb src={l.image_url} size={40} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px] font-bold">{l.name}</p>
                        <p className="truncate text-[11px]" style={{ color: "var(--t-muted)" }}>
                          {l.sku ?? "Sin código"} · {l.by.map((b) => `${b.name ?? "—"} ${b.qty}`).join(" + ")}
                          {l.system !== null ? <> · sistema {l.system}{diff ? <b style={{ color: diff > 0 ? "#10b981" : "#ef4444" }}> ({diff > 0 ? "+" : ""}{diff})</b> : " ✓"}</> : null}
                        </p>
                      </div>
                      {open ? (
                        <span className="flex shrink-0 items-center gap-1">
                          <button type="button" disabled={busy || !l.mine} onClick={() => void setQty(l.product_id, -1, true)} className="grid h-8 w-8 place-items-center rounded-lg border disabled:opacity-30" style={{ borderColor: "var(--t-card-border)" }} aria-label="Una menos en lo mío"><Minus size={14} /></button>
                          <span className="w-9 text-center text-sm font-black tabular-nums" title="Lo que anotaste tú">{l.mine ?? 0}</span>
                          <button type="button" disabled={busy} onClick={() => void setQty(l.product_id, 1, true)} className="grid h-8 w-8 place-items-center rounded-lg border" style={{ borderColor: "var(--t-card-border)" }} aria-label="Una más en lo mío"><Plus size={14} /></button>
                          {l.mine !== null ? <button type="button" onClick={async () => { const { error: e } = await supabaseBrowser().rpc("erp_gc_remove", { p_id: id, p_product: l.product_id }); if (e) void toast("No se pudo", "error", errorMessage(e)); else pollRef.current?.run(); }}
                            className="grid h-8 w-8 place-items-center rounded-lg text-red-400" aria-label="Quitar lo que anoté de este producto" title="Quitar lo mío"><Trash2 size={14} /></button> : null}
                        </span>
                      ) : null}
                      <span className="w-12 shrink-0 text-right text-lg font-black tabular-nums" title="Entre todos">{l.total}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>

        {room?.can_adjust && (c?.status === "open" || c?.status === "closed") ? (
          <footer className="flex flex-wrap gap-2 border-t p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]" style={{ borderColor: "var(--t-card-border)" }}>
            <button type="button" onClick={() => void simple("erp_gc_cancel", "¿Anular este conteo? No se ajusta nada.")} className="rounded-xl border px-3 py-2 text-xs font-bold text-red-400" style={{ borderColor: "color-mix(in oklab, #ef4444 40%, transparent)" }}>Anular</button>
            {c.status === "closed" ? <button type="button" onClick={() => void simple("erp_gc_reopen", "¿Reabrir para seguir contando?")} className="rounded-xl border px-3 py-2 text-xs font-bold" style={{ borderColor: "var(--t-card-border)" }}>Reabrir</button> : null}
            <button type="button" disabled={busy || !room.lines.length} onClick={() => void finish()} className="ml-auto rounded-xl px-4 py-2 text-sm font-black text-white disabled:opacity-50" style={{ background: "linear-gradient(135deg, var(--t-accent), color-mix(in oklab, var(--t-accent) 70%, #000))" }}>
              {c.status === "closed" ? "Pasar al ajuste →" : "Terminar y pasar al ajuste →"}
            </button>
          </footer>
        ) : null}
      </section>
      {camera ? <CameraScanner title="Contar escaneando" continuous onClose={() => setCamera(false)} onCode={(v) => enqueue(v)} hint="Cada lectura suma 1 a lo tuyo." /> : null}
    </div>,
    document.body,
  );
}
