"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import Swal from "sweetalert2";
import { Printer, X } from "lucide-react";
import { MODE_INFO, savePrinterSettings, usePrinterSettings, type PrinterMode, type PrinterSettings } from "@/lib/print/settings";
import { bluetoothConnected, modeSupported, openDrawer, pairBluetooth, pairSerial, pairUsb, printTicket } from "@/lib/print/transports";
import { testTicket } from "@/lib/print/ticket";

const swalTheme = { background: "var(--t-bg-base)", color: "var(--t-text)" } as const;
const MODES: PrinterMode[] = ["browser", "kiosk", "usb", "serial", "bluetooth", "rawbt"];

/** Botón «Impresora» del POS: muestra el modo de este equipo y abre su configuración. */
export function PrinterChip({ size }: { size: "tirilla" | "carta" }) {
  const s = usePrinterSettings();
  const [open, setOpen] = useState(false);
  const direct = s.mode !== "browser";
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold"
        style={{ borderColor: direct ? "color-mix(in oklab, #22c55e 55%, transparent)" : "var(--t-card-border)", background: direct ? "color-mix(in oklab, #22c55e 12%, transparent)" : "transparent" }}
        title="Impresora de este equipo"
      >
        <Printer size={14} /> {direct ? `${MODE_INFO[s.mode].icon} Directo` : "Impresora"}
      </button>
      {open ? createPortal(<PrinterSetup size={size} onClose={() => setOpen(false)} />, document.body) : null}
    </>
  );
}

function Toggle({ label, value, onChange, hint }: { label: string; value: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <label className="flex cursor-pointer items-start gap-2 text-sm">
      <input type="checkbox" className="mt-1" checked={value} onChange={(e) => onChange(e.target.checked)} />
      <span>
        <b className="block text-xs">{label}</b>
        {hint ? <span className="text-xs" style={{ color: "var(--t-muted)" }}>{hint}</span> : null}
      </span>
    </label>
  );
}

