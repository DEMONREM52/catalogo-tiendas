"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { supabaseBrowser } from "@/lib/supabase/client";

/**
 * Cumpleaños del equipo 🎂 (20261251): botón en el encabezado con lo que viene, celebración a pantalla completa
 * el día del cumpleaños (confeti, globos, pastel y la canción), recordatorio el día anterior y muro de felicitaciones.
 * Lo ve todo el equipo de la tienda (solo nombre, punto y día; nunca datos de nómina).
 */

type Wish = { author: string | null; emoji: string; message: string; mine: boolean; at: string };
type Bday = { employee_id: string; name: string; first_name: string; point: string | null; month: number; day: number; date: string; days_left: number; age: number | null; wishes: Wish[] };

const EMOJIS = ["🎉", "🎂", "🥳", "🎁", "🎈", "💐", "❤️", "🌟", "🍰", "🙌"];
const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const COLORS = ["#f43f5e", "#f59e0b", "#22c55e", "#3b82f6", "#a855f7", "#ec4899", "#14b8a6", "#facc15"];
const cap = (s: string) => s.toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase());
const when = (d: number) => (d < 0 ? `hace ${-d} día${d === -1 ? "" : "s"}` : d === 0 ? "¡HOY!" : d === 1 ? "mañana" : `en ${d} días`);
const store = { get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* sin almacenamiento */ } } };

/** «Feliz cumpleaños» con la tarjeta de sonido del navegador (solo al tocar el botón). */
function playSong() {
  const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return;
  const ctx = new Ctx();
  const N: Record<string, number> = { G4: 392, A4: 440, B4: 494, C5: 523, D5: 587, E5: 659, F5: 698, G5: 784 };
  const song: Array<[string, number]> = [
    ["G4", 0.75], ["G4", 0.25], ["A4", 1], ["G4", 1], ["C5", 1], ["B4", 2],
    ["G4", 0.75], ["G4", 0.25], ["A4", 1], ["G4", 1], ["D5", 1], ["C5", 2],
    ["G4", 0.75], ["G4", 0.25], ["G5", 1], ["E5", 1], ["C5", 1], ["B4", 1], ["A4", 2],
    ["F5", 0.75], ["F5", 0.25], ["E5", 1], ["C5", 1], ["D5", 1], ["C5", 2],
  ];
  let t = ctx.currentTime + 0.05;
  const beat = 0.38;
  for (const [note, len] of song) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "triangle";
    o.frequency.value = N[note];
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.25, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len * beat * 0.95);
    o.connect(g).connect(ctx.destination);
    o.start(t);
    o.stop(t + len * beat);
    t += len * beat;
  }
  window.setTimeout(() => void ctx.close(), (t - ctx.currentTime + 1) * 1000);
}

/** Confeti en un lienzo a pantalla completa (se detiene solo y respeta «reducir movimiento»). */
function Confetti({ seconds = 7 }: { seconds?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const fit = () => { c.width = window.innerWidth; c.height = window.innerHeight; };
    fit();
    window.addEventListener("resize", fit);
    const pieces = Array.from({ length: reduce ? 40 : 220 }, () => ({
      x: Math.random() * c.width, y: -20 - Math.random() * c.height, w: 6 + Math.random() * 8, h: 8 + Math.random() * 10,
      vx: -1.5 + Math.random() * 3, vy: 2 + Math.random() * 4, r: Math.random() * Math.PI, vr: -0.2 + Math.random() * 0.4,
      color: COLORS[Math.floor(Math.random() * COLORS.length)], round: Math.random() < 0.3,
    }));
    const end = performance.now() + seconds * 1000;
    let raf = 0;
    const tick = (now: number) => {
      ctx.clearRect(0, 0, c.width, c.height);
      for (const p of pieces) {
        p.x += p.vx + Math.sin(now / 600 + p.r) * 0.6;
        p.y += p.vy;
        p.r += p.vr;
        if (p.y > c.height + 20 && now < end) { p.y = -20; p.x = Math.random() * c.width; }
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.r);
        ctx.fillStyle = p.color;
        if (p.round) { ctx.beginPath(); ctx.arc(0, 0, p.w / 2, 0, Math.PI * 2); ctx.fill(); } else ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
      }
      if (now < end + 4000) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", fit); };
  }, [seconds]);
  return <canvas ref={ref} className="pointer-events-none fixed inset-0 z-[210]" aria-hidden />;
}

function Balloons() {
  return (
    <div className="pointer-events-none fixed inset-0 z-[205] overflow-hidden" aria-hidden>
      {Array.from({ length: 12 }, (_, i) => (
        <span key={i} className="rh-balloon absolute text-5xl sm:text-6xl" style={{ left: `${(i * 8.3 + 3) % 96}%`, animationDelay: `${(i % 6) * 0.7}s`, animationDuration: `${7 + (i % 4)}s` }}>
          {["🎈", "🎈", "🎉", "🎈", "🥳", "🎈"][i % 6]}
        </span>
      ))}
    </div>
  );
}

