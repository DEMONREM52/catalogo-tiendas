"use client";

import { useCallback, useEffect, useState } from "react";
import Swal from "sweetalert2";
import { Check, ChevronDown, Copy, KeyRound, Plug, Plus, RefreshCw, Star, Trash2, Zap } from "lucide-react";
import { errorText, fiscalApi } from "@/lib/fiscal/client";

/**
 * Bold de la tienda: varias cuentas (una por punto o una para todos), cada una con sus llaves de pruebas
 * y de producción, y qué cuenta usa cada punto. Solo el dueño la ve y la cambia.
 */
type Mode = "test" | "production";
type Account = {
  id: string; name: string; mode: Mode; active: boolean; is_default: boolean; has_test: boolean; has_prod: boolean;
  test_identity: string; prod_identity: string; last_ok_at: string | null; last_error: string | null; last_event_at: string | null;
  month: { approved: number; total: number; tries: number };
};
type Overview = { accounts: Account[]; points: Array<{ id: string; name: string; kind: string | null }>; links: Array<{ point_id: string; account_id: string }> };
type Draft = { id?: string; name: string; mode: Mode; test_identity: string; test_secret: string; prod_identity: string; prod_secret: string };

const theme = { background: "var(--t-bg-base)", color: "var(--t-text)", confirmButtonColor: "#10b981" };
const box = { borderColor: "var(--t-card-border)", background: "color-mix(in oklab, var(--t-card-bg) 92%, transparent)" } as const;
const input = "w-full rounded-xl border px-3 py-2.5 text-sm outline-none";
const money = (v: number) => `$${Math.round(v).toLocaleString("es-CO")}`;
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("es-CO", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "");
const EMPTY: Draft = { name: "", mode: "test", test_identity: "", test_secret: "", prod_identity: "", prod_secret: "" };

