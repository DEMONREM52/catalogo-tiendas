"use client";

import { useCallback, useEffect, useState } from "react";
import { MessageCircle } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { errorText, fiscalApi } from "@/lib/fiscal/client";
import { Button, Card, Notice, fmtDateTime, notify } from "./ui";

type Settings = {
  ok: boolean; message?: string; enabled: boolean; provider: "remhub" | "callmebot"; numbers: Array<{ number: string; has_key: boolean }>; events?: string[];
  last: Array<{ at: string; number: string; event: string; status: string; error: string | null }> | null;
};

const inputCls = "w-full rounded-xl border px-3 py-2 text-sm outline-none";
const inputStyle = { borderColor: "var(--t-card-border)", background: "var(--t-card-bg)", color: "var(--t-text)" } as const;
const EVENTS: Array<[string, string, string]> = [
  ["contingency", "🧾 Facturas de contingencia por vencer", "24 h, 6 h y al vencer el plazo de la DIAN"],
  ["payables", "💸 Cuentas por pagar por vencer", "Cada mañana (8 a. m.), si hay que pagar algo"],
  ["daily_close", "📊 Cierre del día", "Cada noche (9 p. m.): ventas, cajas y agotados"],
];
const EVENT_LABEL: Record<string, string> = { test: "prueba", payables: "cuentas por pagar", daily_close: "cierre del día" };
const pretty = (n: string) => (n.startsWith("57") && n.length === 12 ? `${n.slice(2, 5)} ${n.slice(5, 8)} ${n.slice(8)}` : `+${n}`);

/**
 * WhatsApp al dueño cuando una factura de contingencia está por vencer el plazo de la DIAN (24 h, 6 h y vencida).
 * Con el WhatsApp oficial de RemHub (si está activado) o gratis con CallMeBot (cada número activa su clave).
 */
