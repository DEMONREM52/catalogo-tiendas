"use client";
/* eslint-disable @next/next/no-img-element */

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import dynamic from "next/dynamic";
import { Camera, Minus, Plus, ScanBarcode, Search, Trash2, X } from "lucide-react";
import { supabaseLazy } from "@/lib/supabase/lazy";
import { startPoll } from "@/lib/net/poll";
import { useSearchValue } from "@/lib/search-timing";
import { matchScan, parseScan } from "@/lib/scan/parse";
import { MatchToggle, matchHint, notFoundText, useScanMatch } from "@/components/scan/MatchToggle";

// La cámara y SweetAlert solo se cargan si se usan (página pública: lo mínimo de entrada).
const CameraScanner = dynamic(() => import("@/components/scan/CameraScanner").then((m) => m.CameraScanner), { ssr: false });
const swalLazy = () => import("@/lib/swal").then((m) => m.default);
const beepLazy = (ok: boolean) => void import("@/components/scan/CameraScanner").then((m) => m.scanBeep(ok));

type Info = { ok: boolean; name?: string | null; status?: string; warehouse?: string; store?: string; logo_url?: string | null; locked_minutes?: number };
type Session = { guest_id: string; secret: string; name: string };
type Line = { product_id: string; name: string; sku: string | null; image_url: string | null; total: number; mine: number | null; by: Array<{ name: string | null; qty: number }> };
type Room = { count: { name: string | null; status: string; warehouse: string; store: string; created_by_name: string | null }; me: string; people: Array<{ name: string | null; units: number; mine: boolean }>; lines: Line[] };
type Hit = { id: string; name: string; sku: string | null; barcode: string | null; image_url: string | null; exact: boolean };

const card = { background: "var(--t-card-bg)", borderColor: "var(--t-card-border)", color: "var(--t-text)" } as const;
const field = "w-full rounded-xl border px-3 py-2.5 text-[15px] outline-none";
const fieldStyle = { background: "var(--t-card-bg)", borderColor: "var(--t-card-border)", color: "var(--t-text)" } as const;
const keyOf = (token: string) => `remhub:conteo:${token}`;
const swalBase = { background: "var(--t-bg-base)", color: "var(--t-text)", confirmButtonColor: "#8b5cf6" };

function newKey(): string {
  const c = globalThis.crypto as Crypto & { randomUUID?: () => string };
  if (typeof c.randomUUID === "function") return c.randomUUID();
  const b = c.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
const errText = (e: unknown) => (e && typeof e === "object" && "message" in e ? String((e as { message: unknown }).message) : "Algo falló. Intenta de nuevo.");

/**
 * Conteo en grupo para invitados (20261352): con el enlace y la contraseña, cualquiera anota lo que cuenta, sin cuenta.
 * Solo cuenta: no ve lo que dice el sistema, ni precios ni costos; terminar y aplicar lo hace el anfitrión en RemHub.
 */
export default function GuestCountPage() {
  const { token } = useParams<{ token: string }>();
  const [info, setInfo] = useState<Info | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const raw = window.localStorage.getItem(keyOf(token));
        if (raw && alive) setSession(JSON.parse(raw) as Session);
      } catch { /* sin almacenamiento */ }
      const sb = await supabaseLazy();
      const { data } = await sb.rpc("erp_gc_guest_info", { p_token: token });
      if (!alive) return;
      setInfo((data as Info | null) ?? { ok: false });
      setReady(true);
    })();
    return () => { alive = false; };
  }, [token]);

  const leave = useCallback(() => {
    try { window.localStorage.removeItem(keyOf(token)); } catch { /* sin almacenamiento */ }
    setSession(null);
  }, [token]);

  return (
    <main className="min-h-screen px-3 py-5 sm:py-8" style={{ background: "var(--t-bg), var(--t-bg-base)", color: "var(--t-text)" }}>
      <div className="mx-auto w-full max-w-xl space-y-3">
        {!ready ? <div className="rounded-3xl border p-8 text-center" style={card}>Cargando…</div>
          : !info?.ok ? (
            <div className="rounded-3xl border p-8 text-center" style={card}>
              <p className="text-3xl">🔒</p>
              <p className="mt-2 text-lg font-bold">Este enlace no está activo</p>
              <p className="mt-1 text-sm" style={{ color: "var(--t-muted)" }}>Puede que hayan cambiado el enlace o quitado la contraseña. Pídele el enlace nuevo a quien abrió el conteo.</p>
            </div>
          ) : session ? <GuestRoom token={token} session={session} onLeave={leave} />
            : <JoinForm token={token} info={info} onJoined={(s) => { try { window.localStorage.setItem(keyOf(token), JSON.stringify(s)); } catch { /* sin almacenamiento */ } setSession(s); }} />}
      </div>
    </main>
  );
}

