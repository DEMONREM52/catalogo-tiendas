"use client";

import { useState } from "react";
import { Copy, Printer, Save, Trash2 } from "lucide-react";
import Swal from "@/lib/swal";
import { SAMPLE_DATA } from "@/lib/labels/data";
import { PROFILE_PRESETS, normalizeProfile, paginate, perPage, printDocument, validateProfile, type JobLabel } from "@/lib/labels/layout";
import { canvasMeasure } from "@/lib/labels/measure-browser";
import { builtinTemplates, newLine, newQr, newRect, newText } from "@/lib/labels/templates";
import type { LabelDesign, PrinterProfile } from "@/lib/labels/types";
import { printHtmlWindow } from "@/lib/print/transports";
import { Badge, Button, inputCls, inputStyle } from "../fiscal/ui";
import { MmField, PaperDiagram, segBtn } from "./parts";

const swal = { background: "var(--t-bg-base)", color: "var(--t-text)", confirmButtonColor: "#8b5cf6" };
type Saved = PrinterProfile & { id: string; is_default: boolean };

/** Hoja de alineación: borde a 0,3 mm, cruz al centro, número de la posición y un QR para probar el lector. */
export function calibrationDesign(p: PrinterProfile): LabelDesign {
  const w = p.labelW, h = p.labelH;
  return {
    v: 1, w, h, elements: [
      newRect({ id: "borde", x: 0.3, y: 0.3, w: w - 0.6, h: h - 0.6, stroke: 0.25 }),
      newLine({ id: "h", x: w / 2 - 2, y: h / 2, w: 4, h: 0, stroke: 0.2 }),
      newLine({ id: "v", x: w / 2, y: h / 2 - 2, w: 0, h: 4, stroke: 0.2 }),
      newText({ id: "n", x: 1, y: 1, w: w - 2, h: Math.min(4, h / 5), content: "POSICIÓN {consecutivo}", size: 7, minSize: 4, maxLines: 1 }),
      newText({ id: "m", x: 1, y: h - 1 - Math.min(3.5, h / 6), w: w - 2, h: Math.min(3.5, h / 6), content: `${w} × ${h} mm`, size: 6, minSize: 4, maxLines: 1, bold: false }),
      newQr({ id: "qr", x: w / 2 + 2.5, y: h / 2 - Math.min(7, h / 3.5) / 2, w: Math.min(7, h / 3.5, w / 2 - 3.5), h: Math.min(7, h / 3.5, w / 2 - 3.5), content: "PRUEBA {consecutivo}" }),
    ],
  };
}

/** Referencias de prueba: numérica, alfanumérica, con espacios, ceros iniciales, larga, URL y varias líneas. */
const TEST_CODES: Array<{ kind: "qr" | "barras" | "nombre"; value: string }> = [
  { kind: "qr", value: "W 0806 RYL018" },
  { kind: "barras", value: "SC11 W F" },
  { kind: "nombre", value: "MALUMETA DE 6.5 PULGADAS RYL002" },
  { kind: "barras", value: "12345678910" },
  { kind: "barras", value: "0000123456" },
  { kind: "qr", value: "https://remhub.co" },
];

