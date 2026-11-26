/**
 * Reparte lo que hay entre los pedidos, en proporción a lo que pidió cada uno (lo que sobra por redondeo va a
 * quien quedó más cerca de la siguiente unidad). Nunca le da a nadie más de lo que pidió.
 */
export function splitEven(available: number, wants: number[]): number[] {
  const total = wants.reduce((s, w) => s + w, 0);
  const avail = Math.max(0, Math.min(Math.floor(available), total));
  if (!total) return wants.map(() => 0);
  const raw = wants.map((w) => (avail * w) / total);
  const out = raw.map(Math.floor);
  let left = avail - out.reduce((s, x) => s + x, 0);
  const order = raw.map((r, i) => ({ i, f: r - Math.floor(r) })).sort((a, b) => b.f - a.f || wants[b.i] - wants[a.i] || a.i - b.i);
  for (const { i } of order) {
    if (left <= 0) break;
    if (out[i] < wants[i]) { out[i] += 1; left -= 1; }
  }
  return out;
}
