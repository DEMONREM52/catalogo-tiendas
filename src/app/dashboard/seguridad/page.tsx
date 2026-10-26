"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { getDashboardStore, hasStorePermission } from "@/lib/store-utils";

/**
 * Copias de seguridad y seguridad: cuándo se bajó la última copia, quién tiene acceso a qué,
 * la revisión de la huella de la auditoría y cómo protege RemHub los datos (en palabras simples).
 */

// Copias automáticas del servidor (días que guarda el proveedor de la base). Solo se muestra si está contratado:
// en el plan gratuito de Supabase no hay copias descargables; en Pro son 7 días. null = no se promete nada.
const SERVER_BACKUP_DAYS: number | null = null;

type Overview = {
  ok: boolean; message?: string;
  last_backup: { at: string; by: string | null; rows: number | null } | null;
  team: { total: number; active: number; inactive: number; admins: number; can_users: string[]; can_costs: number };
  changes: Array<{ at: string; action: string; by: string | null }>;
};
type Verify = { ok: boolean; checked?: number; breaks?: unknown[]; message?: string };

const card = { borderColor: "var(--t-card-border)", background: "color-mix(in oklab, var(--t-card-bg) 92%, transparent)" };
const ddmm = (iso: string) => new Date(iso).toLocaleDateString("es-CO", { day: "2-digit", month: "2-digit", year: "numeric" });
const daysAgo = (iso: string) => Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
const ACTION: Record<string, string> = {
  "usuario.insert": "Usuario creado", "usuario.update": "Usuario o permisos cambiados", "usuario.delete": "Usuario eliminado",
  "users.temp_permission": "Permiso temporal dado", "users.temp_permission_expired": "Permiso temporal vencido",
  "users.temp_permission_removed": "Permiso temporal quitado", "users.temp_permission_kept": "Permiso temporal dejado fijo", "users.schedule": "Horario de acceso cambiado",
};

