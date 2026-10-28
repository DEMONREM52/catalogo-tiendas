"use client";

import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";

export type AuditEvent = {
  id: string; created_at: string; store_id: string | null; store_name?: string | null; point_id: string | null; point_name: string | null;
  user_id: string | null; user_name: string | null; actor_type: string | null; actor_role: string | null;
  category: string; module: string | null; severity: string; result: string | null;
  action: string; entity: string; entity_id: string | null;
  before: Record<string, unknown> | null; after: Record<string, unknown> | null;
  reason: string | null; detail: Record<string, unknown> | null; ip: string | null; user_agent: string | null;
  correlation_id: string | null; chain_seq: number | null; hash: string | null;
};
export type AuditFilters = {
  from?: string; to?: string; module?: string; category?: string; severity?: string; result?: string;
  point_id?: string; user_id?: string; entity_id?: string; entities?: string[]; action?: string; event_id?: string; q?: string; store_id?: string;
};
export type AuditAccess = { scope: "all" | "points" | "own" | null; can_verify: boolean; can_configure: boolean; audit_scope: "permission" | "point_users" };

export const MODULES: Array<{ key: string; label: string; emoji: string }> = [
  { key: "productos", label: "Productos y catálogos", emoji: "📦" },
  { key: "precios", label: "Precios y márgenes", emoji: "🏷️" },
  { key: "liquidaciones", label: "Repartos y liquidaciones", emoji: "🤝" },
  { key: "inventario", label: "Inventario y compras", emoji: "🏭" },
  { key: "ventas", label: "Ventas y pedidos", emoji: "💳" },
  { key: "terceros", label: "Terceros y cartera", emoji: "👥" },
  { key: "gastos_nomina", label: "Gastos y nómina", emoji: "💸" },
  { key: "facturacion_electronica", label: "Facturación electrónica", emoji: "🏛️" },
  { key: "usuarios", label: "Usuarios y permisos", emoji: "👤" },
  { key: "configuracion", label: "Configuración y puntos", emoji: "⚙️" },
  { key: "seguridad", label: "Seguridad y sesiones", emoji: "🛡️" },
  { key: "exportaciones", label: "Exportaciones", emoji: "📤" },
  { key: "auditoria", label: "Consultas de auditoría", emoji: "🕵️" },
  { key: "operaciones", label: "Otras operaciones", emoji: "🗂️" },
];
export const moduleInfo = (k: string | null) => MODULES.find((m) => m.key === k) ?? { key: k ?? "", label: k ?? "—", emoji: "🗂️" };

export const RESULT: Record<string, { label: string; color: string; emoji: string }> = {
  success: { label: "Exitoso", color: "#22c55e", emoji: "✅" },
  failed: { label: "Fallido", color: "#f59e0b", emoji: "⚠️" },
  blocked: { label: "Bloqueado", color: "#ef4444", emoji: "⛔" },
  suspicious: { label: "Sospechoso", color: "#f97316", emoji: "🚩" },
};
export const ROLE: Record<string, string> = { owner: "dueño", seller: "vendedor", admin: "administrador", store_admin: "administrador", accounting: "contabilidad", cashier: "cajero", warehouse: "bodega" };
export const ACTOR: Record<string, string> = { user: "Persona", service: "Integración", system: "Sistema", public: "Cliente (público)" };