function JoinForm({ token, info, onJoined }: { token: string; info: Info; onJoined: (s: Session) => void }) {
  const [name, setName] = useState(() => { try { return window.localStorage.getItem("remhub:conteo:nombre") ?? ""; } catch { return ""; } });
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(info.locked_minutes ? `Demasiados intentos. Espera ${info.locked_minutes} min.` : null);

  async function join() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const sb = await supabaseLazy();
      const { data, error: e } = await sb.rpc("erp_gc_guest_join", { p_token: token, p_pin: pin, p_name: name });
      const r = data as { ok: boolean; error?: string; guest_id?: string; secret?: string; name?: string } | null;
      if (e) return setError(errText(e));
      if (!r?.ok || !r.guest_id || !r.secret) return setError(r?.error ?? "No se pudo entrar.");
      try { window.localStorage.setItem("remhub:conteo:nombre", name.trim()); } catch { /* sin almacenamiento */ }
      onJoined({ guest_id: r.guest_id, secret: r.secret, name: r.name ?? name.trim() });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-3xl border p-5" style={{ ...card, boxShadow: "var(--t-shadow)" }}>
      <div className="flex items-center gap-3">
        {info.logo_url ? <img src={info.logo_url} alt="" className="h-12 w-12 rounded-xl object-contain" /> : <span className="grid h-12 w-12 place-items-center rounded-xl text-2xl" style={{ background: "var(--t-card-border)" }}>👥</span>}
        <div className="min-w-0">
          <p className="text-xs font-bold uppercase tracking-wide" style={{ color: "var(--t-muted)" }}>{info.store}</p>
          <h1 className="text-lg font-black leading-tight">Conteo en grupo{info.name ? ` · ${info.name}` : ""}</h1>
          <p className="text-sm" style={{ color: "var(--t-muted)" }}>{info.warehouse}</p>
        </div>
      </div>
      {info.status !== "open" ? (
        <p className="mt-4 rounded-xl px-3 py-2 text-sm font-semibold" style={{ background: "color-mix(in oklab, #f59e0b 14%, transparent)" }}>Este conteo ya terminó. Ya no se anota.</p>
      ) : (
        <form className="mt-4 space-y-2.5" onSubmit={(e) => { e.preventDefault(); void join(); }}>
          <label className="block text-xs font-bold" style={{ color: "var(--t-muted)" }}>Tu nombre
            <input value={name} onChange={(e) => setName(e.target.value.slice(0, 40))} autoComplete="name" className={`${field} mt-1`} style={fieldStyle} placeholder="Para saber quién contó qué" />
          </label>
          <label className="block text-xs font-bold" style={{ color: "var(--t-muted)" }}>Contraseña
            <input value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 8))} inputMode="numeric" autoComplete="one-time-code" type="password"
              className={`${field} mt-1 tracking-[0.4em]`} style={fieldStyle} placeholder="••••" />
          </label>
          {error ? <p className="text-sm font-semibold text-red-500">⚠️ {error}</p> : null}
          <button type="submit" disabled={busy || !name.trim() || pin.length < 4} className="h-12 w-full rounded-2xl text-base font-black text-white disabled:opacity-50" style={{ background: "linear-gradient(135deg, var(--t-accent), color-mix(in oklab, var(--t-accent) 70%, #000))" }}>
            {busy ? "Entrando…" : "Entrar a contar"}
          </button>
          <p className="text-[11px]" style={{ color: "var(--t-muted)" }}>Solo anotas lo que cuentas. No necesitas cuenta. Quien abrió el conteo lo revisa y lo aplica.</p>
        </form>
      )}
    </section>
  );
}

