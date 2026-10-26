"use client";

import { useCallback, useEffect, useState } from "react";
import Swal from "sweetalert2";
import { Bell, MessageCircle, Pencil, Settings2 } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { money, waLink } from "./terceros";
import { ddmm, fillNotice } from "./notice";
import { WhatsAppAlerts } from "../fiscal/WhatsAppAlerts";

type Item = {
  id: string; kind: "receivable"; customer_id: string | null; name: string; phone: string | null; doc_number: string | null; description: string | null;
  balance: number; due_date: string; days_left: number; point_name: string | null; sent_today: boolean; last_sent: string | null;
};
type Tray = { ok: boolean; message?: string; today: string; days_before: number; include_overdue: boolean; template_due: string; template_overdue: string; items: Item[] };

const swalTheme = { background: "var(--t-bg-base)", color: "var(--t-text)" } as const;
const when = (d: number) => (d < 0 ? `venció hace ${-d} día${d === -1 ? "" : "s"}` : d === 0 ? "vence hoy" : `vence en ${d} día${d === 1 ? "" : "s"}`);

/**
 * Avisos del día: clientes con cuentas que vencen pronto o ya vencieron, con el mensaje listo.
 * «Enviar» abre WhatsApp en este equipo con el texto escrito: sale desde TU número, gratis.
 */