const ENTITY: Record<string, string> = {
  producto: "Producto", products: "Producto", categoria: "Categoría", catalogo: "Catálogo", catalogo_producto: "Precio en catálogo",
  regla_precio: "Regla de precio", limite_precio: "Límite de precio", rentabilidad: "Configuración de rentabilidad", autorizacion_precio: "Autorización de precio",
  beneficiario: "Beneficiario", reparto: "Reparto", liquidacion: "Liquidación", gasto: "Gasto", gasto_recurrente: "Gasto recurrente",
  categoria_gasto: "Categoría de gasto", presupuesto: "Presupuesto", reserva: "Reserva", empleado: "Empleado", nomina: "Nómina", concepto_nomina: "Concepto de nómina",
  compra: "Ingreso de factura", traslado: "Traslado", ajuste: "Ajuste de inventario", cuenta_por_pagar: "Cuenta por pagar", cuenta_por_cobrar: "Cuenta por cobrar",
  pedido: "Pedido / venta", metodo_pago: "Método de pago", datos_facturacion: "Datos de facturación", perfil_tienda: "Perfil de la tienda",
  rol: "Rol", tienda: "Tienda", punto: "Punto / bodega", proveedor: "Proveedor", usuario: "Usuario", tercero: "Tercero", contribuyente: "Contribuyente",
  session: "Sesión", security: "Seguridad", auditoria: "Auditoría", system: "Sistema",
};
const OP: Record<string, string> = { insert: "creado", update: "modificado", delete: "eliminado" };
const ACTIONS: Record<string, string> = {
  "auth.login": "Inició sesión", "auth.logout": "Cerró sesión", "audit.view": "Abrió el centro de auditoría", "export.audit": "Exportó la auditoría",
  "producto.precio": "Cambió precios o costo", "sale.returned": "Devolución de venta", "sale.voided": "Anuló un documento",
  "security.audit_denied": "Intentó ver auditoría sin permiso", "security.audit_cross_point": "Intentó ver otro punto",
  "security.audit_integrity_failed": "Falla de integridad en la auditoría", "tienda.eliminada": "Tienda eliminada",
  "price_approval.approved": "Aprobó un precio bajo el límite", "price_approval.rejected": "Rechazó un precio bajo el límite",
  "price_limit.saved": "Cambió un límite de precio",
  "product.deleted": "Eliminó un producto", "product.deleted_with_units": "Eliminó un producto con unidades (se hizo responsable)",
};
export function actionLabel(e: Pick<AuditEvent, "action" | "entity">) {
  if (ACTIONS[e.action]) return ACTIONS[e.action];
  const [ent, op] = e.action.split(".");
  if (OP[op]) return `${ENTITY[ent] ?? ent} ${OP[op]}`;
  return e.action.replace(/[._]/g, " ");
}
export const entityLabel = (k: string) => ENTITY[k] ?? k;

const FIELD: Record<string, string> = {
  name: "Nombre", sku: "Código", active: "Activo", status: "Estado", description: "Descripción", category_id: "Categoría",
  cost_price: "Costo", price_1: "Precio 1", price_2: "Precio 2", price_3: "Precio 3", price_4: "Precio 4", price_5: "Precio 5",
  price_retail: "Precio detal", price_wholesale: "Precio mayor", markup_1: "% ganancia P1", markup_2: "% ganancia P2", markup_3: "% ganancia P3",
  markup_4: "% ganancia P4", markup_5: "% ganancia P5", min_wholesale: "Mínimo mayor", permissions: "Permisos", role: "Rol", point_id: "Punto",
  total: "Total", balance: "Saldo", amount: "Valor", mode: "Modo", margin_pct: "Margen %", value: "Valor", kind: "Tipo", price_override: "Precio en catálogo",
  enabled: "Habilitado", active_until: "Activa hasta", nit: "NIT", document_number: "Documento", credit_limit: "Cupo", credit_enabled: "Crédito",
  credit_blocked: "Crédito bloqueado", customer_name: "Cliente", cancel_reason: "Motivo de anulación", salary: "Salario", base_salary: "Salario base",
};
export const fieldLabel = (k: string) => FIELD[k] ?? k.replace(/_/g, " ");

export function fmtValue(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "boolean") return v ? "Sí" : "No";
  if (typeof v === "number") return v.toLocaleString("es-CO");
  if (Array.isArray(v)) return v.length ? v.join(", ") : "—";
  if (typeof v === "object") return JSON.stringify(v);
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) return new Date(s).toLocaleString("es-CO");
  if (/^-?\d+(\.\d+)?$/.test(s) && s.length < 16) return Number(s).toLocaleString("es-CO");
  return s;
}

/** Campos que cambiaron (antes → después) en el orden en que llegaron. */
export function diffRows(e: Pick<AuditEvent, "before" | "after">) {
  // «producto» es solo una etiqueta del evento de precios (no un campo que cambió).
  const keys = Array.from(new Set([...Object.keys(e.before ?? {}), ...Object.keys(e.after ?? {})])).filter((k) => k !== "producto");
  return keys.map((k) => ({ key: k, label: fieldLabel(k), before: e.before?.[k], after: e.after?.[k] }));
}

const accessCache = new Map<string, Promise<AuditAccess | null>>();
/** ¿Puede ver la auditoría de esta tienda (y con qué alcance)? Una consulta por sesión y tienda. */
export function useAuditAccess(storeId: string | null | undefined, platform = false) {
  const [access, setAccess] = useState<AuditAccess | null>(null);
  const key = platform ? "platform" : storeId ?? "";
  useEffect(() => {
    if (!key) return;
    let alive = true;
    if (!accessCache.has(key)) {
      accessCache.set(key, Promise.resolve(supabaseBrowser().rpc("erp_audit_access", { p_store: platform ? null : storeId }))
        .then(({ data, error }) => (error ? null : (data as AuditAccess))).catch(() => null));
    }
    void accessCache.get(key)!.then((a) => alive && setAccess(a));
    return () => { alive = false; };
  }, [key, platform, storeId]);
  return access;
}
