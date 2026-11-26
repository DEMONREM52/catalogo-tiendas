/**
 * Corre `fn` sobre cada elemento con a lo sumo `limit` a la vez y devuelve los resultados EN EL MISMO ORDEN.
 *
 * Para consultas independientes que antes iban una por una (una por punto, por categoría, por pedido): el tiempo
 * pasa de N viajes a la base a unos N/limit, sin abrir cientos de peticiones a la vez (el navegador permite ~6 por
 * dominio y la base tiene un límite de conexiones). Si una falla, las demás siguen; el error queda en su posición.
 *
 *   const res = await mapLimit(puntos, 4, (p) => sb.rpc("...", { p_point: p.id }));
 */
export type Settled<R> = { ok: true; value: R } | { ok: false; error: unknown };

export async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R> | PromiseLike<R>): Promise<Settled<R>[]> {
  const out: Settled<R>[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      try {
        out[i] = { ok: true, value: await fn(items[i], i) };
      } catch (error) {
        out[i] = { ok: false, error };
      }
    }
  };
  const n = Math.max(1, Math.min(Math.floor(limit) || 1, items.length));
  await Promise.all(Array.from({ length: n }, worker));
  return out;
}
