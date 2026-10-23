"use client";

import { useState } from "react";
import Swal from "sweetalert2";
import { errorText, fiscalApi } from "@/lib/fiscal/client";
import type { ProviderAccount } from "@/lib/fiscal/types";
import { Button, notify, swal } from "./ui";

/**
 * Habilitación con Alanube (API e-Provider de Alegra), paso a paso desde RemHub:
 * 1. token → 2. crear la compañía → 3. conectar avisos → 4. set de pruebas de la DIAN → 5. resoluciones → 6. producción.
 * Los pasos del portal de la DIAN se explican aquí mismo (RemHub no puede hacerlos por el contribuyente).
 */

type ActionResult = { ok: boolean; message: string; details?: Record<string, unknown> };

const STEPS: Array<[string, string]> = [
  ["Token de Alanube", "Crea tu cuenta en Alanube y copia el token. Pégalo en «Editar / credenciales» y toca «Probar conexión»."],
  ["Compañía emisora", "Cada NIT es una «compañía» en Alanube. «🏢 Crear empresa en Alanube» la crea con los datos del contribuyente (firma con el certificado de Alegra, sin costo)."],
  ["Avisos automáticos", "«Generar secreto» y luego «🔔 Conectar avisos»: Alanube le avisa a RemHub cuando la DIAN acepta o rechaza cada documento."],
  ["Portal DIAN · modo de operación", "Si es la primera vez: Registro y habilitación → Documentos electrónicos → registra como correo de recepción el de tu cuenta de Alanube. Luego, en el portal de habilitación de la DIAN: Registro y habilitación → Documentos electrónicos → Factura electrónica (o Documentos equivalentes para POS) → Asociar modo de operación → «Software de un proveedor tecnológico» → proveedor «Soluciones Alegra S.A.S». Copia el código del set de pruebas."],
  ["Set de pruebas (automático)", "Recomendado: «⚡ Habilitación automática». En el portal de habilitación de la DIAN genera el enlace de acceso (AuthToken), pégalo y escoge factura y/o POS: Alanube envía sola todos los documentos de prueba. Revisa el avance con «Ver avance» hasta que diga ✅ habilitado. (También puedes hacerlo a mano con «🧪 Enviar set de pruebas» y el código del set.)"],
  ["Resolución electrónica", "En Muisca: Numeración de facturación → Autorizar rangos → «Facturación electrónica» (o «D.E. / P.O.S.») con su prefijo. Debe empezar por 1876. Luego en «Facturando electrónicamente» → Rangos de numeración → asocia el prefijo a «Soluciones Alegra S.A.S» (1 hora después). Si no ves la numeración o el proveedor, usa «Sincronizar contribuyente a producción» en Documentos equivalentes."],
  ["Numeración en RemHub", "En producción, «📋 Ver resoluciones» trae los rangos de la DIAN con su clave técnica: regístralos en la pestaña Numeración del punto."],
  ["Salida a producción", "En el portal de habilitación indica la fecha de inicio (tu RUT queda con la responsabilidad 52) y crea en RemHub la cuenta en ambiente de producción con el mismo token."],
];