export function PrinterSetup({ size, onClose }: { size: "tirilla" | "carta"; onClose: () => void }) {
  const s = usePrinterSettings();
  const [busy, setBusy] = useState(false);
  const info = MODE_INFO[s.mode];
  const set = (patch: Partial<PrinterSettings>) => savePrinterSettings(patch);
  const origin = typeof window === "undefined" ? "https://remhub.co" : window.location.origin;
  const chrome = `"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --kiosk-printing --app=${origin}/dashboard/pos`;
  const edge = `"C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe" --kiosk-printing --app=${origin}/dashboard/pos`;
  const paired = s.mode === "usb" ? s.usb?.name ?? (s.usb ? "Impresora USB" : null)
    : s.mode === "serial" ? (s.serial ? "Puerto elegido" : null)
      : s.mode === "bluetooth" ? s.bluetooth?.name ?? (s.bluetooth ? "Impresora Bluetooth" : null) : null;

  async function pair() {
    setBusy(true);
    try {
      const name = s.mode === "usb" ? await pairUsb() : s.mode === "serial" ? await pairSerial() : await pairBluetooth();
      void Swal.fire({ ...swalTheme, toast: true, position: "top-end", timer: 3000, showConfirmButton: false, icon: "success", title: `Lista: ${name}` });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // Cerrar la ventana de elegir aparato no es un error.
      if (!/cancel|No device selected|chooser|NotFoundError/i.test(msg)) void Swal.fire({ ...swalTheme, icon: "error", title: "No se pudo conectar", text: msg });
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setBusy(true);
    const r = await printTicket(testTicket(), size);
    setBusy(false);
    if (!r.ok) void Swal.fire({ ...swalTheme, icon: "warning", title: "La prueba no salió", text: r.message });
  }

  async function drawer() {
    const r = await openDrawer();
    if (!r.ok) void Swal.fire({ ...swalTheme, icon: "warning", title: "No se abrió el cajón", text: r.message });
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      void Swal.fire({ ...swalTheme, toast: true, position: "top-end", timer: 2000, showConfirmButton: false, icon: "success", title: "Copiado" });
    } catch {
      void Swal.fire({ ...swalTheme, title: "Copia este texto", input: "textarea", inputValue: text });
    }
  }

  return (
    <div className="fixed inset-0 z-[200] grid place-items-center bg-black/60 p-3" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-3xl border p-4 sm:p-5" style={{ borderColor: "var(--t-card-border)", background: "var(--t-bg-base)", color: "var(--t-text)" }}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-lg font-black">🖨️ Impresora de este equipo</p>
            <p className="text-xs" style={{ color: "var(--t-muted)" }}>Cada computador, celular o tablet elige la suya. Si no cambias nada, se imprime como siempre (ventana del navegador).</p>
          </div>
          <button type="button" onClick={onClose} className="grid h-8 w-8 place-items-center rounded-full border" style={{ borderColor: "var(--t-card-border)" }} aria-label="Cerrar">
            <X size={15} />
          </button>
        </div>

        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          {MODES.map((m) => {
            const sup = modeSupported(m);
            const on = s.mode === m;
            return (
              <button key={m} type="button" disabled={!sup.ok && !on} onClick={() => set({ mode: m })}
                className="rounded-2xl border p-3 text-left transition disabled:opacity-45"
                style={{ borderColor: on ? "var(--t-accent)" : "var(--t-card-border)", background: on ? "color-mix(in oklab, var(--t-accent) 12%, transparent)" : "var(--t-card-bg)" }}>
                <b className="block text-sm">{MODE_INFO[m].icon} {MODE_INFO[m].label}</b>
                <span className="text-xs" style={{ color: "var(--t-muted)" }}>{sup.ok ? MODE_INFO[m].detail : sup.why}</span>
              </button>
            );
          })}
        </div>

        {s.mode === "kiosk" ? (
          <div className="mt-4 space-y-2 rounded-2xl border p-3 text-sm" style={{ borderColor: "var(--t-card-border)" }}>
            <p className="font-black">Cómo dejarlo listo (una sola vez, en Windows)</p>
            <ol className="list-decimal space-y-1 pl-5 text-xs">
              <li>Pon la térmica como <b>impresora predeterminada</b> de Windows (Configuración → Impresoras).</li>
              <li>Clic derecho en el escritorio → Nuevo → Acceso directo → pega esto y ponle de nombre «RemHub POS»:</li>
            </ol>
            <div className="flex gap-2">
              <code className="min-w-0 flex-1 truncate rounded-lg border px-2 py-1 text-[11px]" style={{ borderColor: "var(--t-card-border)" }}>{chrome}</code>
              <button type="button" onClick={() => void copy(chrome)} className="rounded-lg border px-2 text-xs font-bold" style={{ borderColor: "var(--t-card-border)" }}>Copiar</button>
            </div>
            <p className="text-xs" style={{ color: "var(--t-muted)" }}>Con Edge: <button type="button" className="underline" onClick={() => void copy(edge)}>copiar el de Edge</button>.</p>
            <ol start={3} className="list-decimal space-y-1 pl-5 text-xs">
              <li>Cierra Chrome por completo y ábrelo con ese acceso directo. Desde ahí todo se imprime solo, sin ventana.</li>
            </ol>
          </div>
        ) : null}

        {s.mode === "rawbt" ? (
          <div className="mt-4 rounded-2xl border p-3 text-xs" style={{ borderColor: "var(--t-card-border)" }}>
            1. Instala <a className="font-bold underline" href="https://play.google.com/store/apps/details?id=ru.a402d.rawbtprinter" target="_blank" rel="noreferrer">RawBT</a> en este celular o tablet.
            2. En RawBT elige tu impresora (Bluetooth, USB o red) y su ancho. 3. Toca «Imprimir prueba» aquí.
          </div>
        ) : null}

        {(s.mode === "usb" || s.mode === "serial" || s.mode === "bluetooth") ? (
          <div className="mt-4 flex flex-wrap items-center gap-2 rounded-2xl border p-3 text-sm" style={{ borderColor: "var(--t-card-border)" }}>
            <span className="min-w-0 flex-1">
              <b className="block text-xs">Impresora</b>
              <span className="text-xs" style={{ color: "var(--t-muted)" }}>
                {paired ? `${paired}${s.mode === "bluetooth" && !bluetoothConnected() ? " · se reconecta al imprimir (o toca «Elegir» otra vez)" : ""}` : "Aún no has elegido la impresora."}
              </span>
            </span>
            <button type="button" disabled={busy} onClick={() => void pair()} className="rounded-full px-4 py-1.5 text-xs font-bold text-white disabled:opacity-50" style={{ background: "var(--t-accent)" }}>
              {paired ? "Elegir otra" : "Elegir impresora"}
            </button>
          </div>
        ) : null}

        {info.escpos ? (
          <div className="mt-4 grid gap-3 rounded-2xl border p-3 sm:grid-cols-2" style={{ borderColor: "var(--t-card-border)" }}>
            <label className="text-xs font-bold">Ancho del papel
              <select className="mt-1 w-full rounded-xl border px-2 py-1.5 text-sm" style={{ borderColor: "var(--t-card-border)", background: "var(--t-card-bg)" }}
                value={s.width} onChange={(e) => set({ width: Number(e.target.value) as PrinterSettings["width"] })}>
                <option value={32}>58 mm (32 letras)</option>
                <option value={48}>80 mm (48 letras)</option>
                <option value={42}>80 mm (42 letras)</option>
              </select>
            </label>
            <label className="text-xs font-bold">Tildes y eñes
              <select className="mt-1 w-full rounded-xl border px-2 py-1.5 text-sm" style={{ borderColor: "var(--t-card-border)", background: "var(--t-card-bg)" }}
                value={s.codepage} onChange={(e) => set({ codepage: e.target.value as PrinterSettings["codepage"] })}>
                <option value="cp850">PC850 (la mayoría)</option>
                <option value="wpc1252">Windows-1252</option>
                <option value="ascii">Sin tildes</option>
              </select>
            </label>
            {s.mode === "serial" ? (
              <label className="text-xs font-bold">Velocidad del puerto
                <select className="mt-1 w-full rounded-xl border px-2 py-1.5 text-sm" style={{ borderColor: "var(--t-card-border)", background: "var(--t-card-bg)" }}
                  value={s.baudRate} onChange={(e) => set({ baudRate: Number(e.target.value) })}>
                  {[9600, 19200, 38400, 57600, 115200].map((b) => <option key={b} value={b}>{b}</option>)}
                </select>
              </label>
            ) : null}
            <label className="text-xs font-bold">Copias
              <select className="mt-1 w-full rounded-xl border px-2 py-1.5 text-sm" style={{ borderColor: "var(--t-card-border)", background: "var(--t-card-bg)" }}
                value={s.copies} onChange={(e) => set({ copies: Number(e.target.value) as 1 | 2 })}>
                <option value={1}>1</option>
                <option value={2}>2 (cliente y tienda)</option>
              </select>
            </label>
            <Toggle label="Cortar el papel" value={s.cut} onChange={(v) => set({ cut: v })} hint="Si la impresora tiene cortador." />
            <Toggle label="Abrir el cajón en ventas con efectivo" value={s.drawer} onChange={(v) => set({ drawer: v })} hint="Cajón conectado a la impresora." />
            <Toggle label="Imprimir el código QR" value={s.qr} onChange={(v) => set({ qr: v })} hint="Consulta del comprobante o el de la DIAN." />
          </div>
        ) : null}

        {s.mode !== "browser" ? (
          <div className="mt-3">
            <Toggle label="Imprimir solo al cobrar" value={s.autoPrint} onChange={(v) => set({ autoPrint: v })} hint="Sin preguntar. Si lo apagas, aparece el botón «Imprimir» después de cada venta." />
          </div>
        ) : null}

        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" disabled={busy} onClick={() => void test()} className="rounded-full px-4 py-2 text-xs font-bold text-white disabled:opacity-50" style={{ background: "#22c55e" }}>
            🖨️ Imprimir prueba
          </button>
          {info.escpos ? (
            <button type="button" onClick={() => void drawer()} className="rounded-full border px-4 py-2 text-xs font-bold" style={{ borderColor: "var(--t-card-border)" }}>
              💵 Abrir cajón
            </button>
          ) : null}
        </div>
        <p className="mt-3 text-[11px]" style={{ color: "var(--t-muted)" }}>
          Funciona también sin internet. En iPhone/iPad solo existe la ventana del navegador (AirPrint).
        </p>
      </div>
    </div>
  );
}