function WishBox({ storeId, b, onSent }: { storeId: string; b: Bday; onSent: () => void }) {
  const mine = b.wishes.find((w) => w.mine);
  const [emoji, setEmoji] = useState(mine?.emoji ?? "🎉");
  const [msg, setMsg] = useState(mine?.message ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function send() {
    setBusy(true);
    setErr(null);
    const { data, error } = await supabaseBrowser().rpc("erp_birthday_wish", { p_store: storeId, p_employee: b.employee_id, p_emoji: emoji, p_message: msg });
    setBusy(false);
    const r = data as { ok: boolean; message?: string } | null;
    if (error || !r?.ok) return setErr(error?.message ?? r?.message ?? "No se pudo enviar.");
    onSent();
  }
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {EMOJIS.map((e) => (
          <button key={e} type="button" onClick={() => setEmoji(e)} className="grid h-10 w-10 place-items-center rounded-full border text-xl transition hover:scale-110"
            style={{ borderColor: emoji === e ? "#ec4899" : "var(--t-card-border)", background: emoji === e ? "color-mix(in oklab, #ec4899 18%, transparent)" : "transparent" }}>{e}</button>
        ))}
      </div>
      <textarea value={msg} maxLength={280} onChange={(e) => setMsg(e.target.value)} rows={2} placeholder={`Escríbele algo bonito a ${cap(b.first_name)}…`}
        className="w-full rounded-2xl border px-3 py-2 text-sm outline-none" style={{ borderColor: "var(--t-card-border)", background: "var(--t-card-bg)", color: "var(--t-text)" }} />
      {err ? <p className="text-xs" style={{ color: "#ef4444" }}>{err}</p> : null}
      <button type="button" disabled={busy || !msg.trim()} onClick={() => void send()} className="w-full rounded-full px-4 py-2.5 text-sm font-black text-white transition hover:brightness-110 disabled:opacity-50"
        style={{ background: "linear-gradient(135deg,#f43f5e,#a855f7,#3b82f6)" }}>
        {busy ? "Enviando…" : mine ? "Cambiar mi felicitación" : `${emoji} Felicitar a ${cap(b.first_name)}`}
      </button>
    </div>
  );
}

function Wall({ wishes }: { wishes: Wish[] }) {
  if (!wishes.length) return <p className="text-center text-xs" style={{ color: "var(--t-muted)" }}>Sé el primero en felicitar 🎉</p>;
  return (
    <div className="grid max-h-48 gap-2 overflow-auto sm:grid-cols-2">
      {wishes.map((w, i) => (
        <div key={i} className="rh-pop rounded-2xl border p-2.5 text-xs" style={{ borderColor: "var(--t-card-border)", background: `color-mix(in oklab, ${COLORS[i % COLORS.length]} 10%, var(--t-card-bg))`, animationDelay: `${i * 0.08}s` }}>
          <span className="mr-1 text-lg">{w.emoji}</span>{w.message}
          <span className="mt-1 block font-bold opacity-70">— {w.author ?? "Alguien del equipo"}{w.mine ? " (tú)" : ""}</span>
        </div>
      ))}
    </div>
  );
}