export default function BoldPanel({ storeId, isOwner }: { storeId: string | null; isOwner: boolean }) {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [help, setHelp] = useState(false);

  const load = useCallback(async () => {
    if (!storeId || !isOwner) return;
    try {
      setData(await fiscalApi<Overview>(`/api/payments/bold/accounts?store_id=${storeId}`, undefined, "GET"));
      setError("");
    } catch (e) {
      setError(errorText(e));
    }
  }, [storeId, isOwner]);
  useEffect(() => { void load(); }, [load]);

  async function act(action: string, body: Record<string, unknown>, key: string, okText?: string) {
    setBusy(key);
    try {
      const r = await fiscalApi<Overview & { results?: Record<string, string>; ready?: boolean }>("/api/payments/bold/accounts", { store_id: storeId, action, ...body });
      setData(r);
      if (okText) void Swal.fire({ icon: "success", title: okText, timer: 1600, showConfirmButton: false, ...theme });
      return r;
    } catch (e) {
      void Swal.fire({ icon: "error", title: "No se pudo", text: errorText(e), ...theme });
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    if (!draft) return;
    const r = await act("save", draft, "save");
    if (!r) return;
    setDraft(null);
    void Swal.fire({
      icon: r.ready ? "success" : "info", ...theme,
      title: r.ready ? "Cuenta Bold lista 🔒" : "Guardada",
      text: r.ready ? "Las llaves quedaron cifradas. Ahora copia la dirección de avisos (webhook) en tu panel de Bold y toca «Probar conexión»."
        : `Para cobrar en ${draft.mode === "production" ? "producción" : "pruebas"} faltan las dos llaves de ese modo.`,
    });
  }

  async function test(a: Account) {
    const r = await act("test", { id: a.id }, `test-${a.id}`);
    if (!r?.results) return;
    const lines = Object.entries(r.results).map(([m, v]) => `${m === "test" ? "🧪 Pruebas" : "🚀 Producción"}: ${v === "ok" ? "✅ Bold aceptó la llave" : `❌ ${v}`}`);
    const good = Object.values(r.results).every((v) => v === "ok");
    void Swal.fire({ icon: good ? "success" : "error", title: good ? "¡Conexión con Bold lista!" : "Bold no aceptó una llave", html: lines.join("<br/>"), ...theme });
  }

  async function remove(a: Account) {
    const ok = await Swal.fire({ icon: "warning", title: `¿Borrar «${a.name}»?`, text: "Los puntos que la usan pasan a la cuenta por defecto. Los pagos ya hechos se conservan.", showCancelButton: true, confirmButtonText: "Sí, borrar", cancelButtonText: "No", ...theme, confirmButtonColor: "#ef4444" });
    if (ok.isConfirmed) await act("delete", { id: a.id }, `del-${a.id}`, "Cuenta borrada");
  }

  async function setMode(a: Account, mode: Mode) {
    if (a.mode === mode) return;
    if (mode === "production") {
      const ok = await Swal.fire({ icon: "question", title: "¿Pasar a producción?", text: `Desde ya «${a.name}» cobra dinero real en los puntos y landings que la usan.`, showCancelButton: true, confirmButtonText: "🚀 Sí, cobrar de verdad", cancelButtonText: "Todavía no", ...theme });
      if (!ok.isConfirmed) return;
    }
    await act("mode", { id: a.id, mode }, `mode-${a.id}`, mode === "production" ? "🚀 En producción" : "🧪 En modo pruebas");
  }

  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); void Swal.fire({ icon: "success", title: "Copiado", timer: 900, showConfirmButton: false, ...theme }); } catch { /* el navegador no dejó */ }
  };
  const hook = (id: string) => `${typeof window !== "undefined" ? window.location.origin : "https://remhub.co"}/api/payments/bold/webhook/${id}`;

  if (!isOwner) {
    return (
      <section id="bold" className="rounded-[28px] border p-6" style={{ ...box, background: "var(--t-card-bg)" }}>
        <h2 className="flex items-center gap-2 text-lg font-semibold"><Zap size={18} /> Bold</h2>
        <p className="mt-2 text-sm" style={{ color: "var(--t-muted)" }}>Solo el dueño de la tienda conecta las cuentas Bold (el dinero llega a esas cuentas).</p>
      </section>
    );
  }

  const accounts = data?.accounts ?? [];
  const def = accounts.find((a) => a.is_default) ?? null;

  return (
    <section id="bold" className="overflow-hidden rounded-[28px] border" style={{ borderColor: "color-mix(in oklab, #10b981 35%, var(--t-card-border))", background: "var(--t-card-bg)", color: "var(--t-text)" }}>
      <div className="p-6" style={{ background: "linear-gradient(135deg, color-mix(in oklab, #10b981 16%, transparent), transparent 60%)" }}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-xl font-black"><span className="grid h-9 w-9 place-items-center rounded-xl bg-emerald-500 text-white"><Zap size={18} /></span> Bold · cobra en línea</h2>
            <p className="mt-2 max-w-2xl text-sm" style={{ color: "var(--t-muted)" }}>
              Tus clientes pagan con tarjeta, PSE, Nequi o botón Bancolombia en las landings y en el enlace de cada pedido. Cada punto cobra con su cuenta Bold, o todos con la misma.
            </p>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => void load()} className="grid h-10 w-10 place-items-center rounded-xl border" style={box} title="Actualizar"><RefreshCw size={15} /></button>
            <button type="button" onClick={() => setDraft({ ...EMPTY, name: accounts.length ? "" : "Bold Principal" })} className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-4 py-2 text-sm font-bold text-white"><Plus size={15} /> Agregar cuenta Bold</button>
          </div>
        </div>

        <button type="button" onClick={() => setHelp((v) => !v)} className="mt-4 inline-flex items-center gap-1 text-sm font-bold text-emerald-500">
          <ChevronDown size={15} className={help ? "rotate-180 transition" : "transition"} /> ¿Cómo la conecto? (3 pasos, 5 minutos)
        </button>
        {help ? (
          <ol className="mt-3 grid gap-3 text-sm md:grid-cols-3">
            {[
              ["1", "Saca las llaves", "Entra a bold.co con tu cuenta → Integraciones → Llaves de integración → Botón de pagos → «Activar llaves». Ahí ves las de pruebas y las de producción."],
              ["2", "Pégalas aquí", "Toca «Agregar cuenta Bold», ponle un nombre (ej. «Bold Zamora») y pega la llave de identidad y la secreta. Puedes pegar solo las de pruebas, solo las de producción o las dos."],
              ["3", "Activa los avisos", "Copia la «Dirección de avisos» de la cuenta y pégala en Bold → Integraciones → Webhooks. Así RemHub marca el pedido como pagado al instante."],
            ].map(([n, t, d]) => (
              <li key={n} className="rounded-2xl border p-4" style={box}>
                <span className="grid h-7 w-7 place-items-center rounded-full bg-emerald-500 text-xs font-black text-white">{n}</span>
                <p className="mt-2 font-bold">{t}</p>
                <p className="mt-1 text-xs leading-5" style={{ color: "var(--t-muted)" }}>{d}</p>
              </li>
            ))}
            <li className="rounded-2xl border p-4 text-xs leading-5 md:col-span-3" style={box}>
              <b>🧪 Para probar sin cobrar:</b> deja la cuenta en «Pruebas». En la pasarela sale «Modo de pruebas». Tarjeta aprobada <code>4111 1111 1111 1111</code> (Visa) o <code>5100 0100 0000 0015</code> (Mastercard); rechazada <code>4970 1100 0000 0062</code>. En PSE elige el banco que aprueba o el que rechaza.
              En pruebas Bold no manda el aviso solo: en el comprobante toca «Probar el webhook» con la dirección de la cuenta. Igual RemHub le pregunta a Bold cuando el cliente vuelve a la página.
              Cuando todo funcione, pasa la cuenta a <b>🚀 Producción</b> con un toque.
            </li>
          </ol>
        ) : null}
      </div>

      <div className="space-y-4 p-6 pt-2">
        {error ? <p className="rounded-xl border p-3 text-sm" style={box}>⚠️ {error}</p> : null}
        {!data && !error ? <p className="text-sm" style={{ color: "var(--t-muted)" }}>Cargando cuentas Bold…</p> : null}
        {data && !accounts.length && !draft ? (
          <div className="rounded-2xl border border-dashed p-6 text-center" style={box}>
            <p className="text-3xl">⚡</p>
            <p className="mt-2 font-bold">Todavía no hay cuentas Bold</p>
            <p className="mt-1 text-sm" style={{ color: "var(--t-muted)" }}>Agrega la primera: queda como la de por defecto para todos los puntos.</p>
          </div>
        ) : null}

        {draft ? (
          <div className="rounded-2xl border-2 p-4" style={{ borderColor: "#10b981" }}>
            <p className="flex items-center gap-2 font-bold"><KeyRound size={16} /> {draft.id ? `Editar «${draft.name}»` : "Nueva cuenta Bold"}</p>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <label className="text-sm font-semibold">Nombre de la cuenta
                <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Ej. Bold Zamora" maxLength={60} className={`${input} mt-1`} style={box} />
              </label>
              <div className="text-sm font-semibold">¿Cómo arranca?
                <div className="mt-1 grid grid-cols-2 gap-2">
                  {(["test", "production"] as const).map((m) => (
                    <button key={m} type="button" onClick={() => setDraft({ ...draft, mode: m })} className="rounded-xl border px-3 py-2.5 text-sm font-bold" style={draft.mode === m ? { background: m === "test" ? "#f59e0b" : "#10b981", color: "#fff", borderColor: "transparent" } : box}>
                      {m === "test" ? "🧪 Pruebas" : "🚀 Producción"}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              {(["test", "prod"] as const).map((k) => {
                const editing = accounts.find((a) => a.id === draft.id);
                const saved = k === "test" ? editing?.test_identity : editing?.prod_identity;
                return (
                  <fieldset key={k} className="rounded-2xl border p-3" style={box}>
                    <legend className="px-1 text-xs font-black uppercase" style={{ color: k === "test" ? "#f59e0b" : "#10b981" }}>{k === "test" ? "🧪 Llaves de pruebas" : "🚀 Llaves de producción"}</legend>
                    <label className="block text-xs font-semibold">Llave de identidad
                      <input value={draft[`${k}_identity`]} onChange={(e) => setDraft({ ...draft, [`${k}_identity`]: e.target.value.trim() })} placeholder={saved ? `Guardada ${saved} · pega otra para cambiarla` : "Pégala desde Bold"} autoComplete="off" spellCheck={false} className={`${input} mt-1 font-mono`} style={box} />
                    </label>
                    <label className="mt-2 block text-xs font-semibold">Llave secreta
                      <input type="password" value={draft[`${k}_secret`]} onChange={(e) => setDraft({ ...draft, [`${k}_secret`]: e.target.value.trim() })} placeholder={saved ? "Guardada y cifrada · pega otra para cambiarla" : "Pégala desde Bold"} autoComplete="new-password" spellCheck={false} className={`${input} mt-1 font-mono`} style={box} />
                    </label>
                  </fieldset>
                );
              })}
            </div>
            <p className="mt-2 text-xs" style={{ color: "var(--t-muted)" }}>🔒 La llave secreta se guarda cifrada y nunca vuelve a mostrarse. No la mandes por chat ni por correo.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" disabled={busy === "save"} onClick={() => void save()} className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"><Check size={15} /> {busy === "save" ? "Guardando…" : "Guardar cuenta"}</button>
              <button type="button" onClick={() => setDraft(null)} className="rounded-xl border px-4 py-2 text-sm font-semibold" style={box}>Cancelar</button>
            </div>
          </div>
        ) : null}

        {accounts.map((a) => {
          const ready = a.mode === "production" ? a.has_prod : a.has_test;
          const uses = (data?.links ?? []).filter((l) => l.account_id === a.id).length;
          return (
            <article key={a.id} className="rounded-2xl border p-4" style={{ ...box, opacity: a.active ? 1 : 0.6 }}>
              <div className="flex flex-wrap items-start gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-base font-black">{a.name}</h3>
                    {a.is_default ? <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-bold text-emerald-500"><Star size={11} /> Por defecto</span> : null}
                    {!a.active ? <span className="rounded-full bg-slate-500/20 px-2 py-0.5 text-[11px] font-bold">Apagada</span> : null}
                    {ready ? <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-bold text-emerald-500">● Lista para cobrar</span>
                      : <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-bold text-amber-500">Faltan llaves de {a.mode === "production" ? "producción" : "pruebas"}</span>}
                  </div>
                  <p className="mt-1 text-xs" style={{ color: "var(--t-muted)" }}>
                    {a.has_test ? `🧪 ${a.test_identity}` : "🧪 sin llaves"} · {a.has_prod ? `🚀 ${a.prod_identity}` : "🚀 sin llaves"}
                    {uses ? ` · ${uses} ${uses === 1 ? "punto" : "puntos"}` : ""}{a.is_default ? " · y los puntos sin cuenta" : ""}
                  </p>
                  {a.last_error ? <p className="mt-1 text-xs font-bold text-rose-500">❌ {a.last_error}</p> : a.last_ok_at ? <p className="mt-1 text-xs text-emerald-500">✅ Conexión probada el {when(a.last_ok_at)}</p> : null}
                  {a.last_event_at ? <p className="text-xs" style={{ color: "var(--t-muted)" }}>Último aviso de Bold: {when(a.last_event_at)}</p> : null}
                </div>
                <div className="grid grid-cols-2 overflow-hidden rounded-xl border text-xs font-black" style={box}>
                  {(["test", "production"] as const).map((m) => (
                    <button key={m} type="button" disabled={busy === `mode-${a.id}`} onClick={() => void setMode(a, m)} className="px-3 py-2" style={a.mode === m ? { background: m === "test" ? "#f59e0b" : "#10b981", color: "#fff" } : undefined}>
                      {m === "test" ? "🧪 Pruebas" : "🚀 Producción"}
                    </button>
                  ))}
                </div>
              </div>

              {a.month.tries ? (
                <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                  {[["Cobrado (30 días)", money(a.month.total)], ["Pagos aprobados", String(a.month.approved)], ["Intentos", String(a.month.tries)]].map(([l, v]) => (
                    <div key={l} className="rounded-xl border p-2" style={box}><p className="text-base font-black">{v}</p><p className="text-[11px]" style={{ color: "var(--t-muted)" }}>{l}</p></div>
                  ))}
                </div>
              ) : null}

              <div className="mt-3 rounded-xl border p-2.5" style={box}>
                <p className="text-[11px] font-bold uppercase" style={{ color: "var(--t-muted)" }}>Dirección de avisos (webhook) · pégala en Bold → Integraciones → Webhooks</p>
                <div className="mt-1 flex items-center gap-2">
                  <code className="min-w-0 flex-1 truncate text-xs">{hook(a.id)}</code>
                  <button type="button" onClick={() => void copy(hook(a.id))} className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-emerald-500 px-2.5 py-1.5 text-xs font-bold text-white"><Copy size={12} /> Copiar</button>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" onClick={() => setDraft({ ...EMPTY, id: a.id, name: a.name, mode: a.mode })} className="inline-flex items-center gap-1 rounded-xl border px-3 py-1.5 text-xs font-bold" style={box}><KeyRound size={13} /> Llaves y nombre</button>
                <button type="button" disabled={busy === `test-${a.id}`} onClick={() => void test(a)} className="inline-flex items-center gap-1 rounded-xl border px-3 py-1.5 text-xs font-bold disabled:opacity-50" style={box}><Plug size={13} /> {busy === `test-${a.id}` ? "Probando…" : "Probar conexión"}</button>
                {!a.is_default ? <button type="button" onClick={() => void act("default", { id: a.id }, `def-${a.id}`, "Ahora es la de por defecto")} className="inline-flex items-center gap-1 rounded-xl border px-3 py-1.5 text-xs font-bold" style={box}><Star size={13} /> Usar por defecto</button> : null}
                <button type="button" onClick={() => void act("save", { id: a.id, name: a.name, mode: a.mode, active: !a.active }, `on-${a.id}`, a.active ? "Cuenta apagada" : "Cuenta encendida")} className="rounded-xl border px-3 py-1.5 text-xs font-bold" style={box}>{a.active ? "⏸ Apagar" : "▶ Encender"}</button>
                <button type="button" onClick={() => void remove(a)} className="inline-flex items-center gap-1 rounded-xl border px-3 py-1.5 text-xs font-bold text-rose-500" style={box}><Trash2 size={13} /> Borrar</button>
              </div>
            </article>
          );
        })}

        {accounts.length && data?.points.length ? (
          <div className="rounded-2xl border p-4" style={box}>
            <p className="font-bold">📍 ¿Con qué Bold cobra cada punto?</p>
            <p className="mt-1 text-xs" style={{ color: "var(--t-muted)" }}>Una misma cuenta puede servir a varios puntos. Las landings cobran con la del punto de su catálogo (o la que elijas en la landing).</p>
            <div className="mt-3 divide-y" style={{ borderColor: "var(--t-card-border)" }}>
              {data.points.map((p) => {
                const link = data.links.find((l) => l.point_id === p.id);
                return (
                  <div key={p.id} className="flex flex-wrap items-center gap-2 py-2">
                    <span className="min-w-40 flex-1 text-sm font-semibold">{p.kind === "warehouse" ? "🏭" : "🏪"} {p.name}</span>
                    <select value={link?.account_id ?? ""} disabled={busy === `pt-${p.id}`} onChange={(e) => void act("assign", { point_id: p.id, account_id: e.target.value || null }, `pt-${p.id}`)} className={`${input} w-auto min-w-56`} style={box}>
                      <option value="">{def ? `Por defecto · ${def.name}` : "Por defecto"}</option>
                      {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}{a.mode === "test" ? " · 🧪" : " · 🚀"}</option>)}
                    </select>
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
