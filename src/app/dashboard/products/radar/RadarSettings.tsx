"use client";

import { useState } from "react";
import { Loader2, Settings } from "lucide-react";
import Swal from "@/lib/swal";
import { supabaseBrowser } from "@/lib/supabase/client";
import { Sheet } from "./RadarWidgets";
import { TemplateEditor } from "@/components/products/TemplateEditor";
import { SAMPLE_VARS, type PublishTemplate } from "@/lib/products/publish-templates";

export type RadarSettingsValue = { daily_target: number; push_hour: number | null; health_goal: number };
export const DEFAULT_SETTINGS: RadarSettingsValue = { daily_target: 5, push_hour: 9, health_goal: 85 };

const hourLabel = (h: number) => `${h % 12 === 0 ? 12 : h % 12}:00 ${h < 12 ? "a. m." : "p. m."}`;

export function RadarSettings({ storeId, value, onClose, onSaved }: { storeId: string; value: RadarSettingsValue; onClose: () => void; onSaved: (v: RadarSettingsValue) => void }) {
  const [v, setV] = useState(value);
  const [busy, setBusy] = useState(false);
  // Se escribe libre (se puede borrar todo) y se ajusta entre 1 y 100 al salir del campo o al guardar.
  const [target, setTarget] = useState(String(value.daily_target));
  const clampTarget = (t: string) => Math.max(1, Math.min(100, Math.floor(Number(t)) || 1));
  const [tpls, setTpls] = useState<{ list: PublishTemplate[]; missing: boolean } | null>(null);
  async function openTemplates() {
    const { data, error } = await supabaseBrowser().rpc("publish_templates_list", { p_store: storeId });
    const d = data as { ok?: boolean; templates?: PublishTemplate[] } | null;
    setTpls({ list: d?.ok ? d.templates ?? [] : [], missing: Boolean(error && /Could not find the function|schema cache|does not exist/i.test(error.message)) });
  }
  async function save() {
    setBusy(true);
    const { data, error } = await supabaseBrowser().rpc("product_radar_settings_save", { p_store: storeId, p_daily_target: clampTarget(target), p_push_hour: v.push_hour, p_health_goal: v.health_goal });
    setBusy(false);
    const d = data as { ok?: boolean; message?: string; settings?: RadarSettingsValue } | null;
    if (error || !d?.ok) {
      void Swal.fire({ icon: "error", title: "No se guardó", text: error?.message ?? d?.message, background: "var(--t-bg-base)", color: "var(--t-text)" });
      return;
    }
    onSaved(d.settings ?? { ...v, daily_target: clampTarget(target) });
    onClose();
  }
  const field = "w-full rounded-xl border px-3 py-2.5 text-sm";
  const style = { borderColor: "var(--t-card-border)", background: "var(--t-input-bg, var(--t-card-bg))", color: "var(--t-text)" } as const;
  return (
    <Sheet title="Ajustes del Radar" icon={<Settings size={20} />} onClose={onClose}>
      <div className="space-y-4 text-sm">
        <label className="block">
          <span className="font-bold">🗓️ Productos para publicar al día</span>
          <div className="mt-1 flex items-center gap-2">
            <button type="button" onClick={() => setTarget(String(Math.max(1, (Number(target) || 1) - 1)))} className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border text-lg font-black" style={style} aria-label="Uno menos">−</button>
            <input type="text" inputMode="numeric" value={target} onFocus={(e) => e.currentTarget.select()}
              onChange={(e) => setTarget(e.target.value.replace(/D/g, "").slice(0, 3))}
              onBlur={() => setTarget(String(clampTarget(target)))}
              className={`${field} text-center text-lg font-black`} style={style} aria-label="Productos para publicar al día" />
            <button type="button" onClick={() => setTarget(String(Math.min(100, (Number(target) || 0) + 1)))} className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border text-lg font-black" style={style} aria-label="Uno más">+</button>
          </div>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {[1, 3, 5, 10, 15, 20, 30].map((n) => (
              <button key={n} type="button" onClick={() => setTarget(String(n))} className="rounded-full border px-2.5 py-1 text-[11px] font-bold"
                style={Number(target) === n ? { borderColor: "#10b981", background: "color-mix(in oklab, #10b981 18%, transparent)" } : { borderColor: "var(--t-card-border)" }}>{n}</button>
            ))}
          </div>
          <span className="text-[11px]" style={{ color: "var(--t-muted)" }}>El «Plan de hoy» te propone esta cantidad (lo atrasado primero).</span>
        </label>
        <label className="block">
          <span className="font-bold">📲 Aviso al celular</span>
          <select value={v.push_hour === null ? "" : String(v.push_hour)} onChange={(e) => setV({ ...v, push_hour: e.target.value === "" ? null : Number(e.target.value) })} className={`${field} mt-1`} style={style}>
            <option value="">No avisar al celular</option>
            {Array.from({ length: 17 }, (_, i) => i + 6).map((h) => <option key={h} value={h}>Todos los días a las {hourLabel(h)}</option>)}
          </select>
          <span className="text-[11px]" style={{ color: "var(--t-muted)" }}>Le llega a quienes trabajan productos (si tienen activadas las notificaciones): cuántos toca publicar y sus tareas.</span>
        </label>
        <label className="block">
          <span className="font-bold">🎯 Meta de salud del catálogo</span>
          <input type="range" min={50} max={100} step={5} value={v.health_goal} onChange={(e) => setV({ ...v, health_goal: Number(e.target.value) })} className="mt-2 w-full" />
          <span className="text-[11px]" style={{ color: "var(--t-muted)" }}>Llegar a <b style={{ color: "var(--t-text)" }}>{v.health_goal}</b> de 100 en promedio.</span>
        </label>
        <button type="button" onClick={() => void openTemplates()} className="flex w-full items-center justify-between rounded-2xl border px-4 py-3 text-left" style={{ borderColor: "var(--t-card-border)" }}>
          <span><span className="font-bold">📝 Plantillas de mensajes</span><br /><span className="text-[11px]" style={{ color: "var(--t-muted)" }}>El texto que arma «Publícame» para redes y WhatsApp.</span></span>
          <span aria-hidden>›</span>
        </button>
        <button type="button" onClick={() => void save()} disabled={busy} className="flex w-full items-center justify-center gap-2 rounded-2xl px-4 py-3 font-black text-white disabled:opacity-60" style={{ background: "linear-gradient(135deg,#10b981,#0ea5e9)" }}>
          {busy ? <Loader2 size={16} className="animate-spin" /> : null} Guardar
        </button>
      </div>
      {tpls ? <TemplateEditor storeId={storeId} vars={SAMPLE_VARS} templates={tpls.list} missing={tpls.missing} onClose={() => setTpls(null)} onChanged={() => void openTemplates()} /> : null}
    </Sheet>
  );
}