export function WhatsAppAlerts({ storeId, quiet = false }: { storeId: string; quiet?: boolean }) {
  const [s, setS] = useState<Settings | null>(null);
  const [remhub, setRemhub] = useState<boolean | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [provider, setProvider] = useState<"remhub" | "callmebot">("remhub");
  const [numbers, setNumbers] = useState<string[]>([""]);
  const [keys, setKeys] = useState<Record<number, string>>({});
  const [events, setEvents] = useState<string[]>(["contingency"]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await supabaseBrowser().rpc("erp_whatsapp_settings_get", { p_store: storeId });
    const r = data as Settings | null;
    if (error || !r?.ok) {
      setS({ ok: false, message: error ? (/Could not find the function|schema cache/i.test(error.message) ? "Falta ejecutar la migración 20261244 en Supabase." : error.message) : r?.message, enabled: false, provider: "remhub", numbers: [], last: null });
      return;
    }
    setS(r);
    setEnabled(r.enabled);
    setProvider(r.provider);
    setNumbers(r.numbers.length ? r.numbers.map((n) => n.number) : [""]);
    setEvents(r.events?.length ? r.events : ["contingency"]);
    setKeys({});
  }, [storeId]);

  useEffect(() => {
    void load();
    void fiscalApi<{ remhub: boolean }>("/api/notify/whatsapp", undefined, "GET").then((r) => setRemhub(r.remhub), () => setRemhub(false));
  }, [load]);

  if (!s) return null;
  if (!s.ok) return quiet ? null : <Notice tone="warn" icon="💬">{s.message ?? "No tienes acceso a los avisos por WhatsApp."}</Notice>;

  async function save() {
    setBusy(true);
    try {
      const clean = numbers.map((n) => n.trim()).filter(Boolean);
      const keyMap: Record<string, string> = {};
      clean.forEach((n, i) => {
        const k = keys[i]?.trim();
        if (k) keyMap[normalize(n)] = k;
      });
      const { data, error } = await supabaseBrowser().rpc("erp_whatsapp_settings_save", { p_store: storeId, p_data: { enabled, provider, numbers: clean, keys: keyMap, events } });
      const r = data as Settings | null;
      if (error || !r?.ok) throw new Error(error?.message ?? r?.message ?? "No se pudo guardar.");
      setS(r);
      setNumbers(r.numbers.length ? r.numbers.map((n) => n.number) : [""]);
      setKeys({});
      await notify("Avisos por WhatsApp guardados");
    } catch (err) {
      await notify("No se pudo guardar", "error", errorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setBusy(true);
    try {
      const r = await fiscalApi<{ results: Array<{ number: string; ok: boolean; error?: string }> }>("/api/notify/whatsapp", { store_id: storeId, action: "test" });
      const bad = r.results.filter((x) => !x.ok);
      await notify(bad.length ? "Algunos mensajes no salieron" : "Mensaje de prueba enviado", bad.length ? "warning" : "success",
        bad.map((x) => `${pretty(x.number)}: ${x.error}`).join(" · ") || "Revisa el WhatsApp de esos números.");
      await load();
    } catch (err) {
      await notify("No se pudo enviar la prueba", "error", errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="space-y-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 font-black"><MessageCircle size={16} /> Avisos automáticos por WhatsApp al equipo</p>
        <label className="flex items-center gap-2 text-xs font-bold">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> Activado
        </label>
      </div>
      <p className="text-xs" style={{ color: "var(--t-muted)" }}>
        Llegan solos a los números que pongas (hasta 3). Elige cuáles quieres. También llega notificación al celular a quien tenga la app.
      </p>
      <div className="grid gap-1.5">
        {EVENTS.map(([key, label, hint]) => (
          <label key={key} className="flex cursor-pointer items-start gap-2 text-xs">
            <input type="checkbox" className="mt-0.5" checked={events.includes(key)}
              onChange={(e) => setEvents((ev) => (e.target.checked ? [...new Set([...ev, key])] : ev.filter((x) => x !== key)))} />
            <span><b>{label}</b> <span style={{ color: "var(--t-muted)" }}>· {hint}</span></span>
          </label>
        ))}
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <button type="button" disabled={remhub === false} onClick={() => setProvider("remhub")}
          className="rounded-2xl border p-3 text-left disabled:opacity-50"
          style={{ borderColor: provider === "remhub" ? "var(--t-accent)" : "var(--t-card-border)" }}>
          <b className="block text-xs">✅ WhatsApp oficial de RemHub</b>
          <span className="text-xs" style={{ color: "var(--t-muted)" }}>{remhub === false ? "Aún no está activo en RemHub: usa CallMeBot mientras tanto." : "Llega desde el número de RemHub. No tienes que configurar nada más."}</span>
        </button>
        <button type="button" onClick={() => setProvider("callmebot")}
          className="rounded-2xl border p-3 text-left"
          style={{ borderColor: provider === "callmebot" ? "var(--t-accent)" : "var(--t-card-border)" }}>
          <b className="block text-xs">🆓 CallMeBot (gratis)</b>
          <span className="text-xs" style={{ color: "var(--t-muted)" }}>Cada número activa su clave con el bot una sola vez.</span>
        </button>
      </div>

      {provider === "callmebot" ? (
        <ol className="list-decimal space-y-1 rounded-2xl border p-3 pl-7 text-xs" style={{ borderColor: "var(--t-card-border)" }}>
          <li>Abre la <a className="font-bold underline" href="https://www.callmebot.com/blog/free-api-whatsapp-messages/" target="_blank" rel="noreferrer">página oficial de CallMeBot</a> y guarda en tus contactos el número que aparece ahí.</li>
          <li>Desde el WhatsApp que va a recibir los avisos, envíale: <b>I allow callmebot to send me messages</b></li>
          <li>Te responde con tu clave (APIKEY): pégala junto a ese número aquí abajo.</li>
        </ol>
      ) : null}

      <div className="space-y-2">
        {numbers.map((n, i) => {
          const saved = s.numbers.find((x) => x.number === normalize(n));
          return (
            <div key={i} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
              <input className={inputCls} style={inputStyle} inputMode="tel" placeholder="Celular (ej.: 300 123 4567)" value={n.length === 12 && n.startsWith("57") ? pretty(n) : n}
                onChange={(e) => setNumbers((arr) => arr.map((x, j) => (j === i ? e.target.value : x)))} />
              {provider === "callmebot" ? (
                <input className={inputCls} style={inputStyle} type="password" autoComplete="off"
                  placeholder={saved?.has_key ? "Clave guardada (escribe para cambiarla)" : "Clave de CallMeBot"}
                  value={keys[i] ?? ""} onChange={(e) => setKeys((k) => ({ ...k, [i]: e.target.value }))} />
              ) : <span />}
              <button type="button" className="rounded-xl border px-3 text-xs font-bold" style={{ borderColor: "var(--t-card-border)" }}
                onClick={() => setNumbers((arr) => (arr.length > 1 ? arr.filter((_, j) => j !== i) : [""]))}>Quitar</button>
            </div>
          );
        })}
        {numbers.length < 3 ? (
          <button type="button" className="text-xs font-bold underline" onClick={() => setNumbers((arr) => [...arr, ""])}>+ Agregar otro número</button>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button variant="primary" busy={busy} onClick={() => void save()}>Guardar</Button>
        <Button busy={busy} disabled={!s.numbers.length} onClick={() => void test()}>Enviar mensaje de prueba</Button>
      </div>

      {s.last?.length ? (
        <div className="text-xs" style={{ color: "var(--t-muted)" }}>
          <p className="font-bold">Últimos envíos</p>
          {s.last.map((l, i) => (
            <p key={i}>{l.status === "sent" ? "✅" : l.status === "failed" ? "⚠️" : "⏳"} {fmtDateTime(l.at)} · {pretty(l.number ?? "")} · {EVENT_LABEL[l.event] ?? "contingencia"}{l.error ? ` · ${l.error}` : ""}</p>
          ))}
        </div>
      ) : null}
    </Card>
  );
}

/** Igual que la base: 10 dígitos que empiezan por 3 → con el 57 de Colombia. */
function normalize(n: string) {
  const d = n.replace(/\D/g, "");
  return d.length === 10 && d.startsWith("3") ? `57${d}` : d;
}