export function AlanubePanel({ account, canEdit, reload }: { account: ProviderAccount; canEdit: boolean; reload: () => Promise<void> }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState(!account.external_account_id);

  async function run(action: string, input: Record<string, unknown> = {}) {
    setBusy(action);
    try {
      const res = await fiscalApi<{ result: ActionResult }>("/api/fiscal/providers/action", { account_id: account.id, action, input });
      const r = res.result;
      const extra = action === "resolutions" && Array.isArray(r.details?.resolutions)
        ? `<div style="text-align:left;font-size:12px;margin-top:8px">${(r.details!.resolutions as Array<Record<string, unknown>>).map((x) => `• <b>${String(x.prefix || "(sin prefijo)")}</b> · ${String(x.resolution_number)} · ${String(x.range_from)}–${String(x.range_to)} · hasta ${String(x.valid_until ?? "")}<br/><code style="font-size:10px;word-break:break-all">clave técnica: ${String(x.technical_key ?? "")}</code>`).join("<br/>")}</div>`
        : action === "test_set" && r.details?.test_set_id ? `<p style="font-size:12px;margin-top:6px">Id del set: <code>${String(r.details.test_set_id)}</code> (guárdalo para consultar el estado).</p>` : "";
      await Swal.fire({ ...swal, icon: r.ok ? "success" : "warning", title: r.ok ? "Listo" : "Revisa", html: `${r.message.replace(/[<>&]/g, "")}${extra}` });
      await reload();
    } catch (err) {
      await notify("No se pudo", "error", errorText(err));
    } finally {
      setBusy(null);
    }
  }

  async function intelligentStart() {
    const r = await Swal.fire({
      ...swal, title: "⚡ Habilitación automática ante la DIAN", width: 620,
      html: `<div style="text-align:left;font-size:13px;line-height:1.45">
        <ol style="padding-left:18px;margin:0 0 10px">
          <li>Entra al <a href="https://catalogo-vpfe-hab.dian.gov.co/User/Login" target="_blank" rel="noreferrer" style="text-decoration:underline">portal de habilitación de la DIAN</a> con el NIT de esta empresa (como representante legal o con el certificado).</li>
          <li>Asocia el modo de operación <b>«Software de un proveedor tecnológico»</b> → <b>Soluciones Alegra S.A.S</b> para lo que vas a habilitar.</li>
          <li>Genera el <b>enlace de acceso (AuthToken)</b> y cópialo completo. Empieza por <code>https://catalogo-vpfe-hab.dian.gov.co/User/AuthToken?</code></li>
        </ol>
        <p style="margin:6px 0 4px"><b>¿Qué quieres habilitar?</b></p>
        <label style="display:block"><input type="checkbox" id="d-inv" checked> Factura electrónica</label>
        <label style="display:block"><input type="checkbox" id="d-pos" checked> Documento equivalente POS (tiquete de caja)</label>
        <label style="display:block"><input type="checkbox" id="d-sup"> Documento soporte (compras a no obligados a facturar)</label>
        <label style="display:block"><input type="checkbox" id="d-pay"> Nómina electrónica</label>
        <p style="font-size:11px;opacity:.75;margin-top:8px">El enlace es como una clave: RemHub lo pasa a Alanube y no lo guarda.</p></div>`,
      input: "url", inputPlaceholder: "https://catalogo-vpfe-hab.dian.gov.co/User/AuthToken?…", showCancelButton: true, confirmButtonText: "Iniciar habilitación", cancelButtonText: "Cancelar",
      preConfirm: (v) => {
        const docs = [["d-inv", "invoices"], ["d-pos", "pos"], ["d-sup", "supportDocuments"], ["d-pay", "payrolls"]].filter(([id]) => (document.getElementById(id) as HTMLInputElement | null)?.checked).map(([, d]) => d);
        if (!docs.length) { Swal.showValidationMessage("Escoge al menos un tipo de documento."); return false; }
        if (!String(v ?? "").trim().startsWith("https://catalogo-vpfe-hab.dian.gov.co/User/AuthToken")) { Swal.showValidationMessage("Pega el enlace completo de la DIAN (AuthToken)."); return false; }
        return { tokenDIAN: String(v).trim(), documents: docs };
      },
    });
    if (r.isConfirmed) await run("intelligent_start", r.value);
  }

  async function testSet() {
    const r = await Swal.fire({
      ...swal, title: "Set de pruebas de la DIAN",
      html: `<select id="tt" class="swal2-select" style="display:block;margin:8px auto"><option value="invoices">Factura electrónica</option><option value="pos">Documento equivalente POS</option></select>
        <p style="font-size:12px">${account.environment === "sandbox" ? "En pruebas puedes dejar el código vacío (se usa el de pruebas de Alanube)." : "Pega el código (TestSetId) que muestra el portal de la DIAN."}</p>`,
      input: "text", inputPlaceholder: "Código del set de pruebas (TestSetId)", showCancelButton: true, confirmButtonText: "Enviar", cancelButtonText: "Cancelar",
      preConfirm: (v) => ({ governmentId: String(v ?? "").trim(), type: (document.getElementById("tt") as HTMLSelectElement | null)?.value ?? "invoices" }),
    });
    if (r.isConfirmed) await run("test_set", r.value);
  }
  async function testSetStatus() {
    const r = await Swal.fire({ ...swal, title: "Estado del set de pruebas", input: "text", inputPlaceholder: "Id del set (lo mostró al enviarlo)", showCancelButton: true, confirmButtonText: "Consultar" });
    if (r.isConfirmed && r.value) await run("test_set_status", { id: String(r.value).trim() });
  }

  return (
    <div className="space-y-2 rounded-2xl border p-3" style={{ borderColor: "color-mix(in oklab, var(--t-accent) 35%, var(--t-card-border))" }}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-black">🧭 Habilitación con Alanube</p>
        <button type="button" onClick={() => setOpen((v) => !v)} className="text-xs underline" style={{ color: "var(--t-muted)" }}>{open ? "Ocultar guía" : "Ver guía paso a paso"}</button>
      </div>
      <p className="text-xs" style={{ color: "var(--t-muted)" }}>
        Compañía en Alanube: {account.external_account_id ? <b>{account.external_account_id}</b> : <b className="text-amber-500">sin crear</b>} · ambiente {account.environment === "production" ? "producción (DIAN real)" : "pruebas (habilitación DIAN)"}
      </p>
      {canEdit ? (
        <div className="flex flex-wrap gap-2">
          {!account.external_account_id ? <Button variant="primary" busy={busy === "create_company"} onClick={() => void run("create_company")}>🏢 Crear empresa en Alanube</Button> : null}
          <Button busy={busy === "register_webhooks"} onClick={() => void run("register_webhooks")}>🔔 Conectar avisos</Button>
          {account.external_account_id ? <Button variant="primary" busy={busy === "intelligent_start"} onClick={() => void intelligentStart()}>⚡ Habilitación automática DIAN</Button> : null}
          {account.settings?.intelligent_process_id ? <Button busy={busy === "intelligent_status"} onClick={() => void run("intelligent_status")}>📊 Ver avance de la habilitación</Button> : null}
          <Button busy={busy === "test_set"} onClick={() => void testSet()}>🧪 Set de pruebas a mano</Button>
          <Button busy={busy === "test_set_status"} onClick={() => void testSetStatus()}>Estado del set</Button>
          <Button busy={busy === "resolutions"} onClick={() => void run("resolutions")}>📋 Ver resoluciones</Button>
        </div>
      ) : null}
      {open ? (
        <ol className="mt-1 space-y-1.5 text-xs">
          {STEPS.map(([t, d], i) => (
            <li key={t} className="flex gap-2"><b className="grid h-5 w-5 shrink-0 place-items-center rounded-full text-[10px] text-white" style={{ background: "var(--t-cta)" }}>{i + 1}</b><span><b>{t}:</b> <span style={{ color: "var(--t-muted)" }}>{d}</span></span></li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}