export function NoticeTray({ storeId, storeName }: { storeId: string; storeName: string }) {
  const [tray, setTray] = useState<Tray | null>(null);
  const [onlyPending, setOnlyPending] = useState(true);

  const load = useCallback(async () => {
    const { data, error } = await supabaseBrowser().rpc("erp_notice_tray", { p_store: storeId });
    const r = data as Tray | null;
    if (error) setTray({ ok: false, message: /Could not find the function|schema cache/i.test(error.message) ? "Falta ejecutar la migración 20261245 en Supabase." : error.message } as Tray);
    else setTray(r);
  }, [storeId]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  if (!tray) return <p className="text-sm opacity-70">Cargando…</p>;
  if (!tray.ok) return <p className="rounded-2xl border p-4 text-sm" style={{ borderColor: "var(--t-card-border)" }}>{tray.message}</p>;

  const items = tray.items.filter((i) => !onlyPending || !i.sent_today);
  const sentToday = tray.items.filter((i) => i.sent_today).length;
  const textFor = (i: Item) => fillNotice(i.days_left < 0 ? tray.template_overdue : tray.template_due, i, storeName);

  async function send(i: Item, text = textFor(i)) {
    const url = waLink(i.phone, text);
    if (!url) {
      void Swal.fire({ ...swalTheme, icon: "info", title: "Sin celular", text: `${i.name} no tiene celular guardado. Agrégalo en su ficha de tercero.` });
      return;
    }
    // Se abre ya (con el toque) para que el navegador no lo bloquee; luego se marca como enviado.
    window.open(url, "_blank");
    await supabaseBrowser().rpc("erp_notice_mark_sent", { p_store: storeId, p_ref: i.id, p_phone: i.phone });
    void load();
  }

  async function edit(i: Item) {
    const res = await Swal.fire({ ...swalTheme, title: `Mensaje para ${i.name}`, input: "textarea", inputValue: textFor(i), showCancelButton: true, confirmButtonText: "Enviar por WhatsApp", cancelButtonText: "Cancelar", confirmButtonColor: "#22c55e" });
    if (res.isConfirmed && String(res.value).trim()) await send(i, String(res.value).trim());
  }

  async function settings() {
    if (!tray) return;
    const res = await Swal.fire({
      ...swalTheme,
      title: "Avisos a clientes",
      width: 620,
      html: `<div style="text-align:left;display:grid;gap:10px;font-size:13px">
        <label>Mostrar las cuentas que vencen en los próximos
          <select id="nt-days" class="swal2-select" style="width:100%;margin:6px 0 0">${[0, 1, 2, 3, 5, 7, 10, 15, 20, 30].map((d) => `<option value="${d}" ${d === tray.days_before ? "selected" : ""}>${d === 0 ? "solo hoy" : `${d} días`}</option>`).join("")}</select></label>
        <label><input id="nt-over" type="checkbox" ${tray.include_overdue ? "checked" : ""}/> Incluir las vencidas</label>
        <label>Mensaje para las que van a vencer<textarea id="nt-due" class="swal2-textarea" style="width:100%;margin:6px 0 0;min-height:80px">${tray.template_due.replace(/</g, "&lt;")}</textarea></label>
        <label>Mensaje para las vencidas<textarea id="nt-late" class="swal2-textarea" style="width:100%;margin:6px 0 0;min-height:80px">${tray.template_overdue.replace(/</g, "&lt;")}</textarea></label>
        <small>Se reemplazan solos: {cliente} {valor} {fecha} {documento} {dias} {tienda}</small>
      </div>`,
      showCancelButton: true,
      confirmButtonText: "Guardar",
      cancelButtonText: "Cancelar",
      confirmButtonColor: "#8b5cf6",
      preConfirm: () => ({
        days: Number((document.getElementById("nt-days") as HTMLSelectElement).value),
        over: (document.getElementById("nt-over") as HTMLInputElement).checked,
        due: (document.getElementById("nt-due") as HTMLTextAreaElement).value,
        late: (document.getElementById("nt-late") as HTMLTextAreaElement).value,
      }),
    });
    if (!res.isConfirmed) return;
    const { data, error } = await supabaseBrowser().rpc("erp_notice_settings_save", { p_store: storeId, p_days: res.value.days, p_overdue: res.value.over, p_template_due: res.value.due, p_template_overdue: res.value.late });
    const r = data as { ok?: boolean; message?: string } | null;
    if (error || !r?.ok) void Swal.fire({ ...swalTheme, icon: "error", title: "No se pudo guardar", text: error?.message ?? r?.message });
    void load();
  }

  return (
    <div className="space-y-4">
      <section className="rounded-[24px] border p-4" style={{ borderColor: "var(--t-card-border)", background: "var(--t-card-bg)" }}>
        <div className="flex flex-wrap items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-2xl text-white" style={{ background: "#22c55e" }}><Bell size={18} /></span>
          <span className="min-w-0 flex-1">
            <b className="block">Avisos del día · {tray.items.length - sentToday} por enviar{sentToday ? ` · ${sentToday} enviados hoy` : ""}</b>
            <span className="text-xs" style={{ color: "var(--t-muted)" }}>
              Cuentas que vencen {tray.days_before ? `en los próximos ${tray.days_before} días` : "hoy"}{tray.include_overdue ? " y las vencidas" : ""}. «Enviar» abre tu WhatsApp con el mensaje escrito: sale desde tu número, gratis.
            </span>
          </span>
          <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={onlyPending} onChange={(e) => setOnlyPending(e.target.checked)} /> Solo por enviar</label>
          <button type="button" onClick={() => void settings()} className="inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs font-bold" style={{ borderColor: "var(--t-card-border)" }}>
            <Settings2 size={13} /> Mensajes
          </button>
        </div>
      </section>

      {items.length === 0 ? (
        <p className="rounded-2xl border p-5 text-center text-sm" style={{ borderColor: "var(--t-card-border)", color: "var(--t-muted)" }}>
          {tray.items.length ? "✅ Ya enviaste todos los avisos de hoy." : "No hay cuentas por vencer ni vencidas en este rango."}
        </p>
      ) : (
        <ul className="space-y-2">
          {items.map((i) => (
            <li key={i.id} className="flex flex-wrap items-center gap-3 rounded-2xl border p-3 text-sm" style={{ borderColor: i.days_left < 0 ? "color-mix(in oklab, #ef4444 45%, var(--t-card-border))" : "var(--t-card-border)", background: "var(--t-card-bg)" }}>
              <span className="min-w-0 flex-1">
                <b className="block truncate">{i.name}{i.sent_today ? " · ✅ enviado hoy" : ""}</b>
                <span className="text-xs" style={{ color: i.days_left < 0 ? "#ef4444" : "var(--t-muted)" }}>
                  {money(i.balance)} · {when(i.days_left)} ({ddmm(i.due_date)}){i.doc_number ? ` · ${i.doc_number}` : ""}{i.point_name ? ` · ${i.point_name}` : ""}
                </span>
                <span className="block text-xs" style={{ color: "var(--t-muted)" }}>
                  {i.phone ? `📱 ${i.phone}` : "Sin celular guardado"}{i.last_sent && !i.sent_today ? ` · último aviso ${ddmm(i.last_sent)}` : ""}
                </span>
              </span>
              <button type="button" onClick={() => void edit(i)} className="grid h-9 w-9 place-items-center rounded-full border" style={{ borderColor: "var(--t-card-border)" }} title="Cambiar el mensaje antes de enviar" aria-label="Editar mensaje">
                <Pencil size={14} />
              </button>
              <button type="button" disabled={!i.phone} onClick={() => void send(i)} className="inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-xs font-bold text-white disabled:opacity-40" style={{ background: "#22c55e" }}>
                <MessageCircle size={14} /> {i.sent_today ? "Enviar otra vez" : "Enviar"}
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Avisos automáticos al equipo (solo lo ve quien puede configurarlos). */}
      <WhatsAppAlerts storeId={storeId} quiet />
    </div>
  );
}