export function BirthdayHub({ storeId }: { storeId: string }) {
  const [items, setItems] = useState<Bday[]>([]);
  const [party, setParty] = useState<Bday[] | null>(null);
  const [panel, setPanel] = useState(false);
  const [banner, setBanner] = useState<Bday[] | null>(null);
  const [mounted, setMounted] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await supabaseBrowser().rpc("erp_birthdays", { p_store: storeId, p_days: 31 });
    const r = data as { ok: boolean; today: string; items: Bday[] } | null;
    if (error || !r?.ok) return null;
    setItems(r.items);
    return r;
  }, [storeId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
    let alive = true;
    void load().then((r) => {
      if (!alive || !r) return;
      const today = r.items.filter((b) => b.days_left === 0);
      const tomorrow = r.items.filter((b) => b.days_left === 1);
      const forced = new URLSearchParams(window.location.search).get("cumple") === "1";
      const k = `remhub:bday:${storeId}:${r.today}`;
      // La fiesta sale sola una vez al día por equipo (o al abrir el aviso del celular).
      if (today.length && (forced || !store.get(k))) { store.set(k, "1"); setParty(today); }
      else if (forced) setPanel(true);
      else if (tomorrow.length && !store.get(`${k}:t`)) { store.set(`${k}:t`, "1"); setBanner(tomorrow); }
    });
    const t = window.setInterval(() => void load(), 30 * 60_000);
    return () => { alive = false; window.clearInterval(t); };
  }, [load, storeId]);

  const today = items.filter((b) => b.days_left === 0);
  const soon = items.filter((b) => b.days_left > 0 && b.days_left <= 7).length;
  const refresh = async () => {
    const r = await load();
    if (r && party) setParty(r.items.filter((b) => party.some((p) => p.employee_id === b.employee_id)));
  };

  if (!items.length) return null;
  return (
    <>
      <style>{`
        @keyframes rh-rise { 0% { transform: translateY(110vh) rotate(-6deg); opacity: 0 } 10% { opacity: 1 } 100% { transform: translateY(-20vh) rotate(8deg); opacity: .9 } }
        .rh-balloon { bottom: -10vh; animation: rh-rise linear infinite; }
        @keyframes rh-bounce { 0%,100% { transform: translateY(0) scale(1) } 50% { transform: translateY(-14px) scale(1.06) } }
        .rh-cake { animation: rh-bounce 1.4s ease-in-out infinite; display: inline-block; }
        @keyframes rh-pop { from { transform: scale(.85); opacity: 0 } to { transform: scale(1); opacity: 1 } }
        .rh-pop { animation: rh-pop .35s ease-out both; }
        @keyframes rh-shine { 0% { background-position: 0% 50% } 100% { background-position: 200% 50% } }
        .rh-shine { background: linear-gradient(90deg,#f43f5e,#f59e0b,#22c55e,#3b82f6,#a855f7,#f43f5e); background-size: 200% auto; -webkit-background-clip: text; background-clip: text; color: transparent; animation: rh-shine 3s linear infinite; }
        @keyframes rh-wiggle { 0%,100% { transform: rotate(0) } 25% { transform: rotate(-12deg) } 75% { transform: rotate(12deg) } }
        .rh-wiggle { animation: rh-wiggle 1s ease-in-out infinite; display: inline-block; }
        @media (prefers-reduced-motion: reduce) { .rh-balloon, .rh-cake, .rh-shine, .rh-wiggle { animation: none !important; } .rh-balloon { display: none; } }
      `}</style>

      <button type="button" onClick={() => (today.length ? setParty(today) : setPanel(true))} title="Cumpleaños del equipo"
        className="relative grid h-10 w-10 place-items-center rounded-full border text-lg transition hover:scale-105" style={{ borderColor: today.length ? "#ec4899" : "var(--t-card-border)", background: today.length ? "color-mix(in oklab, #ec4899 16%, transparent)" : "transparent" }}>
        <span className={today.length ? "rh-wiggle" : ""}>🎂</span>
        {today.length || soon ? (
          <span className="absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full px-1 text-[10px] font-black text-white" style={{ background: today.length ? "#ec4899" : "#a855f7" }}>{today.length || soon}</span>
        ) : null}
      </button>

      {mounted && banner ? createPortal(
        <div className="rh-pop fixed bottom-4 left-1/2 z-[150] w-[min(440px,calc(100%-24px))] -translate-x-1/2 rounded-3xl border p-4 shadow-2xl" style={{ borderColor: "#a855f7", background: "var(--t-bg-base)", color: "var(--t-text)" }}>
          <div className="flex items-start gap-3">
            <span className="rh-wiggle text-3xl">🎈</span>
            <div className="min-w-0 flex-1">
              <b className="block">Mañana cumple{banner.length > 1 ? "n" : ""} {banner.map((b) => cap(b.first_name)).join(" y ")}</b>
              <span className="text-xs" style={{ color: "var(--t-muted)" }}>¡Prepara la sorpresa! Ya puedes dejar tu felicitación.</span>
            </div>
            <button type="button" onClick={() => setBanner(null)} aria-label="Cerrar">✕</button>
          </div>
          <button type="button" onClick={() => { setBanner(null); setPanel(true); }} className="mt-3 w-full rounded-full px-4 py-2 text-sm font-bold text-white" style={{ background: "linear-gradient(135deg,#a855f7,#ec4899)" }}>🎁 Ver cumpleaños</button>
        </div>, document.body) : null}

      {mounted && party?.length ? createPortal(
        <>
          <Confetti />
          <Balloons />
          <div className="fixed inset-0 z-[200] grid place-items-center bg-black/60 p-3 backdrop-blur-sm" onClick={() => setParty(null)}>
            <div className="rh-pop relative max-h-[92vh] w-full max-w-xl overflow-auto rounded-[32px] border p-5 text-center shadow-2xl sm:p-7" onClick={(e) => e.stopPropagation()}
              style={{ borderColor: "#ec4899", background: "radial-gradient(circle at top, color-mix(in oklab, #ec4899 22%, var(--t-bg-base)), var(--t-bg-base) 60%)", color: "var(--t-text)" }}>
              <button type="button" onClick={() => setParty(null)} className="absolute right-4 top-4 text-lg" aria-label="Cerrar">✕</button>
              <div className="rh-cake text-7xl sm:text-8xl">🎂</div>
              <p className="mt-2 text-xs font-black uppercase tracking-[0.3em]" style={{ color: "#ec4899" }}>{party[0].days_left === 0 ? "¡Hoy es un gran día!" : party[0].days_left > 0 ? `Se viene · ${when(party[0].days_left)}` : `Fue ${when(party[0].days_left)}`}</p>
              <h2 className="rh-shine mt-1 text-3xl font-black sm:text-4xl">¡Feliz cumpleaños{party.length === 1 ? `, ${cap(party[0].first_name)}` : ""}!</h2>
              {party.length > 1 ? <p className="mt-1 text-lg font-black">{party.map((b) => cap(b.first_name)).join(" · ")}</p> : null}
              {party.map((b) => (
                <div key={b.employee_id} className="mt-4 space-y-3 rounded-3xl border p-4 text-left" style={{ borderColor: "var(--t-card-border)", background: "color-mix(in oklab, var(--t-card-bg) 85%, transparent)" }}>
                  <p className="text-center text-sm">
                    <b>{cap(b.name)}</b>{b.point ? ` · 📍 ${b.point}` : ""}{b.age ? <span className="ml-1 rounded-full px-2 py-0.5 text-xs font-black text-white" style={{ background: "#f59e0b" }}>🎉 {b.age} años</span> : null}
                  </p>
                  <Wall wishes={b.wishes} />
                  <WishBox storeId={storeId} b={b} onSent={() => void refresh()} />
                </div>
              ))}
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                <button type="button" onClick={playSong} className="rounded-full border px-4 py-2 text-sm font-bold" style={{ borderColor: "var(--t-card-border)" }}>🎵 Cantar «Feliz cumpleaños»</button>
                <button type="button" onClick={() => { setParty(null); setPanel(true); }} className="rounded-full border px-4 py-2 text-sm font-bold" style={{ borderColor: "var(--t-card-border)" }}>📅 Todos los cumpleaños</button>
              </div>
            </div>
          </div>
        </>, document.body) : null}

      {mounted && panel ? createPortal(
        <div className="fixed inset-0 z-[180] grid place-items-center bg-black/55 p-3 backdrop-blur-sm" onClick={() => setPanel(false)}>
          <div className="rh-pop max-h-[90vh] w-full max-w-lg overflow-auto rounded-3xl border p-5" style={{ borderColor: "var(--t-card-border)", background: "var(--t-bg-base)", color: "var(--t-text)" }} onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-lg font-black">🎂 Cumpleaños del equipo</h3>
              <button type="button" onClick={() => setPanel(false)} aria-label="Cerrar">✕</button>
            </div>
            <ul className="space-y-2">
              {items.map((b, i) => (
                <li key={b.employee_id} className="flex items-center gap-3 rounded-2xl border p-3" style={{ borderColor: b.days_left === 0 ? "#ec4899" : "var(--t-card-border)", background: b.days_left === 0 ? "color-mix(in oklab, #ec4899 12%, transparent)" : "transparent" }}>
                  <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl text-center text-white" style={{ background: COLORS[i % COLORS.length] }}>
                    <span className="leading-none"><b className="block text-lg">{b.day}</b><span className="text-[10px] uppercase">{MONTHS[b.month - 1].slice(0, 3)}</span></span>
                  </span>
                  <span className="min-w-0 flex-1">
                    <b className="block truncate">{cap(b.name)}</b>
                    <span className="text-xs" style={{ color: "var(--t-muted)" }}>{b.point ? `📍 ${b.point} · ` : ""}{b.wishes.length ? `💌 ${b.wishes.length} felicitación${b.wishes.length === 1 ? "" : "es"}` : "sin felicitaciones aún"}</span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="block text-xs font-black" style={{ color: b.days_left === 0 ? "#ec4899" : b.days_left <= 7 ? "#a855f7" : "var(--t-muted)" }}>{when(b.days_left)}</span>
                    {b.days_left <= 7 ? (
                      <button type="button" onClick={() => { setPanel(false); setParty([b]); }} className="mt-1 rounded-full px-3 py-1 text-xs font-bold text-white" style={{ background: "linear-gradient(135deg,#f43f5e,#a855f7)" }}>🎉 Felicitar</button>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-center text-xs" style={{ color: "var(--t-muted)" }}>Las felicitaciones se abren 7 días antes. A todos les llega un aviso una semana antes, el día anterior y el mismo día.</p>
          </div>
        </div>, document.body) : null}
    </>
  );
}