function GuestRoom({ token, session, onLeave }: { token: string; session: Session; onLeave: () => void }) {
  const [room, setRoom] = useState<Room | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const search = useSearchValue(q);
  const [hits, setHits] = useState<Hit[]>([]);
  const [searching, setSearching] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const [scanMode, setScanMode] = useState<"one" | "ask">("one");
  const [match, setMatch] = useScanMatch();
  const [code, setCode] = useState("");
  const [camera, setCamera] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [filter, setFilter] = useState<"all" | "mine">("all");
  const pollRef = useRef<ReturnType<typeof startPoll> | null>(null);
  const chain = useRef<Promise<void>>(Promise.resolve());
  const base = { p_token: token, p_guest: session.guest_id, p_secret: session.secret };

  const load = useCallback(async () => {
    const sb = await supabaseLazy();
    const { data, error: e } = await sb.rpc("erp_gc_guest_get", { p_token: token, p_guest: session.guest_id, p_secret: session.secret });
    if (e) {
      if (/Vuelve a entrar/.test(e.message)) return onLeave();
      return setError(errText(e));
    }
    setError(null);
    setRoom(data as Room);
  }, [token, session, onLeave]);

  useEffect(() => {
    const poll = startPoll(() => load(), { every: 4000, firstDelay: 0, minGap: 1500 });
    pollRef.current = poll;
    return () => { poll.stop(); pollRef.current = null; };
  }, [load]);

  // Buscar (espera a que dejes de escribir; Enter busca ya). Nunca elige solo.
  const term = search.value.trim();
  useEffect(() => {
    let alive = true;
    if (term.length < 2) { const t = window.setTimeout(() => setHits([]), 0); return () => { alive = false; window.clearTimeout(t); }; }
    const t0 = window.setTimeout(() => setSearching(true), 0);
    void supabaseLazy().then((sb) => sb.rpc("erp_gc_guest_search", { p_token: token, p_guest: session.guest_id, p_secret: session.secret, p_q: term })).then(({ data }) => {
      if (alive) { setHits((data ?? []) as Hit[]); setSearching(false); }
    });
    return () => { alive = false; window.clearTimeout(t0); };
  }, [term, token, session]);

  async function put(productId: string, qty: number, add: boolean, key?: string) {
    const sb = await supabaseLazy();
    const { data, error: e } = await sb.rpc("erp_gc_guest_set", { ...base, p_product: productId, p_qty: qty, p_add: add, p_key: key ?? null });
    if (e) {
      if (/Vuelve a entrar/.test(e.message)) { onLeave(); return null; }
      const Swal = await swalLazy();
      void Swal.fire({ ...swalBase, icon: "error", title: "No se guardó", text: errText(e) });
      return null;
    }
    pollRef.current?.run();
    return data as { mine: number; total: number };
  }

  async function count(hit: { id: string; name: string }) {
    const mine = room?.lines.find((l) => l.product_id === hit.id)?.mine ?? 0;
    const Swal = await swalLazy();
    const r = await Swal.fire({ ...swalBase, title: hit.name, text: mine ? `Llevas ${mine}. ¿Cuántas más contaste?` : "¿Cuántas contaste?", input: "number", inputValue: "1",
      inputAttributes: { min: "0", step: "1", inputmode: "numeric" }, showCancelButton: true, confirmButtonText: "Anotar", cancelButtonText: "Cancelar",
      inputValidator: (v) => (Number.isInteger(Number(v)) && Number(v) >= 0 && Number(v) <= 1000000 ? null : "Escribe un número entero (0 si no hay)") });
    if (!r.isConfirmed) return;
    const n = Number(r.value);
    const res = n === 0 && !mine ? await put(hit.id, 0, false) : await put(hit.id, n, true);
    if (res) setMsg({ ok: true, text: `${hit.name}: llevas ${res.mine} · entre todos ${res.total}` });
  }

  async function handleScan(raw: string) {
    const p = parseScan(raw, { hosts: [window.location.hostname] });
    if (p.kind !== "code") { if (p.kind !== "empty") { beepLazy(false); setMsg({ ok: false, text: "Eso no es un código de producto." }); } return; }
    const sb = await supabaseLazy();
    const { data } = await sb.rpc("erp_gc_guest_search", { ...base, p_q: p.code });
    // Por código: referencia o código de barras. Coincidencia exacta: además, el nombre completo (QR con el nombre).
    const exact = matchScan(p.code, (data ?? []) as Hit[], match);
    if (!exact.length) { beepLazy(false); return setMsg({ ok: false, text: notFoundText(p.code, match) }); }
    if (exact.length > 1) { beepLazy(false); return setMsg({ ok: false, text: `«${p.code}» coincide con ${exact.length} productos: búscalo y elígelo a mano.` }); }
    const h = exact[0];
    if (scanMode === "ask") return void (await count(h));
    const res = await put(h.id, 1, true, newKey());
    if (!res) { beepLazy(false); return; }
    beepLazy(true);
    setMsg({ ok: true, text: `+1 ${h.name} · llevas ${res.mine} · entre todos ${res.total}` });
  }
  const enqueue = (raw: string) => { chain.current = chain.current.then(() => handleScan(raw)).catch(() => undefined); };

  const open = room?.count.status === "open";
  const lines = (room?.lines ?? []).filter((l) => filter === "all" || l.mine !== null);
  return (
    <>
      <header className="rounded-3xl border p-4" style={card}>
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-bold uppercase tracking-wide" style={{ color: "var(--t-muted)" }}>{room?.count.store ?? ""}</p>
            <h1 className="text-lg font-black leading-tight">👥 {room?.count.name || "Conteo en grupo"} · {room?.count.warehouse ?? ""}</h1>
            <p className="text-xs" style={{ color: "var(--t-muted)" }}>Cuentas como <b>{session.name}</b>{room?.people.length ? ` · ${room.people.map((p) => `${p.name ?? "—"} (${p.units})`).join(", ")}` : ""}</p>
          </div>
          <button type="button" onClick={onLeave} className="rounded-full border px-3 py-1 text-xs font-bold" style={{ borderColor: "var(--t-card-border)" }}>Salir</button>
        </div>
      </header>
      {error ? <p className="rounded-2xl border p-3 text-sm" style={{ borderColor: "#f59e0b", color: "#d97706" }}>⚠️ {error}</p> : null}
      {room && !open ? <p className="rounded-2xl px-3 py-2 text-sm font-semibold" style={{ background: "color-mix(in oklab, #f59e0b 14%, transparent)" }}>⏳ El conteo terminó. Gracias: ya no se anota.</p> : null}

      {open ? (
        <section className="space-y-2 rounded-3xl border p-3" style={card}>
          <label className="flex items-center gap-2 rounded-xl border px-3 py-2" style={fieldStyle}>
            <Search size={16} style={{ color: "var(--t-muted)" }} />
            <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); search.flush(); } }}
              placeholder="Busca lo que contaste (nombre, referencia o código)…" enterKeyHint="search" autoComplete="off" className="min-w-0 flex-1 bg-transparent text-[15px] outline-none" />
            {q ? <button type="button" onClick={() => setQ("")} aria-label="Limpiar"><X size={15} /></button> : null}
          </label>
          {searching ? <p className="text-xs" style={{ color: "var(--t-muted)" }}>Buscando…</p> : null}
          {term.length >= 2 && !searching && !hits.length ? <p className="text-xs" style={{ color: "var(--t-muted)" }}>Nada con «{term}».</p> : null}
          {hits.map((h) => (
            <button key={h.id} type="button" onClick={() => void count(h)} className="flex w-full items-center gap-2 rounded-xl border p-2 text-left" style={{ borderColor: "var(--t-card-border)" }}>
              {h.image_url ? <img src={h.image_url} alt="" loading="lazy" className="h-10 w-10 rounded-lg object-cover" /> : <span className="h-10 w-10 rounded-lg" style={{ background: "var(--t-card-border)" }} />}
              <span className="min-w-0 flex-1"><span className="block truncate text-sm font-bold">{h.name}</span><span className="block truncate text-[11px]" style={{ color: "var(--t-muted)" }}>{h.sku ?? "Sin referencia"}</span></span>
              <span className="text-xs font-black" style={{ color: "var(--t-accent)" }}>+ Contar</span>
            </button>
          ))}
          {!scanOpen ? (
            <button type="button" onClick={() => setScanOpen(true)} className="flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed p-2.5 text-sm font-bold" style={{ borderColor: "color-mix(in oklab, var(--t-accent) 45%, var(--t-card-border))", color: "var(--t-accent)" }}>
              <ScanBarcode size={17} /> Contar escaneando (lector o cámara)
            </button>
          ) : (
            <div className="rounded-2xl border-2 p-2.5" style={{ borderColor: "var(--t-accent)" }}>
              <div className="flex flex-wrap items-center gap-1.5">
                <button type="button" onClick={() => setScanMode("one")} className="rounded-full border px-2.5 py-1 text-[11px] font-bold" style={scanMode === "one" ? { borderColor: "var(--t-accent)", color: "var(--t-accent)" } : { borderColor: "var(--t-card-border)" }}>+1 por lectura</button>
                <button type="button" onClick={() => setScanMode("ask")} className="rounded-full border px-2.5 py-1 text-[11px] font-bold" style={scanMode === "ask" ? { borderColor: "var(--t-accent)", color: "var(--t-accent)" } : { borderColor: "var(--t-card-border)" }}>Pregunta cuántas</button>
                <span className="flex-1" />
                <button type="button" onClick={() => { setScanOpen(false); setMsg(null); }} className="grid h-7 w-7 place-items-center rounded-full border" style={{ borderColor: "var(--t-card-border)" }} aria-label="Dejar de escanear"><X size={13} /></button>
              </div>
              <div className="mt-1.5"><MatchToggle value={match} onChange={setMatch} /></div>
              <p className="mt-1 text-[11px]" style={{ color: "var(--t-muted)" }}>{matchHint(match)}</p>
              <div className="mt-2 flex gap-2">
                <input autoFocus value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" enterKeyHint="go" placeholder="Pistolea o escribe el código y Enter"
                  onKeyDown={(e) => { if ((e.key === "Enter" || e.key === "Tab") && code.trim()) { e.preventDefault(); const v = code; setCode(""); enqueue(v); } }}
                  className="h-11 min-w-0 flex-1 rounded-xl border px-3 text-sm font-bold outline-none" style={fieldStyle} aria-label="Código contado" />
                <button type="button" onClick={() => setCamera(true)} className="grid h-11 w-11 place-items-center rounded-xl border" style={{ borderColor: "var(--t-card-border)" }} aria-label="Escanear con la cámara"><Camera size={18} /></button>
              </div>
            </div>
          )}
          {msg ? <p className="rounded-xl px-3 py-2 text-xs font-bold" style={{ background: msg.ok ? "color-mix(in oklab, #22c55e 14%, transparent)" : "color-mix(in oklab, #ef4444 14%, transparent)", color: msg.ok ? "#16a34a" : "#dc2626" }}>{msg.ok ? "✓ " : "✕ "}{msg.text}</p> : null}
        </section>
      ) : null}

      <section className="rounded-3xl border p-3" style={card}>
        <div className="mb-2 flex items-center gap-2">
          <p className="flex-1 text-xs font-bold uppercase tracking-wide" style={{ color: "var(--t-muted)" }}>Contado · {room?.lines.length ?? 0} productos · {(room?.lines ?? []).reduce((s, l) => s + l.total, 0)} und.</p>
          {(["all", "mine"] as const).map((k) => (
            <button key={k} type="button" onClick={() => setFilter(k)} className="rounded-full border px-2.5 py-1 text-[11px] font-bold" style={filter === k ? { background: "var(--t-accent)", color: "#fff", borderColor: "var(--t-accent)" } : { borderColor: "var(--t-card-border)" }}>{k === "all" ? "De todos" : "Lo mío"}</button>
          ))}
        </div>
        {!lines.length ? <p className="py-4 text-center text-sm" style={{ color: "var(--t-muted)" }}>{filter === "mine" ? "Aún no anotas nada." : "Aún no hay nada contado."}</p> : null}
        <div className="space-y-1.5">
          {lines.map((l) => (
            <div key={l.product_id} className="flex items-center gap-2 rounded-xl border p-2" style={{ borderColor: "var(--t-card-border)" }}>
              {l.image_url ? <img src={l.image_url} alt="" loading="lazy" className="h-10 w-10 rounded-lg object-cover" /> : <span className="h-10 w-10 shrink-0 rounded-lg" style={{ background: "var(--t-card-border)" }} />}
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-bold">{l.name}</p>
                <p className="truncate text-[11px]" style={{ color: "var(--t-muted)" }}>{l.sku ?? "Sin referencia"} · {l.by.map((b) => `${b.name ?? "—"} ${b.qty}`).join(" + ")}</p>
              </div>
              {open ? (
                <span className="flex shrink-0 items-center gap-1">
                  <button type="button" disabled={!l.mine} onClick={() => void put(l.product_id, -1, true)} className="grid h-8 w-8 place-items-center rounded-lg border disabled:opacity-30" style={{ borderColor: "var(--t-card-border)" }} aria-label="Una menos en lo mío"><Minus size={14} /></button>
                  <span className="w-8 text-center text-sm font-black tabular-nums">{l.mine ?? 0}</span>
                  <button type="button" onClick={() => void put(l.product_id, 1, true)} className="grid h-8 w-8 place-items-center rounded-lg border" style={{ borderColor: "var(--t-card-border)" }} aria-label="Una más en lo mío"><Plus size={14} /></button>
                  {l.mine !== null ? (
                    <button type="button" aria-label="Quitar lo que anoté" className="grid h-8 w-8 place-items-center rounded-lg text-red-400"
                      onClick={async () => { const sb = await supabaseLazy(); const { error: e } = await sb.rpc("erp_gc_guest_remove", { ...base, p_product: l.product_id }); if (!e) pollRef.current?.run(); }}>
                      <Trash2 size={14} />
                    </button>
                  ) : null}
                </span>
              ) : null}
              <span className="w-10 shrink-0 text-right text-lg font-black tabular-nums" title="Entre todos">{l.total}</span>
            </div>
          ))}
        </div>
      </section>
      {camera ? <CameraScanner title="Contar escaneando" continuous onClose={() => setCamera(false)} onCode={(v) => enqueue(v)} hint="Cada lectura suma 1 a lo tuyo." /> : null}
    </>
  );
}