export function ProfilesPanel({ profiles, current, canEdit, onUse, onSave, onDelete, onSetDefault, missing }: {
  profiles: Saved[];
  current: PrinterProfile;
  canEdit: boolean;
  onUse: (id: string) => void;
  onSave: (p: PrinterProfile) => Promise<string | null>;
  onDelete: (id: string) => Promise<void>;
  onSetDefault: (id: string) => Promise<void>;
  missing: boolean;
}) {
  const [p, setP] = useState<PrinterProfile>(current);
  const [saving, setSaving] = useState(false);
  const issues = validateProfile(p);
  const set = <K extends keyof PrinterProfile>(k: K, v: PrinterProfile[K]) => setP((cur) => normalizeProfile({ ...cur, [k]: v, id: cur.id }));

  async function save(asNew: boolean) {
    if (issues.some((i) => i.level === "error")) return void Swal.fire({ ...swal, icon: "error", title: "Revisa las medidas", text: issues[0].message });
    setSaving(true);
    const id = await onSave(asNew ? { ...p, id: undefined, name: `${p.name} (copia)` } : p);
    setSaving(false);
    if (id) { setP((cur) => ({ ...cur, id })); onUse(id); void Swal.fire({ ...swal, icon: "success", title: "Impresora guardada", timer: 1200, showConfirmButton: false }); }
  }

  function printTest(kind: "align" | "codes") {
    if (issues.some((i) => i.level === "error")) return void Swal.fire({ ...swal, icon: "error", title: "Revisa las medidas", text: issues[0].message });
    let labels: JobLabel[];
    if (kind === "align") {
      const d = calibrationDesign(p);
      labels = Array.from({ length: perPage(p) }, (_, i) => ({ key: `a${i}`, input: { design: d, data: { ...SAMPLE_DATA, consecutivo: String(i + 1) }, dpi: p.dpi, measure: canvasMeasure } }));
    } else {
      const t = builtinTemplates(p.labelW, p.labelH);
      const pick = (id: string) => t.find((x) => x.id === `builtin:${id}`)!.design;
      labels = TEST_CODES.map((c, i) => ({
        key: `c${i}`,
        input: {
          design: c.kind === "barras" ? pick("barras-ref") : c.kind === "nombre" ? pick("qr-nombre") : pick("qr-ref"),
          data: { ...SAMPLE_DATA, codigo: c.value, referencia: c.value, nombre: c.value }, dpi: p.dpi, measure: canvasMeasure,
        },
      }));
    }
    const doc = printDocument(paginate(labels, p), p, kind === "align" ? "Prueba de alineación" : "Prueba de códigos");
    if (doc.issues.some((i) => i.level === "error")) {
      return void Swal.fire({ ...swal, icon: "warning", title: "Algún código no cabe en esta etiqueta", text: doc.issues.find((i) => i.level === "error")!.message });
    }
    printHtmlWindow(doc.html);
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
      <section className="space-y-3">
        <div className="rounded-2xl border p-3" style={{ borderColor: "var(--t-card-border)" }}>
          <p className="mb-2 text-xs font-black uppercase tracking-wide" style={{ color: "var(--t-muted)" }}>Guardadas en la tienda</p>
          {missing ? <p className="text-xs text-amber-500">Falta correr la migración 20261347: por ahora la impresora se guarda solo en este equipo.</p> : null}
          <ul className="space-y-1.5">
            {profiles.map((x) => (
              <li key={x.id} className="flex items-center gap-2 rounded-xl border px-2 py-1.5 text-sm" style={{ borderColor: x.id === p.id ? "var(--t-accent)" : "var(--t-card-border)" }}>
                <button type="button" className="min-w-0 flex-1 truncate text-left font-semibold" onClick={() => { setP(x); onUse(x.id); }}>{x.name}</button>
                <span className="text-[11px]" style={{ color: "var(--t-muted)" }}>{x.cols}×{x.labelW}×{x.labelH}</span>
                {x.is_default ? <Badge tone="good">Predeterminada</Badge> : canEdit ? <button type="button" className="text-[11px] underline" onClick={() => void onSetDefault(x.id).catch((e: Error) => Swal.fire({ ...swal, icon: "error", title: e.message }))}>Predeterminar</button> : null}
              </li>
            ))}
            {!profiles.length && !missing ? <li className="text-xs" style={{ color: "var(--t-muted)" }}>Ninguna guardada todavía: guarda la de abajo para que todos la usen.</li> : null}
          </ul>
        </div>
        <div className="rounded-2xl border p-3" style={{ borderColor: "var(--t-card-border)" }}>
          <p className="mb-2 text-xs font-black uppercase tracking-wide" style={{ color: "var(--t-muted)" }}>Empezar desde</p>
          <div className="flex flex-wrap gap-1.5">
            {PROFILE_PRESETS.map((x) => <button key={x.key} type="button" onClick={() => setP({ ...x.profile, id: p.id })} className="rounded-full border px-2.5 py-1 text-xs" style={{ borderColor: "var(--t-card-border)" }}>{x.label}</button>)}
          </div>
        </div>
        <div className="rounded-2xl border p-3" style={{ borderColor: "var(--t-card-border)", background: "#fff" }}>
          <PaperDiagram p={p} />
        </div>
        {issues.map((i, k) => (
          <p key={k} className="rounded-xl border px-3 py-2 text-xs" style={i.level === "error" ? { borderColor: "#ef4444", color: "#ef4444" } : { borderColor: "#f59e0b", color: "#d97706" }}>{i.level === "error" ? "⛔" : "⚠️"} {i.message}</p>
        ))}
        <div className="rounded-2xl border p-3 text-xs leading-relaxed" style={{ borderColor: "var(--t-card-border)" }}>
          <p className="mb-1 font-black">Calibrar (una vez por impresora)</p>
          <ol className="list-decimal space-y-1 pl-4">
            <li>En el controlador de Windows (Propiedades de la impresora → Preferencias), crea el papel de <b>{p.pageW} × {p.mode === "roll" ? p.labelH : p.pageH} mm</b>, sin márgenes. Velocidad y oscuridad se ajustan ahí (RemHub no las envía).</li>
            <li>Toca «Imprimir prueba de alineación». En la ventana elige la impresora, <b>escala 100 %</b> y márgenes «Ninguno».</li>
            <li>Si el borde sale corrido, mueve «Ajuste horizontal/vertical» (positivo = a la derecha/abajo) y vuelve a probar.</li>
            <li>Imprime la «Prueba de códigos» y pásale tu lector a cada etiqueta. Solo tú puedes confirmar que salió bien en papel.</li>
          </ol>
        </div>
      </section>

      <section className="space-y-3 rounded-2xl border p-3 sm:p-4" style={{ borderColor: "var(--t-card-border)", background: "color-mix(in oklab, var(--t-card-bg) 90%, transparent)" }}>
        <div className="grid gap-2 sm:grid-cols-3">
          <label className="text-[11px] font-bold sm:col-span-3" style={{ color: "var(--t-muted)" }}>Nombre
            <input value={p.name} onChange={(e) => set("name", e.target.value)} className={`${inputCls} mt-0.5`} style={inputStyle} />
          </label>
          <label className="text-[11px] font-bold" style={{ color: "var(--t-muted)" }}>Marca<input value={p.brand} onChange={(e) => set("brand", e.target.value)} className={`${inputCls} mt-0.5`} style={inputStyle} /></label>
          <label className="text-[11px] font-bold" style={{ color: "var(--t-muted)" }}>Modelo<input value={p.model} onChange={(e) => set("model", e.target.value)} className={`${inputCls} mt-0.5`} style={inputStyle} /></label>
          <label className="text-[11px] font-bold" style={{ color: "var(--t-muted)" }}>Resolución
            <select value={p.dpi} onChange={(e) => set("dpi", Number(e.target.value))} className={`${inputCls} mt-0.5`} style={inputStyle}>
              {[203, 300, 600].map((d) => <option key={d} value={d}>{d} dpi</option>)}
              {![203, 300, 600].includes(p.dpi) ? <option value={p.dpi}>{p.dpi} dpi</option> : null}
            </select>
          </label>
          <label className="text-[11px] font-bold" style={{ color: "var(--t-muted)" }}>Lenguaje (autodiagnóstico)
            <select value={p.language} onChange={(e) => set("language", e.target.value as PrinterProfile["language"])} className={`${inputCls} mt-0.5`} style={inputStyle}>
              <option value="zpl">ZPL</option><option value="tspl">TSPL</option><option value="epl">EPL</option><option value="escpos">ESC/POS</option><option value="otro">Otro / láser</option>
            </select>
          </label>
          <label className="text-[11px] font-bold" style={{ color: "var(--t-muted)" }}>Conexión
            <select value={p.connection} onChange={(e) => set("connection", e.target.value as PrinterProfile["connection"])} className={`${inputCls} mt-0.5`} style={inputStyle}>
              <option value="usb">USB</option><option value="red">Red</option><option value="bluetooth">Bluetooth</option><option value="serial">Serial</option>
            </select>
          </label>
          <label className="text-[11px] font-bold" style={{ color: "var(--t-muted)" }}>Material
            <select value={p.media} onChange={(e) => set("media", e.target.value as PrinterProfile["media"])} className={`${inputCls} mt-0.5`} style={inputStyle}>
              <option value="gap">Etiquetas con espacios</option><option value="blackmark">Marca negra</option><option value="continuous">Papel continuo</option><option value="sheet">Hojas adhesivas</option>
            </select>
          </label>
        </div>
        <div className="flex gap-1">
          <button type="button" className="h-9 flex-1 rounded-xl border text-sm font-bold" style={segBtn(p.mode === "roll")} onClick={() => set("mode", "roll")}>🧻 Rollo</button>
          <button type="button" className="h-9 flex-1 rounded-xl border text-sm font-bold" style={segBtn(p.mode === "sheet")} onClick={() => set("mode", "sheet")}>📄 Hoja (carta, A4…)</button>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <MmField label={p.mode === "roll" ? "Ancho del rollo" : "Ancho de la hoja"} value={p.pageW} onChange={(v) => set("pageW", v)} min={10} max={500} />
          {p.mode === "sheet" ? <MmField label="Alto de la hoja" value={p.pageH} onChange={(v) => set("pageH", v)} min={10} max={1000} /> : null}
          <MmField label="Ancho de cada etiqueta" value={p.labelW} onChange={(v) => set("labelW", v)} min={5} max={500} />
          <MmField label="Alto de cada etiqueta" value={p.labelH} onChange={(v) => set("labelH", v)} min={5} max={500} />
          <MmField label="Columnas" value={p.cols} onChange={(v) => set("cols", Math.round(v))} min={1} max={20} step={1} unit="" />
          <MmField label="Separación entre columnas" value={p.gapX} onChange={(v) => set("gapX", v)} min={0} max={100} />
          <MmField label="Separación entre filas" value={p.gapY} onChange={(v) => set("gapY", v)} min={0} max={100} title={p.mode === "roll" ? "En rollo la pone el sensor de espacios de la impresora (informativo)" : undefined} />
          <MmField label="Margen izquierdo" value={p.marginLeft} onChange={(v) => set("marginLeft", v)} min={0} max={100} />
          <MmField label="Margen derecho" value={p.marginRight} onChange={(v) => set("marginRight", v)} min={0} max={100} />
          <MmField label="Margen superior" value={p.marginTop} onChange={(v) => set("marginTop", v)} min={0} max={100} />
          <MmField label="Margen inferior" value={p.marginBottom} onChange={(v) => set("marginBottom", v)} min={0} max={100} />
          <MmField label="Ajuste horizontal" value={p.offsetX} onChange={(v) => set("offsetX", v)} min={-20} max={20} title="Calibración: positivo mueve todo a la derecha" />
          <MmField label="Ajuste vertical" value={p.offsetY} onChange={(v) => set("offsetY", v)} min={-20} max={20} title="Calibración: positivo mueve todo hacia abajo" />
        </div>
        <div className="grid gap-2 sm:grid-cols-3">
          <label className="text-[11px] font-bold" style={{ color: "var(--t-muted)" }}>Velocidad (controlador)<input value={p.speed} onChange={(e) => set("speed", e.target.value)} className={`${inputCls} mt-0.5`} style={inputStyle} /></label>
          <label className="text-[11px] font-bold" style={{ color: "var(--t-muted)" }}>Oscuridad (controlador)<input value={p.density} onChange={(e) => set("density", e.target.value)} className={`${inputCls} mt-0.5`} style={inputStyle} /></label>
          <label className="text-[11px] font-bold" style={{ color: "var(--t-muted)" }}>Salida<input value={p.output} onChange={(e) => set("output", e.target.value)} className={`${inputCls} mt-0.5`} style={inputStyle} /></label>
          <label className="text-[11px] font-bold sm:col-span-3" style={{ color: "var(--t-muted)" }}>Notas<textarea value={p.notes} onChange={(e) => set("notes", e.target.value)} rows={2} className={`${inputCls} mt-0.5`} style={inputStyle} /></label>
        </div>
        <p className="text-[11px]" style={{ color: "var(--t-muted)" }}>Velocidad y oscuridad son solo una nota: se ajustan en el controlador de la impresora. Para que el lector lea mejor, prioriza códigos más grandes antes que subir la oscuridad.</p>
        <div className="flex flex-wrap gap-2">
          <Button variant="soft" icon={<Printer size={15} />} onClick={() => printTest("align")}>Imprimir prueba de alineación</Button>
          <Button variant="soft" icon={<Printer size={15} />} onClick={() => printTest("codes")}>Imprimir prueba de códigos</Button>
          <span className="flex-1" />
          {canEdit && p.id ? <Button variant="ghost" icon={<Trash2 size={15} />} onClick={async () => {
            const r = await Swal.fire({ ...swal, icon: "warning", title: `¿Eliminar «${p.name}»?`, showCancelButton: true, confirmButtonText: "Eliminar", cancelButtonText: "Cancelar", confirmButtonColor: "#ef4444" });
            if (r.isConfirmed) await onDelete(p.id!).catch((e: Error) => Swal.fire({ ...swal, icon: "error", title: e.message }));
          }}>Eliminar</Button> : null}
          {canEdit && p.id ? <Button variant="soft" icon={<Copy size={15} />} onClick={() => void save(true)} disabled={saving}>Guardar como nueva</Button> : null}
          <Button variant="primary" icon={<Save size={15} />} busy={saving} onClick={() => void save(false)} disabled={!canEdit && !missing}>{p.id ? "Guardar cambios" : "Guardar impresora"}</Button>
        </div>
      </section>
    </div>
  );
}
