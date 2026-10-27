// «¿En qué mejoro?»: lee el embudo real de la landing y da consejos concretos, del más importante al menos.

export type LandingTotals = {
  visits: number; form: number; started: number; orders: number; units: number; revenue: number; upsells: number;
  cod: number; online: number; addi: number; confirmed: number; leads: number; live: number;
  scroll50: number; scroll90: number; bounce: number; avg_seconds: number; mobile: number; desktop: number;
};
export type SourceRow = { source: string; visits: number; orders: number; form: number; avg_seconds: number };
export type Insight = { tone: "good" | "warn" | "bad" | "info"; title: string; text: string };

const pct = (a: number, b: number) => (b > 0 ? (a / b) * 100 : 0);
const f1 = (n: number) => `${n.toFixed(n < 10 ? 1 : 0).replace(".", ",")} %`;

export function landingInsights(t: LandingTotals, sources: SourceRow[], opts: { upsellOn: boolean; openLeads: number }): Insight[] {
  const out: Insight[] = [];
  const v = Number(t.visits) || 0;
  if (v < 30) {
    const tip = opts.openLeads ? ` Mientras tanto, escríbele a los ${opts.openLeads} que dejaron su WhatsApp sin terminar.` : "";
    return [{ tone: "info", title: "Aún hay pocas visitas", text: `Van ${v}. Con unas 100 visitas ya se ve qué funciona. Comparte el enlace con seguimiento del kit de pauta.${tip}` }];
  }
  const conv = pct(t.orders, v);
  const bounce = pct(t.bounce, v);
  const scroll = pct(t.scroll50, v);
  const form = pct(t.form, v);
  const start = pct(t.started, t.form);
  const finish = pct(t.orders, t.started);

  if (v >= 30 && conv >= 3) out.push({ tone: "good", title: `¡Convierte muy bien! (${f1(conv)})`, text: "De cada 100 visitas, más de 3 compran. Sube el presupuesto en la fuente que más vende y prueba un segundo anuncio con otra foto." });
  if (v >= 30 && bounce > 55) out.push({ tone: "bad", title: `${f1(bounce)} se va en segundos`, text: "No les engancha lo primero que ven. Cambia la primera foto (que muestre el producto puesto o en uso) y el titular. El anuncio y la landing deben mostrar lo mismo." });
  if (v >= 30 && scroll < 35 && bounce <= 55) out.push({ tone: "warn", title: `Solo ${f1(scroll)} baja a ver más`, text: "Pon lo mejor arriba: precio, «paga al recibir» y el botón. Un video corto de 15 s suele subir mucho el interés." });
  if (v >= 30 && form < 8) out.push({ tone: "warn", title: `Pocos tocan «Comprar» (${f1(form)})`, text: "Haz la oferta más clara: paquete 2x con descuento, garantía visible, envío gratis o «paga al recibir» en el botón. Revisa que el precio sea competitivo." });
  if (t.form >= 10 && start < 50) out.push({ tone: "warn", title: `Abren el pedido y no empiezan (${f1(start)})`, text: "El formulario asusta. Quita lo que no necesites (correo, barrio) y deja claro el total y que el envío es gratis." });
  if (t.started >= 10 && finish < 45) out.push({ tone: "bad", title: `Empiezan a llenar y no terminan (${f1(finish)})`, text: `Escríbeles por WhatsApp: tienes ${opts.openLeads} por recuperar en esta landing. Revisa también si el costo del envío los sorprende al final.` });
  if (t.orders >= 10) {
    const confirmed = pct(t.confirmed, t.orders);
    if (confirmed < 60) out.push({ tone: "warn", title: `Solo ${f1(confirmed)} de los pedidos está confirmado`, text: "Confirma cada pedido por WhatsApp en la primera hora. En contraentrega, confirmar rápido baja mucho las devoluciones." });
  }
  if (opts.upsellOn && t.orders >= 15 && pct(t.upsells, t.orders) < 10) out.push({ tone: "info", title: "El adicional casi no se lleva", text: "Prueba un producto más barato que combine (accesorio) o súbele el descuento." });
  if (!opts.upsellOn && t.orders >= 10) out.push({ tone: "info", title: "Activa un adicional de último momento", text: "Ofrecer un accesorio con descuento justo antes de enviar el pedido sube el valor de cada venta sin pagar más pauta." });
  if (Number(t.avg_seconds) > 0 && t.avg_seconds < 15 && v >= 30) out.push({ tone: "warn", title: `Se quedan muy poco (${t.avg_seconds} s en promedio)`, text: "Revisa que la página cargue rápido en datos móviles: fotos livianas y la primera imagen bien recortada." });
  if (v >= 30 && pct(t.mobile, v) > 80) out.push({ tone: "info", title: `${f1(pct(t.mobile, v))} entra por celular`, text: "Diseña pensando en el celular: revisa la landing en tu teléfono, botones grandes y textos cortos." });

  const ranked = sources.filter((s) => s.visits >= 20).map((s) => ({ ...s, conv: pct(s.orders, s.visits) })).sort((a, b) => b.conv - a.conv);
  if (ranked.length >= 2 && ranked[0].conv > 0) {
    const best = ranked[0], worst = ranked[ranked.length - 1];
    out.push({ tone: "good", title: `${best.source} es la fuente que mejor vende (${f1(best.conv)})`, text: worst.conv < best.conv / 2 ? `${worst.source} convierte ${f1(worst.conv)}: mueve presupuesto de ahí a ${best.source}.` : "Las fuentes van parejas; sigue probando anuncios nuevos." });
  }
  if (!out.length) out.push({ tone: "good", title: "Todo va bien", text: "No vemos nada que corregir con los datos de ahora. Sigue probando fotos y textos nuevos en los anuncios." });
  const order = { bad: 0, warn: 1, good: 2, info: 3 } as const;
  return out.sort((a, b) => order[a.tone] - order[b.tone]);
}