export default function SecurityPage() {
  const [storeId, setStoreId] = useState<string | null>(null);
  const [canAudit, setCanAudit] = useState(false);
  const [denied, setDenied] = useState(false);
  const [o, setO] = useState<Overview | null>(null);
  const [verify, setVerify] = useState<Verify | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    void (async () => {
      const a = await getDashboardStore().catch(() => null);
      if (!a?.store) return setDenied(true);
      setStoreId(a.store.id);
      setCanAudit(hasStorePermission(a, "audit"));
      const { data, error } = await supabaseBrowser().rpc("erp_security_overview", { p_store: a.store.id });
      if (error) setO({ ok: false, message: /Could not find the function|schema cache/i.test(error.message) ? "Falta ejecutar la migración 20261247 en Supabase." : error.message } as Overview);
      else setO(data as Overview);
    })();
  }, []);

  async function check() {
    if (!storeId) return;
    setChecking(true);
    const { data, error } = await supabaseBrowser().rpc("erp_audit_verify", { p_store: storeId, p_limit: 20000 });
    setChecking(false);
    setVerify(error ? { ok: false, message: error.message } : (data as Verify));
  }

  if (denied) return <p className="p-6 text-sm">No tienes una tienda abierta.</p>;
  if (!o) return <p className="p-6 text-sm" style={{ color: "var(--t-muted)" }}>Cargando…</p>;
  if (!o.ok) return <p className="rounded-2xl border p-5 text-sm" style={card}>🔒 {o.message}</p>;

  const last = o.last_backup;
  const age = last ? daysAgo(last.at) : null;
  const backupTone = age === null || age > 45 ? "#ef4444" : age > 30 ? "#f59e0b" : "#22c55e";

  return (
    <main className="space-y-4">
      <section className="rounded-3xl border p-5" style={card}>
        <h1 className="text-xl font-black">🛡️ Copias de seguridad y seguridad</h1>
        <p className="mt-1 text-sm" style={{ color: "var(--t-muted)" }}>
          Tus datos son tuyos: aquí ves cuándo sacaste la última copia, quién tiene acceso a qué y cómo se protege la información.
        </p>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-3xl border p-5" style={card}>
          <h2 className="font-black">💾 Tu copia propia</h2>
          <p className="mt-2 text-sm">
            {last ? <>Última copia completa: <b style={{ color: backupTone }}>{ddmm(last.at)}</b> ({age === 0 ? "hoy" : `hace ${age} día${age === 1 ? "" : "s"}`}){last.by ? ` · la bajó ${last.by}` : ""}{last.rows ? ` · ${Number(last.rows).toLocaleString("es-CO")} filas` : ""}.</>
              : <b style={{ color: backupTone }}>Todavía no has bajado ninguna copia.</b>}
          </p>
          <p className="mt-1 text-xs" style={{ color: "var(--t-muted)" }}>
            Recomendado: una vez al mes. Es un Excel con todo (productos, terceros, ventas, compras, cartera, inventario…) que guardas donde quieras: tu correo, Drive o una memoria.
          </p>
          <Link href="/dashboard/datos" className="mt-3 inline-flex rounded-full px-4 py-2 text-sm font-bold" style={{ background: "var(--t-cta)", color: "#0b0b0b" }}>⬇️ Bajar copia ahora</Link>
          {SERVER_BACKUP_DAYS ? (
            <p className="mt-3 text-xs" style={{ color: "var(--t-muted)" }}>Además, el servidor guarda copias automáticas de los últimos {SERVER_BACKUP_DAYS} días.</p>
          ) : null}
        </section>

        <section className="rounded-3xl border p-5" style={card}>
          <h2 className="font-black">👥 Quién tiene acceso</h2>
          <ul className="mt-2 space-y-1 text-sm">
            <li>{o.team.active} usuario(s) activo(s){o.team.inactive ? ` · ${o.team.inactive} inactivo(s)` : ""}</li>
            <li>{o.team.admins} administrador(es) de la tienda</li>
            <li>Pueden crear o cambiar usuarios: <b>{o.team.can_users.length ? o.team.can_users.join(", ") : "solo el dueño"}</b></li>
            <li>{o.team.can_costs} persona(s) ven los costos</li>
          </ul>
          <p className="mt-2 text-xs" style={{ color: "var(--t-muted)" }}>Cuando alguien deje de trabajar contigo, desactívalo el mismo día. Cada persona con su propio usuario: nunca compartido.</p>
          <Link href="/dashboard/store/users" className="mt-3 inline-flex rounded-full border px-4 py-2 text-sm font-bold" style={{ borderColor: "var(--t-card-border)" }}>👤 Revisar usuarios</Link>
          {o.changes.length ? (
            <div className="mt-3 text-xs" style={{ color: "var(--t-muted)" }}>
              <p className="font-bold">Últimos cambios de usuarios</p>
              {o.changes.map((c, i) => <p key={i}>{ddmm(c.at)} · {ACTION[c.action] ?? c.action}{c.by ? ` · por ${c.by}` : ""}</p>)}
            </div>
          ) : null}
        </section>
      </div>

      {canAudit ? (
        <section className="rounded-3xl border p-5" style={card}>
          <h2 className="font-black">🔗 Huella de la auditoría</h2>
          <p className="mt-1 text-sm" style={{ color: "var(--t-muted)" }}>
            Cada movimiento queda encadenado con una huella digital (SHA-256). Si alguien borrara o cambiara un registro por fuera, la cadena se rompe y aquí se ve.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button type="button" disabled={checking} onClick={() => void check()} className="rounded-full border px-4 py-2 text-sm font-bold disabled:opacity-50" style={{ borderColor: "var(--t-card-border)" }}>
              {checking ? "Revisando…" : "Revisar ahora"}
            </button>
            {verify ? (
              <span className="text-sm font-bold" style={{ color: verify.ok ? "#22c55e" : "#ef4444" }}>
                {verify.ok ? `✅ Intacta · ${Number(verify.checked ?? 0).toLocaleString("es-CO")} registros revisados` : verify.message ?? `⚠️ ${verify.breaks?.length ?? 0} punto(s) con la cadena rota: revisa la auditoría`}
              </span>
            ) : null}
            <Link href="/dashboard/auditoria" className="text-sm font-bold underline">Abrir la auditoría</Link>
          </div>
        </section>
      ) : null}

      <section className="rounded-3xl border p-5" style={card}>
        <h2 className="font-black">🔐 Cómo se protegen tus datos</h2>
        <ul className="mt-2 grid gap-2 text-sm sm:grid-cols-2">
          {[
            ["🔒", "Conexión cifrada", "Todo viaja por HTTPS, como en la banca en línea."],
            ["🔑", "Contraseñas", "Nunca se guardan en texto: se guardan cifradas y nadie las puede leer, ni RemHub."],
            ["🏪", "Cada tienda aparte", "La base no deja que una tienda vea datos de otra, ni que un usuario vea lo que su permiso no le da."],
            ["🧾", "Claves de facturación", "Los certificados y tokens de facturación electrónica se guardan cifrados y nunca llegan al navegador."],
            ["🔗", "Auditoría encadenada", "Quién hizo qué y cuándo, con huella digital para notar cambios por fuera."],
            ["📴", "Sin internet", "Lo que estás haciendo se guarda en el equipo y se sube cuando vuelve la conexión."],
          ].map(([icon, title, text]) => (
            <li key={title} className="rounded-2xl border p-3" style={{ borderColor: "var(--t-card-border)" }}>
              <b>{icon} {title}</b>
              <span className="block text-xs" style={{ color: "var(--t-muted)" }}>{text}</span>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
