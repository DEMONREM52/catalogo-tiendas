"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { Camera, ScanBarcode, X } from "lucide-react";
import Swal from "@/lib/swal";
import { supabaseBrowser } from "@/lib/supabase/client";
import { matchScan, parseScan } from "@/lib/scan/parse";
import { MatchToggle, matchHint, useScanMatch } from "@/components/scan/MatchToggle";
import { scanBeep } from "@/components/scan/CameraScanner";
import { srError, type SrItem } from "./types";
import { boxColor, boxTitle, type SrBox } from "./boxes";

const CameraScanner = dynamic(() => import("@/components/scan/CameraScanner").then((m) => m.CameraScanner), { ssr: false });
const swal = { background: "var(--t-bg-base)", color: "var(--t-text)", confirmButtonColor: "#8b5cf6" };

function newKey(): string {
  const c = globalThis.crypto as Crypto & { randomUUID?: () => string };
  if (typeof c.randomUUID === "function") return c.randomUUID();
  const b = c.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/**
 * Modo de escaneo para empacar (se abre a propósito; no es un buscador): cada código del pedido va a la caja activa.
 *  · «+1 por lectura» o «pregunta cuántas» (para 50 iguales no hay que escanear 50 veces).
 *  · Solo coincidencia EXACTA con la referencia o el código de barras de un producto de este pedido; si hay dos, no hace nada.
 *  · Nunca pasa de lo que falta por empacar (lo revisa también la base).
 *  · Escanear la etiqueta de una caja de este pedido la vuelve la caja activa.
 */
export function ScanToBox({ requestId, items, boxes, unboxed, reload }: {
  requestId: string; items: SrItem[]; boxes: SrBox[]; unboxed: Map<string, number>; reload: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<string>("new");
  const [mode, setMode] = useState<"one" | "ask">("one");
  const [code, setCode] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [camera, setCamera] = useState(false);
  const [barcodes, setBarcodes] = useState<Map<string, string | null> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const chain = useRef<Promise<void>>(Promise.resolve());
  const [match, setMatch] = useScanMatch();
  const latest = useRef({ active, mode, unboxed, boxes, items, barcodes, match });
  useEffect(() => { latest.current = { active, mode, unboxed, boxes, items, barcodes, match }; });
  const openBoxes = boxes.filter((b) => b.status === "open");
  const activeBox = openBoxes.find((b) => b.id === active) ?? null;

  // Los códigos de barras de los productos del pedido (solo esas columnas).
  const ids = useMemo(() => [...new Set(items.map((i) => i.product_id))], [items]);
  useEffect(() => {
    if (!open || barcodes) return;
    let alive = true;
    void supabaseBrowser().from("products").select("id,barcode").in("id", ids.slice(0, 1000)).then(({ data }) => {
      if (alive) setBarcodes(new Map(((data ?? []) as Array<{ id: string; barcode: string | null }>).map((p) => [p.id, p.barcode])));
    });
    return () => { alive = false; };
  }, [open, barcodes, ids]);
  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => inputRef.current?.focus(), 60);
    return () => window.clearTimeout(t);
  }, [open]);

  async function handle(raw: string) {
    const L = latest.current;
    const r = parseScan(raw, { hosts: [window.location.hostname] });
    if (r.kind === "empty") return;
    if (r.kind === "box") {
      const b = L.boxes.find((x) => x.token === r.token);
      if (!b) { scanBeep(false); return setMsg({ ok: false, text: "Esa caja es de otro pedido." }); }
      if (b.status !== "open") { scanBeep(false); return setMsg({ ok: false, text: `${boxTitle(b)} está cerrada: ábrela para seguir empacando.` }); }
      setActive(b.id);
      scanBeep(true);
      return setMsg({ ok: true, text: `Caja activa: ${boxTitle(b)}` });
    }
    if (r.kind !== "code") { scanBeep(false); return setMsg({ ok: false, text: "Eso no es un código de producto." }); }
    // Por código: referencia o código de barras. Coincidencia exacta: además, el nombre completo (QR con el nombre).
    const ids = new Set(matchScan(r.code, L.items.map((i) => ({ id: i.id, name: i.name, sku: i.sku, barcode: L.barcodes?.get(i.product_id) ?? null })), L.match).map((x) => x.id));
    const matches = L.items.filter((i) => ids.has(i.id));
    if (!matches.length) { scanBeep(false); return setMsg({ ok: false, text: `«${r.code}» no está en este pedido.` }); }
    if (matches.length > 1) { scanBeep(false); return setMsg({ ok: false, text: `«${r.code}» coincide con ${matches.length} productos: guárdalo a mano.` }); }
    const it = matches[0];
    const left = L.unboxed.get(it.id) ?? 0;
    if (left <= 0) { scanBeep(false); return setMsg({ ok: false, text: `${it.name}: ya está todo en cajas.` }); }
    let qty = 1;
    if (L.mode === "ask") {
      const a = await Swal.fire({ ...swal, title: it.name, text: `¿Cuántas van a la caja? Faltan ${left} sin caja.`, input: "number", inputValue: String(left),
        inputAttributes: { min: "1", max: String(left), step: "1" }, showCancelButton: true, confirmButtonText: "Guardar", cancelButtonText: "Cancelar",
        inputValidator: (v) => (Number.isInteger(Number(v)) && Number(v) >= 1 && Number(v) <= left ? null : `Entre 1 y ${left}`) });
      if (!a.isConfirmed) return;
      qty = Number(a.value);
    }
    const boxId = L.active === "new" ? null : L.active;
    const { data, error } = await supabaseBrowser().rpc("erp_sr_box_put", { p_request: requestId, p_box: boxId, p_items: [{ item_id: it.id, qty }], p_new: null, p_key: newKey() });
    if (error) { scanBeep(false); return setMsg({ ok: false, text: srError(error) }); }
    const res = data as { box_id: string; number: number };
    if (!boxId) setActive(res.box_id);
    scanBeep(true);
    setMsg({ ok: true, text: `+${qty} ${it.name} → Caja ${res.number} · quedan ${left - qty} sin caja` });
    await reload();
  }
  // Las lecturas se atienden en orden (una tras otra), aunque lleguen rápido.
  const enqueue = (raw: string) => { chain.current = chain.current.then(() => handle(raw)).catch(() => undefined); };

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed p-2.5 text-sm font-bold"
        style={{ borderColor: "color-mix(in oklab, var(--t-accent) 45%, var(--t-card-border))", color: "var(--t-accent)" }}>
        <ScanBarcode size={17} /> Escanear a una caja (lector o cámara)
      </button>
    );
  }
  return (
    <section className="rounded-2xl border-2 p-2.5" style={{ borderColor: "var(--t-accent)" }}>
      <div className="flex items-center gap-2">
        <ScanBarcode size={17} style={{ color: "var(--t-accent)" }} />
        <p className="min-w-0 flex-1 text-sm font-black">Escanear a: {activeBox ? boxTitle(activeBox) : "una caja nueva"}</p>
        <button type="button" onClick={() => { setOpen(false); setMsg(null); }} className="grid h-8 w-8 place-items-center rounded-full border" style={{ borderColor: "var(--t-card-border)" }} aria-label="Salir del modo escanear"><X size={14} /></button>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {openBoxes.map((b) => (
          <button key={b.id} type="button" onClick={() => setActive(b.id)} className="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-bold"
            style={active === b.id ? { borderColor: boxColor(b), background: boxColor(b), color: "#fff" } : { borderColor: "var(--t-card-border)" }}>Caja {b.number}</button>
        ))}
        <button type="button" onClick={() => setActive("new")} className="rounded-full border px-2.5 py-1 text-[11px] font-bold" style={active === "new" ? { borderColor: "var(--t-accent)", background: "var(--t-accent)", color: "#fff" } : { borderColor: "var(--t-card-border)" }}>＋ Nueva</button>
        <span className="mx-1 h-6 w-px self-center" style={{ background: "var(--t-card-border)" }} />
        <button type="button" onClick={() => setMode("one")} className="rounded-full border px-2.5 py-1 text-[11px] font-bold" style={mode === "one" ? { borderColor: "var(--t-accent)", color: "var(--t-accent)" } : { borderColor: "var(--t-card-border)" }}>+1 por lectura</button>
        <button type="button" onClick={() => setMode("ask")} className="rounded-full border px-2.5 py-1 text-[11px] font-bold" style={mode === "ask" ? { borderColor: "var(--t-accent)", color: "var(--t-accent)" } : { borderColor: "var(--t-card-border)" }}>Pregunta cuántas</button>
      </div>
      <div className="mt-1.5"><MatchToggle value={match} onChange={setMatch} /></div>
      <div className="mt-2 flex gap-2">
        <input ref={inputRef} value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" enterKeyHint="go" placeholder="Pistolea o escribe el código y Enter"
          onKeyDown={(e) => {
            if (e.key !== "Enter" && e.key !== "Tab") return;
            if (!code.trim()) return;
            e.preventDefault();
            const c = code;
            setCode("");
            enqueue(c);
          }}
          className="h-11 min-w-0 flex-1 rounded-xl border px-3 text-sm font-bold outline-none" style={{ borderColor: "var(--t-card-border)", background: "var(--t-card-bg)", color: "var(--t-text)" }} aria-label="Código a empacar" />
        <button type="button" onClick={() => setCamera(true)} className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border" style={{ borderColor: "var(--t-card-border)" }} aria-label="Escanear con la cámara" title="Escanear con la cámara (sigue leyendo)"><Camera size={18} /></button>
      </div>
      {msg ? (
        <p className="mt-2 rounded-xl px-3 py-2 text-xs font-bold" style={{ background: msg.ok ? "color-mix(in oklab, #22c55e 14%, transparent)" : "color-mix(in oklab, #ef4444 14%, transparent)", color: msg.ok ? "#16a34a" : "#dc2626" }}>
          {msg.ok ? "✓ " : "✕ "}{msg.text}
        </p>
      ) : null}
      <p className="mt-1.5 text-[11px]" style={{ color: "var(--t-muted)" }}>
        {matchHint(match)} Solo productos de este pedido. Escanea la etiqueta de una caja para cambiar a esa caja.{barcodes ? "" : " Cargando códigos…"}
      </p>
      {camera ? <CameraScanner title="Empacar escaneando" continuous onClose={() => setCamera(false)} onCode={(c) => enqueue(c)} hint={`Cada lectura va a ${activeBox ? boxTitle(activeBox) : "una caja nueva"}.`} /> : null}
    </section>
  );
}
