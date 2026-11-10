"use client";

import { useEffect, useState } from "react";
import { m as motion } from "framer-motion";
import { Check, Copy, Dices, KeyRound, Loader2, Save } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";

/**
 * Código de la tienda (20261301): el equipo lo escribe en el inicio de sesión («Equipo»), ve el nombre y
 * el logo de la tienda y luego entra con su usuario y contraseña.
 */
export function TeamCodeCard({ storeId, canEdit }: { storeId: string; canEdit: boolean }) {
  const [code, setCode] = useState("");
  const [saved, setSaved] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    void supabaseBrowser().rpc("erp_team_code_get", { p_store: storeId }).then(({ data, error }) => {
      if (error) { if (/Could not find|schema cache/i.test(error.message)) setMsg({ ok: false, text: "Ejecuta en Supabase la migración 20261301_codigo_tienda_equipo.sql para activar el código." }); return; }
      const c = (data as string | null) ?? "";
      setCode(c); setSaved(c || null);
    });
  }, [storeId]);

  function generate() {
    // 6 cifras al azar, sin que sean todas iguales ni seguidas.
    let c = "";
    do { c = String(Math.floor(100000 + Math.random() * 900000)); } while (/^(\d)\1+$/.test(c) || "0123456789".includes(c));
    setCode(c);
    setMsg(null);
  }
  async function save() {
    setBusy(true); setMsg(null);
    const { data, error } = await supabaseBrowser().rpc("erp_team_code_save", { p_store: storeId, p_code: code });
    setBusy(false);
    if (error) return setMsg({ ok: false, text: error.message });
    const c = ((data as { code?: string | null })?.code ?? "") as string;
    setSaved(c || null); setCode(c);
    setMsg({ ok: true, text: c ? "✅ Código guardado. Compártelo con tu equipo." : "Código quitado: el equipo entra solo con el enlace de acceso." });
  }
  const dirty = (saved ?? "") !== code;

  return (
    <div className="rounded-2xl border p-4 sm:p-5" style={{ borderColor: "color-mix(in oklab, var(--t-accent) 40%, var(--t-card-border))", background: "linear-gradient(135deg, color-mix(in oklab, var(--t-accent) 10%, var(--t-card-bg)), var(--t-card-bg))" }}>
      <div className="flex items-start gap-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl text-white shadow-lg" style={{ background: "linear-gradient(135deg, #8b5cf6, #0ea5e9)" }}><KeyRound size={20} /></span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-black">Código de la tienda para el equipo</p>
          <p className="text-xs" style={{ color: "var(--t-muted)" }}>
            En el inicio de sesión tu equipo toca <b>«Equipo»</b>, escribe este código y luego su usuario y contraseña. Solo identifica la tienda: sin usuario y contraseña nadie entra.
          </p>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <input value={code} onChange={(e) => { setCode(e.target.value.replace(/\D/g, "").slice(0, 8)); setMsg(null); }} inputMode="numeric" placeholder="Ej. 482917" disabled={!canEdit}
          className="w-44 rounded-2xl border px-4 py-3 text-center font-mono text-2xl font-black tracking-[0.35em] outline-none focus:ring-2"
          style={{ borderColor: "var(--t-card-border)", background: "var(--t-card-bg)", color: "var(--t-text)" }} aria-label="Código de la tienda" />
        {canEdit ? (
          <>
            <button type="button" onClick={generate} className="btn-soft inline-flex items-center gap-1.5 rounded-xl px-3 py-2.5 text-sm font-bold"><Dices size={15} /> Generar</button>
            <motion.button type="button" whileTap={{ scale: 0.95 }} onClick={() => void save()} disabled={busy || !dirty || (code.length > 0 && code.length < 4)}
              className="btn-cta inline-flex items-center gap-1.5 rounded-xl px-4 py-2.5 text-sm font-bold disabled:opacity-50">
              {busy ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} Guardar código
            </motion.button>
          </>
        ) : null}
        {saved ? (
          <button type="button" onClick={() => { void navigator.clipboard.writeText(saved).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1500); }); }}
            className="btn-soft inline-flex items-center gap-1.5 rounded-xl px-3 py-2.5 text-sm font-bold">
            {copied ? <Check size={15} /> : <Copy size={15} />} {copied ? "Copiado" : "Copiar"}
          </button>
        ) : null}
      </div>
      {code && code.length < 4 ? <p className="mt-2 text-xs text-amber-500">Mínimo 4 números (recomendado 6).</p> : null}
      {msg ? <p className={`mt-2 text-xs font-semibold ${msg.ok ? "text-emerald-500" : "text-rose-500"}`}>{msg.text}</p> : null}
    </div>
  );
}
