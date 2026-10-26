"use client";

import { supabaseBrowser } from "@/lib/supabase/client";
import { idbGet, idbSet } from "@/lib/offline/idb";
import { deviceId } from "@/lib/offline/device";
import { getDrafts, type PosDraftFiscal } from "./drafts";

/**
 * Facturas de contingencia (talonario/papel) para cuando se cae el internet en un punto que factura
 * electrónicamente. Mientras hay conexión, este equipo separa unos números de la numeración de
 * contingencia del punto (20261243); sin conexión los usa en orden, uno por venta, y al volver la
 * conexión cada venta se registra con su número y se transmite a la DIAN (plazo: 48 horas).
 * Dos equipos nunca reciben los mismos números.
 */
export type ContingencyBlock = {
  id: string;
  range_id: string;
  prefix: string;
  from: number;
  to: number;
  free: number[];
  resolution_number: string | null;
  resolution_date: string | null;
  valid_from: string | null;
  valid_until: string | null;
  range_from: number;
  range_to: number;
};
export type ContingencyIssuer = {
  legal_name: string;
  trade_name: string | null;
  document_type: string;
  document_number: string | null;
  verification_digit: string | null;
  tax_regime: string | null;
  tax_responsibilities: string[] | null;
  fiscal_address: string | null;
  city: string | null;
  department: string | null;
  phone: string | null;
  email: string | null;
  establishment: { name: string; address: string | null; city: string | null } | null;
  point: { name: string; code: string } | null;
};
export type ContingencyInfo = {
  enabled: boolean;
  configured?: boolean;
  environment?: string;
  reason?: string | null;
  blocks: ContingencyBlock[];
  issuer?: ContingencyIssuer;
  prices_include_tax?: boolean;
  final_consumer?: { name: string; doc: string };
};
export type ContingencyPool = { at: number; info: ContingencyInfo; used: string[] };

const poolKey = (storeId: string, pointId: string) => `contingency:${storeId}:${pointId}`;
const tag = (rangeId: string, n: number) => `${rangeId}:${n}`;
const BOGOTA_DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota", year: "numeric", month: "2-digit", day: "2-digit" });
const todayBogota = () => BOGOTA_DAY.format(new Date());

/** Números que las ventas guardadas (aún sin enviar) ya tienen. */
function draftNumbers(storeId: string) {
  return new Set(getDrafts(storeId).filter((d) => d.fiscal).map((d) => tag(d.fiscal!.range_id, d.fiscal!.number)));
}

/** Con conexión: separa números si faltan y guarda lo necesario para imprimir sin conexión. */
export async function refreshContingency(storeId: string, pointId: string): Promise<ContingencyPool> {
  const { data, error } = await supabaseBrowser().rpc("fiscal_offline_reserve", { p_point: pointId, p_device: deviceId(), p_count: 15 });
  if (error) throw error;
  const res = data as (ContingencyInfo & { ok: boolean; code?: string; message?: string }) | null;
  if (!res || res.ok === false) throw new Error(res?.message ?? "No se pudieron separar los números de contingencia.");
  const info: ContingencyInfo = { ...res, blocks: Array.isArray(res.blocks) ? res.blocks : [] };
  const prev = await idbGet<ContingencyPool>(poolKey(storeId, pointId));
  // Lo que el servidor aún ve libre pero este equipo ya usó (ventas sin enviar) sigue ocupado.
  const serverFree = new Set(info.blocks.flatMap((b) => b.free.map((n) => tag(b.range_id, n))));
  const used = [...new Set([...(prev?.used ?? []), ...draftNumbers(storeId)])].filter((u) => serverFree.has(u));
  const pool: ContingencyPool = { at: Date.now(), info, used };
  await idbSet(poolKey(storeId, pointId), pool);
  return pool;
}

export function loadContingency(storeId: string, pointId: string) {
  return idbGet<ContingencyPool>(poolKey(storeId, pointId));
}

/** Números que se pueden usar ya (resolución vigente hoy y sin usar en este equipo). */
export function availableNumbers(pool: ContingencyPool | null | undefined, storeId: string) {
  if (!pool?.info.enabled) return [];
  const today = todayBogota();
  const taken = new Set([...pool.used, ...draftNumbers(storeId)]);
  return pool.info.blocks
    .filter((b) => (!b.valid_until || b.valid_until >= today) && (!b.valid_from || b.valid_from <= today))
    .flatMap((b) => b.free.filter((n) => !taken.has(tag(b.range_id, n))).map((n) => ({ block: b, number: n })))
    .sort((a, b) => a.number - b.number);
}

async function withLock<T>(name: string, work: () => Promise<T>): Promise<T> {
  // Dos pestañas del mismo equipo no toman el mismo número.
  const locks = typeof navigator !== "undefined" ? (navigator as Navigator & { locks?: LockManager }).locks : undefined;
  if (locks?.request) return locks.request(name, () => work()) as Promise<T>;
  return work();
}

/** Toma el siguiente número de contingencia (queda ocupado en este equipo de inmediato). */
export function takeContingencyNumber(storeId: string, pointId: string): Promise<PosDraftFiscal | null> {
  return withLock(`remhub-contingency-${storeId}-${pointId}`, async () => {
    const pool = await loadContingency(storeId, pointId);
    const next = availableNumbers(pool, storeId)[0];
    if (!pool || !next) return null;
    const { block, number } = next;
    await idbSet(poolKey(storeId, pointId), { ...pool, used: [...pool.used, tag(block.range_id, number)] });
    return {
      block_id: block.id,
      range_id: block.range_id,
      number,
      prefix: block.prefix,
      full_number: `${block.prefix}${number}`,
      environment: pool.info.environment,
      resolution: {
        number: block.resolution_number, date: block.resolution_date, valid_from: block.valid_from, valid_until: block.valid_until,
        from: block.range_from, to: block.range_to,
      },
      issuer: pool.info.issuer ?? null,
      prices_include_tax: pool.info.prices_include_tax ?? true,
      final_consumer_doc: pool.info.final_consumer?.doc,
    };
  });
}

/** Devuelve un número que no alcanzó a usarse (por ejemplo, si la venta no se pudo guardar). */
export function giveBackContingencyNumber(storeId: string, pointId: string, fiscal: PosDraftFiscal) {
  return withLock(`remhub-contingency-${storeId}-${pointId}`, async () => {
    const pool = await loadContingency(storeId, pointId);
    if (!pool) return;
    await idbSet(poolKey(storeId, pointId), { ...pool, used: pool.used.filter((u) => u !== tag(fiscal.range_id, fiscal.number)) });
  });
}
