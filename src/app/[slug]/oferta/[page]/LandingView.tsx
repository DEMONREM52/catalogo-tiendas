"use client";
/* eslint-disable @next/next/no-img-element */

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { supabaseBrowser } from "@/lib/supabase/client";
import { track } from "@/lib/tracking";
import { CO_DEPARTMENTS, SOLD_WINDOWS, VIEWERS_WINDOWS, deliveryWindow, discounted, normalizeLanding, optionDims, type LandingBundle, type LandingPayment, type SectionKey } from "@/lib/landing/config";
import { fillText } from "@/lib/landing/templates";
import { getYoutubeEmbedUrl } from "@/lib/product-details";
import { landingPixelEvent, landingRef, landingSession, loadLandingPixels, metaCookies, type LandingRef } from "@/lib/landing/client-tracking";

export type LandingItem = {
  id: string; name: string; option: string; image: string | null; gallery: string[]; description: string | null;
  highlights: string[]; specifications: Array<{ name: string; value: string }>; video_url?: string | null; price: number; stock: number | null;
};
export type LandingSocial = { live: number; sold_week: number; live_window?: string; sold_window?: string; recent: Array<{ name: string; city: string; units: number; minutes: number }> };
export type LandingTrust = { business_name: string | null; nit: string | null; points: Array<{ name: string; city: string | null; address: string | null }>; links: Array<{ type: string; url: string }>; orders_done: number; since: number | null };
export type LandingData = {
  store: { id: string; slug: string; name: string; logo_url: string | null; whatsapp: string | null };
  page: { id: string; slug: string; name: string; config: unknown; catalog: string };
  items: LandingItem[];
  upsell: LandingItem | null;
  payments: { cod: boolean; online: boolean; addi: boolean };
  social: LandingSocial;
  trust?: LandingTrust | null;
};

const money = (v: number) => `$${Math.round(Number(v) || 0).toLocaleString("es-CO")}`;
const DAY = new Intl.DateTimeFormat("es-CO", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const ago = (m: number) => (m < 1 ? "hace un momento" : m < 60 ? `hace ${m} min` : m < 1440 ? `hace ${Math.floor(m / 60)} h` : `hace ${Math.floor(m / 1440)} d`);
const waNumber = (raw: string | null) => {
  const d = (raw ?? "").replace(/\D/g, "");
  return d.length === 10 ? `57${d}` : d;
};
const DEFAULT_POLICY = `Derecho de retracto: en compras por internet tienes 5 días hábiles desde que recibes el producto para retractarte (Ley 1480 de 2011, art. 47). El producto debe estar sin usar y en su empaque.
Reversión del pago: si pagaste en línea y hubo fraude, el producto no llegó o no es el que pediste, puedes pedir la reversión dentro de los 5 días hábiles siguientes (art. 51).
Cambios: escríbenos por WhatsApp con tu número de pedido.
Tus datos se usan solo para gestionar tu pedido y su entrega (Ley 1581 de 2012).`;

/** Próxima medianoche en Colombia (UTC−5). */
const nextMidnight = (now: number) => {
  const bog = new Date(now - 5 * 3600_000);
  return Date.UTC(bog.getUTCFullYear(), bog.getUTCMonth(), bog.getUTCDate() + 1) + 5 * 3600_000;
};

function useCountdown(endsAt: string | null) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    if (!endsAt) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNow(Date.now());
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [endsAt]);
  if (!endsAt || now === null) return null;
  const left = Math.max(0, (endsAt === "midnight" ? nextMidnight(now) : Date.parse(endsAt)) - now);
  if (left <= 0) return null;
  const s = Math.floor(left / 1000);
  return { d: Math.floor(s / 86400), h: Math.floor((s % 86400) / 3600), m: Math.floor((s % 3600) / 60), s: s % 60 };
}

/** Marca de «modo editar» en la vista previa: al tocar la parte, el editor abre su sección. */
const E = (key: string, label: string) => ({ "data-edit": key, "data-edit-label": label });
const SECTION_EDIT: Record<SectionKey, [string, string]> = {
  hero: ["texts", "Textos"], poster: ["poster", "Afiche"], benefits: ["benefits", "Beneficios"], video: ["media", "Video"],
  stories: ["stories", "Bloques de historia"], details: ["product", "Detalles del producto"], compare: ["compare", "Comparación"],
  testimonials: ["testimonials", "Opiniones"], trust: ["trust", "Compra con confianza"], final_cta: ["cta", "Llamado a comprar"],
  guarantees: ["faq", "Garantías"], faq: ["faq", "Preguntas frecuentes"],
};

export function LandingView({ data, preview = false, editMode = false }: { data: LandingData; preview?: boolean; editMode?: boolean }) {
  const cfg = useMemo(() => normalizeLanding(data.page.config), [data.page.config]);
  const items = data.items;
  const [sel, setSel] = useState(0);
  const item = items[Math.min(sel, items.length - 1)];
  const [social, setSocial] = useState<LandingSocial>(data.social);
  const [sheet, setSheet] = useState(false);
  const [policy, setPolicy] = useState(false);
  const [sizeGuide, setSizeGuide] = useState(false);
  const [zoom, setZoom] = useState<string | null>(null);
  const [exitAsk, setExitAsk] = useState(false);
  const [exitOn, setExitOn] = useState(false);
  const exitDone = useRef(false);
  const [showSticky, setShowSticky] = useState(false);
  const heroCta = useRef<HTMLButtonElement>(null);
  const metrics = useRef({ scroll: 0, start: 0, cta: 0, started: false });
  const session = useRef("");
  const ref = useRef<LandingRef>({});
  const countdown = useCountdown(!cfg.urgency.countdown ? null : cfg.urgency.countdown_mode === "midnight" ? "midnight" : cfg.promo_ends_at);
  const accent = cfg.accent;
  const productName = item?.name ?? data.page.name;
  const priceText = money(item?.price ?? 0);
  // {producto} es el nombre de la landing (sin el color o la talla de cada opción).
  const headline = fillText(cfg.headline || "{producto}", data.page.name, priceText);
  const images = useMemo(() => {
    const own = [item?.image, ...(item?.gallery ?? [])].filter((u): u is string => typeof u === "string" && /^https?:\/\//.test(u));
    return [...new Set(cfg.images.length ? [...cfg.images, ...own] : own)];
  }, [cfg.images, item]);
  // Fotos del producto mismo (la principal primero): las de la barra fija de abajo.
  const productPhotos = useMemo(() => {
    const own = [item?.image, ...(item?.gallery ?? [])].filter((u): u is string => typeof u === "string" && /^https?:\/\//.test(u));
    return own.length ? [...new Set(own)].slice(0, 8) : images.slice(0, 8);
  }, [item, images]);
  const compare = cfg.compare_at_price && item && cfg.compare_at_price > item.price ? cfg.compare_at_price : null;
  const offPct = compare && item ? Math.round((1 - item.price / compare) * 100) : 0;
  const stars = cfg.testimonials.length ? cfg.testimonials.reduce((s, t) => s + t.stars, 0) / cfg.testimonials.length : 0;
  const delivery = useMemo(() => deliveryWindow(new Date(), cfg.shipping), [cfg.shipping]);
  const wa = waNumber(cfg.whatsapp_number || data.store.whatsapp);
  const trackItem = useCallback((qty = 1) => ({ id: item?.id ?? "", name: productName, price: item?.price ?? 0, quantity: qty }), [item, productName]);

  const ping = useCallback((event: string) => {
    if (preview || !session.current) return;
    const m = metrics.current;
    void supabaseBrowser().rpc("landing_ping", {
      p_store: data.store.slug, p_slug: data.page.slug, p_session: session.current, p_event: event,
      p_ref: { ...ref.current, scroll: m.scroll, seconds: Math.round((Date.now() - m.start) / 1000), cta: m.cta, started: m.started },
    }).then(({ data: r }) => {
      const res = r as (LandingSocial & { ok?: boolean }) | null;
      if (res?.ok) setSocial({ live: Number(res.live) || 0, sold_week: Number(res.sold_week) || 0, live_window: res.live_window, sold_window: res.sold_window, recent: res.recent ?? [] });
    }, () => undefined);
  }, [preview, data.store.slug, data.page.slug]);

  // Visita: identificador, origen, píxeles, latido y medidas de comportamiento.
  useEffect(() => {
    metrics.current.start = Date.now();
    if (preview) return;
    session.current = landingSession();
    ref.current = landingRef();
    loadLandingPixels(cfg.meta_pixel_id, cfg.tiktok_pixel_id);
    ping("view");
    const view = window.setTimeout(() => {
      track.viewItem(trackItem(), data.store.slug);
      landingPixelEvent("ViewContent", { content_ids: [item?.id], content_type: "product", value: item?.price, currency: "COP" });
    }, 700);
    const beat = window.setInterval(() => { if (document.visibilityState === "visible") ping("beat"); }, 25_000);
    const hide = () => { if (document.visibilityState === "hidden") ping("beat"); };
    document.addEventListener("visibilitychange", hide);
    return () => { window.clearTimeout(view); window.clearInterval(beat); document.removeEventListener("visibilitychange", hide); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onScroll = () => {
      const h = document.documentElement;
      const pct = Math.round(((h.scrollTop + window.innerHeight) / Math.max(1, h.scrollHeight)) * 100);
      if (pct > metrics.current.scroll) metrics.current.scroll = Math.min(100, pct);
      const r = heroCta.current?.getBoundingClientRect();
      setShowSticky(Boolean(r && r.bottom < 0));
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Oferta de salida: en computador cuando el mouse sale por arriba; en celular tras 45 s sin abrir el pedido. Una vez por visita.
  useEffect(() => {
    if (preview || !cfg.exit_offer.enabled) return;
    const fire = () => {
      if (exitDone.current || metrics.current.cta > 0) return;
      exitDone.current = true;
      setExitAsk(true);
    };
    const onOut = (e: MouseEvent) => { if (e.clientY <= 0 && !e.relatedTarget) fire(); };
    document.addEventListener("mouseout", onOut);
    const mobile = /Mobi|Android|iPhone/i.test(navigator.userAgent);
    const t = mobile ? window.setTimeout(fire, 45_000) : 0;
    return () => { document.removeEventListener("mouseout", onOut); if (t) window.clearTimeout(t); };
  }, [preview, cfg.exit_offer.enabled]);

  // Las secciones entran deslizándose al bajar (y quedan visibles si el navegador no soporta el observador).
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const els = rootRef.current?.querySelectorAll<HTMLElement>("[data-reveal]:not(.lp-in)") ?? [];
    if (!("IntersectionObserver" in window) || cfg.effects === "off") { els.forEach((el) => el.classList.add("lp-in")); return; }
    const io = new IntersectionObserver((entries) => entries.forEach((en) => { if (en.isIntersecting) { en.target.classList.add("lp-in"); io.unobserve(en.target); } }), { rootMargin: "0px 0px -8% 0px" });
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  });

  // Modo probar (vista previa del editor): botones para abrir el pedido o la oferta de salida sin esperar.
  useEffect(() => {
    if (!preview) return;
    const onMsg = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      const m = e.data as { type?: string; cmd?: string } | null;
      if (m?.type !== "remhub-landing-cmd") return;
      if (m.cmd === "sheet") { setExitAsk(false); setSheet(true); }
      if (m.cmd === "exit") { setSheet(false); setExitAsk(true); }
      if (m.cmd === "top") window.scrollTo({ top: 0, behavior: "smooth" });
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [preview]);

  const sentCart = useRef(false);
  function openSheet() {
    metrics.current.cta += 1;
    setSheet(true);
    if (preview) return;
    ping("form");
    // «Agregar al carrito» una vez por visita (abrir y cerrar la ventana varias veces no suma más).
    if (sentCart.current) return;
    sentCart.current = true;
    track.addToCart(trackItem(), data.store.slug);
    landingPixelEvent("AddToCart", { content_ids: [item?.id], content_type: "product", value: item?.price, currency: "COP" });
  }

  const dims = optionDims(items.map((i) => i.option), cfg.option_label);
  const stock = item?.stock ?? null;
  const lowStock = cfg.urgency.stock && stock !== null && stock > 0 && stock <= cfg.urgency.low_stock_at;
  const soldOut = items.length > 0 && items.every((i) => i.stock !== null && i.stock <= 0);
  const vars = { "--lp-accent": accent, "--lp-accent-soft": `${accent}14` } as CSSProperties;
  useEffect(() => {
    const root = document.documentElement.style;
    root.setProperty("--lp-accent", accent);
    root.setProperty("--lp-accent-soft", `${accent}14`);
  }, [accent]);

  if (!items.length && preview) {
    return (
      <main className="grid min-h-screen place-items-center bg-white px-6 text-center text-slate-900">
        <div><p className="text-5xl">🛍️</p><h1 className="mt-3 text-xl font-black">Elige el producto</h1>
          <p className="mt-2 text-sm text-slate-500">En «Producto y opciones», busca el producto por nombre o código (o crea la landing desde un enlace). Si ya lo elegiste y sigue así, ese catálogo no le da precio o no tiene existencias.</p></div>
      </main>
    );
  }
  if (!items.length) {
    return (
      <main className="grid min-h-screen place-items-center bg-white px-4 text-center text-slate-900">
        <div><p className="text-5xl">🛍️</p><h1 className="mt-3 text-2xl font-black">Esta oferta se agotó</h1><p className="mt-2 text-slate-500">Escríbenos para avisarte cuando vuelva.</p>
          {wa ? <a href={`https://wa.me/${wa}`} className="mt-5 inline-block rounded-full bg-emerald-500 px-6 py-3 font-bold text-white">Escribir por WhatsApp</a> : null}</div>
      </main>
    );
  }

  // Bloque «¿Listo para pedir el tuyo?»: se puede repetir entre secciones y llamar la atención con animación.
  // Texto que se edita directo en la vista previa (solo en modo editar).
  const Fd = (path: string) => (editMode ? { "data-field": path } : {});
  const cb = cfg.cta_block;
  const dark = cb.background === "accent" || cb.background === "dark";
  const share = () => {
    ping("share");
    const url = window.location.href.split("?")[0];
    const text = `Mira esto 😍 ${productName} a ${priceText}`;
    if (navigator.share) void navigator.share({ title: productName, text, url }).catch(() => undefined);
    else window.open(`https://wa.me/?text=${encodeURIComponent(`${text}\n${url}`)}`, "_blank", "noopener");
  };
  const renderCta = (k: string) => (
    <section key={k} {...E("cta", "Llamado a comprar")} className={`lp-ctab lp-ctab-${cb.background} px-4 py-10 text-center ${dark ? "text-white" : "text-slate-900"}`}>
      <div className="mx-auto max-w-3xl">
        {cb.badge ? <span className={`inline-block rounded-full px-3 py-1 text-[11px] font-black uppercase tracking-widest ${dark ? "bg-white/20 text-white" : "lp-chip"}`}>{cb.badge}</span> : null}
        <h2 className="mt-3 text-2xl font-black leading-tight sm:text-4xl">{lowStock ? `⚠️ ¡Solo quedan ${stock} unidades!` : <span {...Fd("cta_block.title")}>{cb.title}</span>}</h2>
        <p className={`mx-auto mt-2 max-w-xl ${dark ? "text-white/85" : "text-slate-600"}`}>
          <span {...Fd("cta_block.text")}>{cb.text || `${cfg.shipping.text}. ${data.payments.cod && cfg.payments.cod ? "Pagas cuando lo recibes." : "Pago 100 % seguro."}`}</span>
        </p>
        <p className="mt-3 flex flex-wrap items-end justify-center gap-x-3 gap-y-1">
          {compare ? <span className={`text-lg font-bold line-through ${dark ? "text-white/60" : "text-slate-400"}`}>{money(compare)}</span> : null}
          <span className="text-3xl font-black sm:text-4xl" style={dark ? undefined : { color: accent }}>{priceText}</span>
        </p>
        {cb.urgency && (countdown || (cfg.urgency.live_viewers && social.live >= Math.max(1, cfg.urgency.viewers_min))) ? (
          <p className={`mt-2 text-sm font-extrabold ${dark ? "text-white" : "text-red-600"}`}>
            {countdown ? <>⏰ Termina en {countdown.d > 0 ? `${countdown.d}d ` : ""}{String(countdown.h).padStart(2, "0")}:{String(countdown.m).padStart(2, "0")}:{String(countdown.s).padStart(2, "0")}</>
              : <>👁️ {social.live.toLocaleString("es-CO")} {VIEWERS_WINDOWS[cfg.urgency.viewers_window].text}</>}
          </p>
        ) : null}
        {cb.arrow ? <div className="lp-arrow mt-3 text-3xl" aria-hidden>👇</div> : null}
        <button type="button" onClick={openSheet} disabled={soldOut}
          className={`lp-cta lp-anim-${cb.style} ${dark ? "lp-cta-inv" : ""} mt-3 w-full max-w-md rounded-2xl px-6 py-4 text-[17px] font-black uppercase text-white disabled:opacity-50`}>
          {soldOut ? "Agotado" : <span {...Fd("cta_block.button")}>{cb.button || cfg.cta_text}</span>}
        </button>
        {cfg.share_button ? <button type="button" className={`mt-3 block w-full text-sm font-bold underline ${dark ? "text-white/80" : "text-slate-500"}`} onClick={share}>💌 Recomiéndalo a una amiga o amigo</button> : null}
      </div>
    </section>
  );

  const blocks: Record<SectionKey, ReactNode> = {
    hero: (
      <>
      {/* Héroe */}
      <section className="mx-auto grid max-w-6xl gap-6 px-4 pb-8 lg:grid-cols-[1.05fr_.95fr] lg:gap-10">
        <div {...E("media", "Fotos")}><Gallery images={images} name={productName} badge={offPct >= 5 ? `-${offPct}%` : cfg.badge} /></div>
        <div className="min-w-0">
          {cfg.badge ? <span {...E("texts", "Etiqueta")} {...Fd("badge")} className="lp-chip inline-block rounded-full px-3 py-1 text-[11px] font-black uppercase tracking-widest">{cfg.badge}</span> : null}
          <h1 {...E("texts", "Titular")} {...Fd("headline")} className="mt-3 text-[28px] font-black leading-[1.08] tracking-tight sm:text-4xl">{headline}</h1>
          {stars ? <p className="mt-2 flex items-center gap-2 text-sm"><span className="text-amber-400">{"★".repeat(Math.round(stars))}{"☆".repeat(5 - Math.round(stars))}</span><span className="font-semibold text-slate-500">{stars.toFixed(1)} · {cfg.testimonials.length} {cfg.testimonials.length === 1 ? "opinión" : "opiniones"}</span></p> : null}
          {cfg.subheadline ? <p {...E("texts", "Subtítulo")} {...Fd("subheadline")} className="mt-3 text-[15px] leading-6 text-slate-600">{cfg.subheadline}</p> : null}

          <div {...E("price", "Precio y promo")} className="lp-price-box mt-5 rounded-3xl p-4">
            {cfg.promo_text ? <p {...Fd("promo_text")} className="text-[13px] font-extrabold" style={{ color: accent }}>{cfg.promo_text}</p> : null}
            <div className="mt-1 flex flex-wrap items-end gap-x-3 gap-y-1">
              {compare ? <span className="text-lg font-bold text-slate-400 line-through">ANTES {money(compare)}</span> : null}
              <span className="text-4xl font-black tracking-tight" style={{ color: accent }}>{compare ? "AHORA " : ""}{priceText}</span>
              {compare ? <span className="lp-shimmer mb-1 rounded-lg bg-emerald-500 px-2 py-0.5 text-xs font-black text-white">💸 AHORRAS {money(compare - item.price)}</span> : null}
            </div>
            {data.payments.addi ? <p className="mt-1 text-xs font-semibold text-slate-500">o hasta en cuotas con Addi</p> : null}
          </div>

          <div {...E("urgency", "Urgencia y prueba social")}><Urgency social={social} cfg={cfg} lowStock={lowStock} stock={stock} /></div>

          {countdown ? (
            <div {...E("price", "Cuenta regresiva")} className="mt-4">
              <p className="mb-2 flex items-center justify-center gap-2 text-xs font-black uppercase tracking-widest text-red-600"><span className="lp-bell text-base" aria-hidden>⏰</span>¡La oferta termina en!<span className="lp-bell text-base" aria-hidden>⏰</span></p>
              <div className="grid grid-cols-4 gap-2 text-center">
                {([[countdown.d, "Días"], [countdown.h, "Horas"], [countdown.m, "Minutos"], [countdown.s, "Segundos"]] as const).map(([v, l], k) => (
                  <div key={l} className={`lp-cd relative overflow-hidden rounded-2xl py-2.5 text-white ${k === 3 ? "lp-cd-sec" : ""}`}>
                    {/* key con el valor: cada vez que cambia el número, entra girando. */}
                    <div key={v} className="lp-flip text-3xl font-black tabular-nums leading-none">{String(v).padStart(2, "0")}</div>
                    <div className="mt-1 text-[10px] font-bold uppercase tracking-wide opacity-80">{l}</div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {dims ? (
            <div {...E("product", "Opciones")} className="mt-5 space-y-3">
              {[0, 1].map((d) => (
                <div key={d}>
                  <p className="text-sm font-extrabold">{dims.labels[d]}: <span className="font-semibold text-slate-500">{dims.parts[sel]?.[d]}</span></p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {dims.values[d].map((v) => {
                      const want = d === 0 ? [v, dims.parts[sel]?.[1]] : [dims.parts[sel]?.[0], v];
                      let k = dims.parts.findIndex((p) => p[0] === want[0] && p[1] === want[1]);
                      if (k < 0) k = dims.parts.findIndex((p) => p[d] === v);
                      const out = k < 0 || (items[k].stock !== null && items[k].stock! <= 0);
                      const on = dims.parts[sel]?.[d] === v;
                      return <button key={v} type="button" disabled={out} onClick={() => setSel(k)} className={`lp-opt rounded-full border-2 px-3.5 py-1.5 text-sm font-bold transition ${on ? "lp-opt-on" : ""} ${out ? "opacity-40 line-through" : ""}`}>{v}</button>;
                    })}
                  </div>
                </div>
              ))}
            </div>
          ) : items.length > 1 ? (
            <div {...E("product", "Opciones")} className="mt-5">
              <p className="text-sm font-extrabold">{cfg.option_label}: <span className="font-semibold text-slate-500">{item.option}</span></p>
              <div className="mt-2 flex flex-wrap gap-2">
                {items.map((it, i) => {
                  const out = it.stock !== null && it.stock <= 0;
                  return (
                    <button key={it.id} type="button" disabled={out} onClick={() => setSel(i)}
                      className={`lp-opt rounded-full border-2 px-3.5 py-1.5 text-sm font-bold transition ${i === sel ? "lp-opt-on" : ""} ${out ? "opacity-40 line-through" : ""}`}>
                      {it.option}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}

          {cfg.size_guide_image ? <button type="button" onClick={() => setSizeGuide(true)} className="mt-3 text-sm font-bold underline" style={{ color: accent }}>📏 Ver guía de tallas</button> : null}
          {exitOn ? <p className="mt-4 rounded-2xl bg-emerald-50 p-3 text-center text-sm font-black text-emerald-700">🎁 Tienes {cfg.exit_offer.pct}% de descuento adicional en esta visita</p> : null}

          <button ref={heroCta} {...E("texts", "Botón de compra")} type="button" onClick={openSheet} disabled={soldOut} className="lp-cta lp-pulse mt-6 w-full rounded-2xl px-5 py-4 text-[17px] font-black uppercase text-white shadow-xl disabled:opacity-50">
            {soldOut ? "Agotado" : <span {...Fd("cta_text")}>{cfg.cta_text}</span>}
          </button>
          <div {...E("payments", "Formas de pago")}><PayBadges cfg={cfg} payments={data.payments} /></div>
          <div {...E("shipping", "Envío y entrega")}><Timeline delivery={delivery} /></div>
        </div>
      </section>
      </>
    ),
    benefits: (
      <>
      {cfg.benefits.length ? (
        <section className="lp-soft py-10">
          <div className="mx-auto grid max-w-6xl gap-3 px-4 sm:grid-cols-2 lg:grid-cols-4">
            {cfg.benefits.map((b, i) => (
              <div key={i} className="lp-card rounded-3xl bg-white p-5 shadow-sm">
                <div className="lp-icon-bubble grid h-14 w-14 place-items-center rounded-2xl text-3xl"><span className="lp-float" style={{ animationDelay: `${i * 0.35}s` }}>{b.icon}</span></div>
                <h3 {...Fd(`benefits.${i}.title`)} className="mt-3 font-black">{b.title}</h3><p {...Fd(`benefits.${i}.text`)} className="mt-1 text-sm leading-6 text-slate-600">{b.text}</p>
              </div>
            ))}
          </div>
        </section>
      ) : null}
      </>
    ),
    video: (
      <>
      <VideoBlock url={cfg.video_url || item.video_url || ""} title={productName} />
      </>
    ),
    stories: (
      <>
      {cfg.stories.map((s, i) => (
        <section key={i} className="mx-auto grid max-w-6xl items-center gap-6 px-4 py-10 md:grid-cols-2">
          {s.image ? <img src={s.image} alt={s.title} className={`w-full rounded-3xl object-cover shadow-lg ${i % 2 ? "md:order-2" : ""}`} loading="lazy" /> : null}
          <div className={s.image ? "" : "md:col-span-2 mx-auto max-w-2xl text-center"}>
            {s.title ? <h2 {...Fd(`stories.${i}.title`)} className="text-2xl font-black leading-tight sm:text-3xl">{s.title}</h2> : null}
            {s.text ? <p {...Fd(`stories.${i}.text`)} className="mt-3 whitespace-pre-line leading-7 text-slate-600">{s.text}</p> : null}
            <button type="button" onClick={openSheet} className="lp-cta mt-5 rounded-2xl px-6 py-3.5 font-black uppercase text-white">{cfg.cta_text}</button>
          </div>
        </section>
      ))}
      </>
    ),
    details: (
      <>
      {item.highlights?.length || item.description ? (
        <section className="mx-auto max-w-3xl px-4 py-10">
          <h2 className="text-center text-2xl font-black sm:text-3xl">¿Por qué te va a encantar?</h2>
          {item.description ? <p className="mx-auto mt-3 max-w-2xl whitespace-pre-line text-center leading-7 text-slate-600">{item.description}</p> : null}
          {item.highlights?.length ? (
            <ul className="mt-6 grid gap-2 sm:grid-cols-2">
              {item.highlights.map((h, i) => <li key={i} className="flex gap-3 rounded-2xl bg-slate-50 p-4 text-[15px]"><span className="lp-check grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-black text-white">✓</span>{h}</li>)}
            </ul>
          ) : null}
          {item.specifications?.length ? (
            <dl className="mt-6 grid gap-2 sm:grid-cols-2">
              {item.specifications.map((s, i) => <div key={i} className="rounded-2xl border border-slate-200 p-3"><dt className="text-[11px] font-bold uppercase tracking-wider text-slate-400">{s.name}</dt><dd className="font-bold">{s.value}</dd></div>)}
            </dl>
          ) : null}
        </section>
      ) : null}
      </>
    ),
    compare: (
      <>
      {cfg.compare_rows.length ? (
        <section className="mx-auto max-w-3xl px-4 py-10">
          <h2 className="text-center text-2xl font-black sm:text-3xl">¿Por qué elegirnos?</h2>
          <div className="mt-5 overflow-hidden rounded-3xl border border-slate-200">
            <div className="grid grid-cols-[1.3fr_1fr_1fr] bg-slate-900 text-center text-xs font-black uppercase text-white">
              <span className="p-3 text-left">&nbsp;</span><span className="lp-badge p-3">{data.store.name}</span><span className="p-3 opacity-70">Otros</span>
            </div>
            {cfg.compare_rows.map((r, i) => (
              <div key={i} className={`grid grid-cols-[1.3fr_1fr_1fr] text-center text-sm ${i % 2 ? "bg-slate-50" : "bg-white"}`}>
                <span className="p-3 text-left font-bold">{r.label}</span>
                <span className="p-3 font-black" style={{ color: accent }}>{r.us || "✅"}</span>
                <span className="p-3 text-slate-400">{r.them || "❌"}</span>
              </div>
            ))}
          </div>
        </section>
      ) : null}
      </>
    ),
    testimonials: (
      <>
      {cfg.testimonials.length ? (
        <section className="lp-soft py-10">
          <div className="mx-auto max-w-6xl px-4">
            <h2 className="text-center text-2xl font-black sm:text-3xl">Lo que dicen nuestros clientes</h2>
            <div className="mt-6 grid gap-3 md:grid-cols-3">
              {cfg.testimonials.map((t, i) => (
                <figure key={i} className="overflow-hidden rounded-3xl bg-white shadow-sm">
                  {/* Foto de la opinión, grande: se toca para verla completa. */}
                  {t.image ? (
                    <button type="button" onClick={() => setZoom(t.image)} className="group relative block w-full overflow-hidden bg-slate-100" style={{ aspectRatio: "4 / 3" }} aria-label={`Ver foto de ${t.name || "cliente"}`}>
                      <img src={t.image} alt={`Foto de ${t.name || "cliente"}`} className="h-full w-full object-cover transition duration-300 group-hover:scale-105" loading="lazy" />
                      <span className="absolute bottom-2 right-2 rounded-full bg-black/55 px-2.5 py-1 text-[11px] font-bold text-white">🔍 Ver</span>
                    </button>
                  ) : null}
                  <div className="p-5">
                    <div className="text-lg text-amber-400">{"★".repeat(t.stars)}<span className="text-slate-200">{"★".repeat(5 - t.stars)}</span></div>
                    <blockquote className="mt-2 text-[15px] leading-6">“<span {...Fd(`testimonials.${i}.text`)}>{t.text}</span>”</blockquote>
                    <figcaption className="mt-4 flex items-center gap-3 text-sm font-bold">
                      {t.image ? <img src={t.image} alt="" className="h-12 w-12 rounded-full object-cover ring-2 ring-white shadow" loading="lazy" /> : <span className="lp-chip grid h-12 w-12 place-items-center rounded-full text-lg">{(t.name || "C").slice(0, 1)}</span>}
                      <span className="leading-5">{t.name || "Cliente"}{t.city ? <span className="block text-xs font-medium text-slate-400">📍 {t.city}</span> : null}</span>
                    </figcaption>
                  </div>
                </figure>
              ))}
            </div>
          </div>
        </section>
      ) : null}
      </>
    ),
    final_cta: renderCta("final"),
    trust: (
      <>
      {cfg.trust.enabled ? <TrustBlock trust={data.trust ?? null} cfg={cfg} payments={data.payments} storeName={data.store.name} /> : null}
      </>
    ),
    guarantees: (
      <>
      {cfg.guarantees.length ? (
        <section className="bg-slate-900 py-8 text-white">
          <div className="mx-auto grid max-w-6xl gap-4 px-4 text-center sm:grid-cols-3">
            {cfg.guarantees.map((g, i) => <div key={i}><div className="lp-float text-3xl" style={{ animationDelay: `${i * 0.4}s` }}>{["🏅", "🔒", "🚚", "🔁", "💬", "⭐"][i % 6]}</div><p className="mt-1 text-sm font-black uppercase tracking-wide">{g}</p></div>)}
          </div>
        </section>
      ) : null}
      </>
    ),
    faq: (
      <>
      {cfg.faqs.length ? (
        <section className="mx-auto max-w-3xl px-4 py-10">
          <h2 className="text-center text-2xl font-black sm:text-3xl">Preguntas frecuentes</h2>
          <div className="mt-5 space-y-2">
            {cfg.faqs.map((f, i) => (
              <details key={i} className="lp-faq group rounded-2xl border border-slate-200 p-4">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 font-bold"><span {...Fd(`faqs.${i}.q`)}>{f.q}</span><span className="text-xl transition group-open:rotate-45" style={{ color: accent }}>+</span></summary>
                <p {...Fd(`faqs.${i}.a`)} className="mt-2 whitespace-pre-line text-[15px] leading-6 text-slate-600">{f.a}</p>
              </details>
            ))}
          </div>
        </section>
      ) : null}
      </>
    ),
    poster: (
      <>
      {cfg.poster_images.length ? (
        <section className="mx-auto max-w-3xl pb-6 sm:px-4">
          {cfg.poster_title ? <h2 className="px-4 py-4 text-center text-2xl font-black sm:text-3xl">{cfg.poster_title}</h2> : null}
          {cfg.poster_images.map((src, i) => (
            <Fragment key={src + i}>
              <img src={src} alt={i ? "" : productName} className="block w-full sm:rounded-3xl" loading={i ? "lazy" : "eager"} />
              {(cfg.poster_cta_every > 0 && (i + 1) % cfg.poster_cta_every === 0) || i === cfg.poster_images.length - 1 ? (
                <div className="px-4 py-3"><button type="button" onClick={openSheet} disabled={soldOut} className="lp-cta lp-pulse w-full rounded-2xl px-5 py-4 text-[16px] font-black uppercase text-white">{cfg.cta_text}</button></div>
              ) : null}
            </Fragment>
          ))}
        </section>
      ) : null}
      </>
    ),
  };

  return (
    <div ref={rootRef} className={`lp-root lp-font-${cfg.font} lp-fx-${cfg.effects} ${editMode ? "lp-edit" : ""} min-h-screen bg-white text-slate-900`} style={vars}>
      <style>{LP_CSS}</style>
      {/* Barra superior */}
      <div {...E("design", "Barra de arriba")} className="lp-topbar sticky top-0 z-30 px-4 py-2 text-center text-[12px] font-extrabold uppercase tracking-wide text-white sm:text-[13px]">
        {countdown ? <>⏰ {cfg.promo_text.length < 50 ? cfg.promo_text : "La promo termina en"} · {countdown.d > 0 ? `${countdown.d}d ` : ""}{String(countdown.h).padStart(2, "0")}:{String(countdown.m).padStart(2, "0")}:{String(countdown.s).padStart(2, "0")}</>
          : cfg.topbar_text ? <span {...Fd("topbar_text")}>{cfg.topbar_text}</span> : <>🚚 {cfg.shipping.text || "Envíos a toda Colombia"}{cfg.payments.cod && data.payments.cod ? " · 💵 Paga al recibir" : ""}</>}
      </div>

      <header className="mx-auto flex max-w-6xl items-center justify-center gap-2 px-4 py-3">
        {data.store.logo_url ? <img src={data.store.logo_url} alt={data.store.name} className="h-9 w-auto max-w-40 object-contain" /> : <span className="text-lg font-black tracking-tight">{data.store.name}</span>}
      </header>

      {(() => {
        // Solo las secciones que de verdad muestran algo (para no repetir el llamado entre secciones vacías).
        const has: Record<SectionKey, boolean> = {
          hero: true, poster: cfg.poster_images.length > 0, benefits: cfg.benefits.length > 0, video: Boolean(cfg.video_url || item.video_url),
          stories: cfg.stories.length > 0, details: Boolean(item.highlights?.length || item.description), compare: cfg.compare_rows.length > 0,
          testimonials: cfg.testimonials.length > 0, trust: cfg.trust.enabled, final_cta: true, guarantees: cfg.guarantees.length > 0, faq: cfg.faqs.length > 0,
        };
        const visible = cfg.sections.filter((x) => x.on && has[x.key]);
        let content = 0;
        return visible.map((x, i) => {
          const isContent = x.key !== "hero" && x.key !== "final_cta";
          if (isContent) content++;
          const next = visible[i + 1]?.key;
          const repeat = isContent && next && next !== "final_cta"
            && (cb.repeat === "every" ? content % cb.every === 0 : cb.repeat === "after" ? cb.after.includes(x.key) : false);
          // El héroe ya marca cada parte por dentro; las demás secciones se marcan completas.
          const body = x.key === "hero" ? blocks[x.key] : <div data-reveal {...E(SECTION_EDIT[x.key][0], SECTION_EDIT[x.key][1])}>{blocks[x.key]}</div>;
          return <Fragment key={x.key}>{body}{repeat ? renderCta(`cta-${x.key}`) : null}</Fragment>;
        });
      })()}

      <footer {...E("whatsapp", "Políticas")} className="border-t border-slate-100 px-4 pb-28 pt-6 text-center text-xs text-slate-400">
        <p className="font-bold text-slate-500">{data.store.name}</p>
        <button type="button" onClick={() => setPolicy(true)} className="mt-2 underline">Términos, cambios, retracto y datos personales</button>
      </footer>

      {/* Barra fija para comprar (celular) */}
      <div {...E("design", "Barra fija de abajo")} className={`lp-sticky fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur transition-transform ${showSticky && !sheet ? "translate-y-0" : "translate-y-full"}`}
        style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}>
        <div className="mx-auto flex max-w-3xl items-center gap-3">
          {/* Foto real del producto (la de la opción elegida), pequeña, para que sepa qué está comprando. */}
          <StickyThumb images={productPhotos} name={productName} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-bold text-slate-500">{items.length > 1 ? `${data.page.name} · ${item.option}` : productName}</p>
            <p className="flex items-baseline gap-2">
              <span className="text-lg font-black" style={{ color: accent }}>{priceText}</span>
              {compare ? <span className="text-xs font-semibold text-slate-400 line-through">{money(compare)}</span> : null}
            </p>
          </div>
          <button type="button" onClick={openSheet} disabled={soldOut} className="lp-cta rounded-2xl px-5 py-3 text-sm font-black uppercase text-white"><span {...Fd("sticky_text")}>{cfg.sticky_text}</span></button>
        </div>
      </div>

      {cfg.whatsapp_button && wa ? (
        <a href={`https://wa.me/${wa}?text=${encodeURIComponent(`${cfg.whatsapp_text} ${productName}`.trim())}`} target="_blank" rel="noopener noreferrer"
          onClick={() => { if (!preview) { ping("whatsapp"); track.contact("whatsapp", data.store.slug); landingPixelEvent("Contact", {}); } }}
          {...E("whatsapp", "Botón de WhatsApp")}
          className={`fixed right-4 z-40 grid h-14 w-14 place-items-center rounded-full bg-[#25d366] text-3xl text-white shadow-2xl transition-all ${showSticky ? "bottom-24" : "bottom-5"}`} aria-label="Escribir por WhatsApp">
          <svg viewBox="0 0 32 32" width="30" height="30" fill="currentColor" aria-hidden><path d="M16 3C9 3 3.3 8.6 3.3 15.6c0 2.5.7 4.8 1.9 6.8L3 29l6.8-2.1c1.9 1 4 1.6 6.2 1.6 7 0 12.7-5.6 12.7-12.6S23 3 16 3zm0 23.1c-2 0-3.9-.6-5.5-1.6l-.4-.2-4 1.2 1.3-3.9-.3-.4c-1.1-1.7-1.7-3.6-1.7-5.6C5.4 9.8 10.2 5.1 16 5.1s10.6 4.7 10.6 10.5S21.8 26.1 16 26.1zm5.8-7.8c-.3-.2-1.9-.9-2.2-1-.3-.1-.5-.2-.7.2-.2.3-.8 1-1 1.2-.2.2-.4.2-.7.1-.3-.2-1.3-.5-2.5-1.5-.9-.8-1.5-1.8-1.7-2.1-.2-.3 0-.5.1-.6l.5-.6c.2-.2.2-.3.3-.6.1-.2 0-.4 0-.6l-1-2.4c-.3-.6-.5-.5-.7-.5h-.6c-.2 0-.6.1-.9.4-.3.3-1.2 1.1-1.2 2.8s1.2 3.2 1.4 3.5c.2.2 2.4 3.7 5.8 5.1 2.9 1.1 3.4.9 4.1.8.6-.1 1.9-.8 2.2-1.5.3-.8.3-1.4.2-1.5-.1-.2-.3-.3-.6-.4z" /></svg>
        </a>
      ) : null}

      {cfg.urgency.recent_orders ? <div {...E("urgency", "Avisos de pedidos")}><RecentToast recent={social.recent} hidden={sheet} preview={preview} every={cfg.urgency.recent_every} /></div> : null}
      {sheet ? <OrderSheet data={data} cfg={cfg} startIdx={sel} preview={preview} exit={exitOn} onClose={() => setSheet(false)} session={session} refInfo={ref} metrics={metrics} ping={ping} /> : null}
      {zoom ? createPortal(
        <div className="lp-portal fixed inset-0 z-70 grid place-items-center bg-black/85 p-4" onClick={() => setZoom(null)} role="dialog" aria-modal="true" aria-label="Foto de la opinión">
          <img src={zoom} alt="Foto de la opinión" className="lp-pop max-h-[88vh] max-w-full rounded-2xl object-contain shadow-2xl" />
          <button type="button" onClick={() => setZoom(null)} className="absolute right-4 top-4 grid h-11 w-11 place-items-center rounded-full bg-white text-xl font-bold text-slate-900" aria-label="Cerrar">×</button>
        </div>, document.body) : null}
      {sizeGuide ? (
        <Overlay onClose={() => setSizeGuide(false)} title="Guía de tallas">
          <img src={cfg.size_guide_image} alt="Guía de tallas" className="w-full rounded-2xl" />
        </Overlay>
      ) : null}
      {exitAsk && !sheet ? createPortal(
        <div className="lp-portal fixed inset-0 z-70 grid place-items-center bg-black/70 p-4" onClick={() => setExitAsk(false)}>
          <div {...E("exit", "Oferta de salida")} className="lp-pop w-full max-w-sm overflow-hidden rounded-3xl bg-white text-center text-slate-900 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="lp-topbar px-4 py-3 text-sm font-black uppercase text-white">{cfg.exit_offer.title}</div>
            <div className="p-6">
              {images[0] ? <img src={images[0]} alt={productName} className="mx-auto h-36 w-36 rounded-2xl object-cover" /> : null}
              <p className="mt-3 text-5xl font-black" style={{ color: accent }}>-{cfg.exit_offer.pct}%</p>
              <p className="text-sm font-bold uppercase text-slate-500">adicional</p>
              <p className="mt-2 text-sm text-slate-600">{cfg.exit_offer.text}</p>
              <button type="button" onClick={() => { setExitAsk(false); setExitOn(true); openSheet(); }} className="lp-cta lp-pulse mt-5 w-full rounded-2xl px-4 py-3.5 font-black uppercase text-white">¡Lo quiero con descuento!</button>
              <button type="button" onClick={() => setExitAsk(false)} className="mt-2 w-full py-2 text-sm font-semibold text-slate-500 underline">No, gracias</button>
            </div>
          </div>
        </div>, document.body) : null}
      {policy ? (
        <Overlay onClose={() => setPolicy(false)} title="Términos y políticas">
          <p className="whitespace-pre-line text-sm leading-6 text-slate-600">{[cfg.policies, DEFAULT_POLICY].filter(Boolean).join("\n\n")}</p>
        </Overlay>
      ) : null}
    </div>
  );
}

/** Foto pequeña de la barra fija: la principal del producto y, si hay varias, van pasando solas. */
function StickyThumb({ images, name }: { images: string[]; name: string }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setI(0);
    if (images.length < 2 || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const t = window.setInterval(() => setI((x) => (x + 1) % images.length), 2500);
    return () => window.clearInterval(t);
  }, [images]);
  if (!images.length) return null;
  return (
    <span className="relative h-14 w-14 shrink-0 overflow-hidden rounded-xl bg-slate-100 shadow-sm ring-1 ring-slate-200">
      {images.map((src, k) => (
        <img key={src} src={src} alt={k === i ? name : ""} loading="lazy"
          className="absolute inset-0 h-full w-full object-cover transition-opacity duration-700" style={{ opacity: k === i ? 1 : 0 }} />
      ))}
      {images.length > 1 ? (
        <span className="absolute inset-x-0 bottom-0.5 flex justify-center gap-0.5">
          {images.map((src, k) => <span key={src} className="h-1 w-1 rounded-full" style={{ background: k === i ? "#fff" : "rgba(255,255,255,.5)" }} />)}
        </span>
      ) : null}
    </span>
  );
}

function VideoBlock({ url, title }: { url: string; title: string }) {
  if (!/^https:\/\//.test(url)) return null;
  const yt = getYoutubeEmbedUrl(url);
  const direct = /\.(mp4|webm|mov)(\?|#|$)/i.test(url);
  if (!yt && !direct) return null;
  return (
    <section className="mx-auto max-w-3xl px-4 py-10">
      <h2 className="text-center text-2xl font-black sm:text-3xl">Míralo en video 🎬</h2>
      <div className="mt-5 overflow-hidden rounded-3xl bg-black shadow-xl" style={{ aspectRatio: yt ? "16 / 9" : "9 / 16", maxHeight: "80vh", marginInline: "auto" }}>
        {yt ? <iframe src={yt} title={title} className="h-full w-full" allow="accelerometer; autoplay; encrypted-media; picture-in-picture" allowFullScreen loading="lazy" />
          : <video src={url} className="h-full w-full object-contain" controls playsInline muted autoPlay loop preload="metadata" />}
      </div>
    </section>
  );
}

function Gallery({ images, name, badge }: { images: string[]; name: string; badge: string }) {
  const [i, setI] = useState(0);
  const touch = useRef<number | null>(null);
  const idx = Math.min(i, Math.max(0, images.length - 1));
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setI(0); }, [images]);
  const go = (d: number) => images.length && setI((x) => (x + d + images.length) % images.length);
  return (
    <div className="min-w-0">
      <div className="relative overflow-hidden rounded-3xl bg-slate-100" style={{ aspectRatio: "4 / 5" }}
        onTouchStart={(e) => { touch.current = e.touches[0].clientX; }}
        onTouchEnd={(e) => { if (touch.current === null) return; const dx = e.changedTouches[0].clientX - touch.current; if (Math.abs(dx) > 40) go(dx < 0 ? 1 : -1); touch.current = null; }}>
        {images[idx] ? <img src={images[idx]} alt={name} className="h-full w-full object-cover" /> : <div className="grid h-full place-items-center text-6xl">🛍️</div>}
        {badge ? <span className="lp-badge lp-wobble absolute left-3 top-3 rounded-full px-3 py-1 text-sm font-black text-white shadow-lg">{badge}</span> : null}
        {images.length > 1 ? (
          <>
            <button type="button" onClick={() => go(-1)} className="absolute left-2 top-1/2 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-full bg-white/90 text-xl font-black shadow" aria-label="Foto anterior">‹</button>
            <button type="button" onClick={() => go(1)} className="absolute right-2 top-1/2 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-full bg-white/90 text-xl font-black shadow" aria-label="Foto siguiente">›</button>
            <span className="absolute bottom-3 right-3 rounded-full bg-black/60 px-2.5 py-0.5 text-xs font-bold text-white">{idx + 1}/{images.length}</span>
          </>
        ) : null}
      </div>
      {images.length > 1 ? (
        <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
          {images.map((src, k) => (
            <button key={src + k} type="button" onClick={() => setI(k)} className={`h-16 w-14 shrink-0 overflow-hidden rounded-xl border-2 ${k === idx ? "lp-thumb-on" : "border-transparent opacity-70"}`}>
              <img src={src} alt="" className="h-full w-full object-cover" loading="lazy" />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

const SOCIAL: Record<string, string> = { instagram: "📸 Instagram", facebook: "📘 Facebook", tiktok: "🎵 TikTok", youtube: "▶️ YouTube" };

/** «Compra con confianza»: solo datos reales de la tienda. */
function TrustBlock({ trust, cfg, payments, storeName }: { trust: LandingTrust | null; cfg: ReturnType<typeof normalizeLanding>; payments: LandingData["payments"]; storeName: string }) {
  const rows: Array<[string, ReactNode]> = [];
  const t = cfg.trust;
  if (trust && t.business && (trust.business_name || trust.nit)) rows.push(["🏢", <><b>{trust.business_name || storeName}</b>{trust.nit ? <> · NIT {trust.nit}</> : null}<span className="block text-slate-500">Empresa colombiana registrada</span></>]);
  if (trust && t.points && trust.points.length) rows.push(["📍", <><b>{trust.points.length === 1 ? "Tienda física" : "Tiendas físicas"}</b>{trust.points.map((p, i) => <span key={i} className="block text-slate-500">{p.name}{p.address ? ` · ${p.address}` : ""}{p.city ? `, ${p.city}` : ""}</span>)}</>]);
  if (trust && t.orders && trust.orders_done >= 20) rows.push(["📦", <><b>Más de {(Math.floor(trust.orders_done / 10) * 10).toLocaleString("es-CO")} pedidos entregados</b>{trust.since ? <span className="block text-slate-500">Vendiendo desde {trust.since}</span> : null}</>]);
  else if (trust && t.orders && trust.since) rows.push(["📅", <b key="since">Vendiendo desde {trust.since}</b>]);
  if (payments.cod && cfg.payments.cod) rows.push(["💵", <><b>Pagas cuando lo recibes</b><span className="block text-slate-500">No pagas nada por adelantado</span></>]);
  if (payments.online || payments.addi) rows.push(["🔒", <><b>Pagos protegidos</b><span className="block text-slate-500">{[payments.online ? "Wompi (Grupo Bancolombia)" : "", payments.addi ? "Addi" : ""].filter(Boolean).join(" y ")}: nunca vemos los datos de tu tarjeta</span></>]);
  rows.push(["⚖️", <><b>Compra protegida por la ley</b><span className="block text-slate-500">Tienes 5 días hábiles de retracto (Ley 1480 de 2011)</span></>]);
  const links = trust && t.links ? trust.links.filter((l) => SOCIAL[l.type]) : [];
  return (
    <section className="mx-auto max-w-3xl px-4 py-10">
      <h2 className="text-center text-2xl font-black sm:text-3xl">Compra con confianza 🤝</h2>
      <div className="mt-5 grid gap-2 sm:grid-cols-2">
        {rows.map(([icon, body], i) => (
          <div key={i} className="flex gap-3 rounded-2xl border border-slate-200 p-4 text-[14px] leading-5">
            <span className="lp-chip grid h-10 w-10 shrink-0 place-items-center rounded-full text-xl">{icon}</span>
            <p>{body}</p>
          </div>
        ))}
      </div>
      {links.length ? (
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          {links.map((l) => <a key={l.url} href={l.url} target="_blank" rel="noopener noreferrer" className="rounded-full border border-slate-200 px-4 py-2 text-sm font-bold">{SOCIAL[l.type]}</a>)}
        </div>
      ) : null}
    </section>
  );
}

function Urgency({ social, cfg, lowStock, stock }: { social: LandingSocial; cfg: ReturnType<typeof normalizeLanding>; lowStock: boolean; stock: number | null }) {
  const rows: ReactNode[] = [];
  // Existencias: barra que se va vaciando (real: cuánto queda frente al tope de «quedan pocas»).
  if (lowStock && stock !== null) {
    const pct = Math.max(6, Math.min(100, (stock / Math.max(1, cfg.urgency.low_stock_at)) * 100));
    rows.push(
      <div key="s" className="lp-urg rounded-2xl bg-red-50 px-3 py-2 text-red-700 ring-1 ring-red-200">
        <div className="flex items-center gap-2"><span className="lp-flame text-lg" aria-hidden>🔥</span>¡Solo quedan <span key={stock} className="lp-num text-base">{stock}</span> unidades!</div>
        <div className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-red-100"><div className="lp-stockbar h-full rounded-full" style={{ width: `${pct}%` }} /></div>
      </div>,
    );
  }
  const vw = VIEWERS_WINDOWS[cfg.urgency.viewers_window];
  if (cfg.urgency.live_viewers && social.live >= Math.max(1, cfg.urgency.viewers_min)) {
    rows.push(
      <div key="l" className="lp-urg inline-flex items-center gap-2 rounded-2xl bg-slate-50 px-3 py-2 ring-1 ring-slate-200">
        <span className="lp-eye text-lg" aria-hidden>👁️</span>
        <span key={social.live} className="lp-num tabular-nums text-base" style={{ color: "var(--lp-accent)" }}>{social.live.toLocaleString("es-CO")}</span> {vw.text}
        {cfg.urgency.viewers_window === "now" ? <span className="lp-dot ml-auto inline-block h-2.5 w-2.5 rounded-full bg-red-500" /> : null}
      </div>,
    );
  }
  if (cfg.urgency.sold_week && social.sold_week >= 3) {
    rows.push(
      <div key="w" className="lp-urg inline-flex items-center gap-2 rounded-2xl bg-emerald-50 px-3 py-2 text-emerald-800 ring-1 ring-emerald-200">
        <span className="lp-hop text-lg" aria-hidden>🛍️</span>
        <span key={social.sold_week} className="lp-num tabular-nums text-base">{social.sold_week.toLocaleString("es-CO")}</span> {SOLD_WINDOWS[cfg.urgency.sold_window].text}
        <span className="lp-spark ml-auto" aria-hidden>📈</span>
      </div>,
    );
  }
  if (!rows.length) return null;
  return <div className="mt-4 flex flex-col gap-2 text-sm font-extrabold">{rows}</div>;
}

function PayBadges({ cfg, payments }: { cfg: ReturnType<typeof normalizeLanding>; payments: LandingData["payments"] }) {
  const list = [
    payments.cod && cfg.payments.cod ? "💵 Paga al recibir" : null,
    payments.online ? `💳 En línea${cfg.payments.online_pct > 0 ? ` −${cfg.payments.online_pct}%` : ""}` : null,
    payments.addi ? "🗓️ Cuotas con Addi" : null,
    "🔒 Compra segura",
  ].filter(Boolean);
  return <div className="mt-3 flex flex-wrap justify-center gap-2 text-[12px] font-bold text-slate-600">{list.map((x) => <span key={x} className="rounded-full bg-slate-100 px-3 py-1">{x}</span>)}</div>;
}

function Timeline({ delivery }: { delivery: ReturnType<typeof deliveryWindow> }) {
  const steps = [["🛒", "Pedido", DAY.format(delivery.today)], ["📦", "Despacho", DAY.format(delivery.dispatch)], ["🏠", "Entrega", `${DAY.format(delivery.from)} – ${DAY.format(delivery.to)}`]];
  return (
    <div className="mt-5 grid grid-cols-3 gap-1 rounded-3xl border border-slate-200 p-3 text-center">
      {steps.map(([icon, label, date], k) => (
        <div key={label} className="relative">
          {k ? <span className="absolute -left-1 top-4 h-0.5 w-3 bg-slate-200" /> : null}
          <div className="lp-chip mx-auto grid h-10 w-10 place-items-center rounded-full text-lg"><span className="lp-hop" style={{ animationDelay: `${k * 0.5}s` }}>{icon}</span></div>
          <p className="mt-1 text-[11px] font-black uppercase">{label}</p>
          <p className="text-[11px] capitalize text-slate-500">{date}</p>
        </div>
      ))}
    </div>
  );
}

function RecentToast({ recent, hidden, preview, every }: { recent: LandingSocial["recent"]; hidden: boolean; preview: boolean; every: number }) {
  const [k, setK] = useState(-1);
  useEffect(() => {
    if (!recent.length) return;
    let n = 0;
    const show = () => { setK(n % recent.length); n++; window.setTimeout(() => setK(-1), 5500); };
    const first = window.setTimeout(show, 6000);
    const t = window.setInterval(show, Math.max(8, every) * 1000);
    return () => { window.clearTimeout(first); window.clearInterval(t); };
  }, [recent, every]);
  const r = k >= 0 ? recent[k] : null;
  if (!r || hidden) return null;
  return (
    <div className="lp-toast fixed bottom-24 left-3 z-40 flex max-w-72 items-center gap-3 rounded-2xl bg-white p-3 pr-4 shadow-2xl ring-1 ring-slate-200 sm:bottom-6">
      <span className="lp-chip grid h-10 w-10 shrink-0 place-items-center rounded-full text-xl">🛍️</span>
      <p className="text-[13px] leading-5"><b>{r.name}</b>{r.city ? ` de ${r.city}` : ""} pidió {r.units > 1 ? `${r.units} unidades` : "el suyo"}<br /><span className="text-xs text-slate-400">{ago(r.minutes)} · {preview ? "ejemplo" : "pedido real"}</span></p>
    </div>
  );
}

function Overlay({ title, onClose, children, wide = false }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", esc);
    return () => { document.body.style.overflow = prev; window.removeEventListener("keydown", esc); };
  }, [onClose]);
  return createPortal(
    <div className="lp-portal fixed inset-0 z-60 flex items-end justify-center bg-black/55 sm:items-center sm:p-4" onClick={onClose}>
      <div className={`lp-sheet max-h-[94vh] w-full overflow-y-auto rounded-t-3xl bg-white text-slate-900 shadow-2xl sm:rounded-3xl ${wide ? "sm:max-w-xl" : "sm:max-w-lg"}`} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={title}>
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-100 bg-white px-5 py-3">
          <h2 className="text-base font-black">{title}</h2>
          <button type="button" onClick={onClose} className="grid h-9 w-9 place-items-center rounded-full bg-slate-100 text-lg font-bold" aria-label="Cerrar">×</button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

type Done = { receipt_no: string | null; total: number; payment: LandingPayment; waUrl: string | null };

const PAY_LABEL: Record<LandingPayment, string> = { cod: "Contraentrega (pago al recibir)", online: "En línea (tarjeta, PSE o Nequi)", addi: "A cuotas con Addi" };

/**
 * Mensaje que el cliente le manda a la tienda por WhatsApp con todo el pedido.
 * Sin emojis: WhatsApp en computador los cambia por «�» cuando el texto llega desde un enlace.
 * El enlace del final es del pedido para el equipo: su vista previa muestra el logo del punto o de la tienda,
 * y al abrirlo lleva a Pedidos (solo con sesión y permiso; el cliente no ve el pedido).
 */
function orderWhatsAppText(o: {
  page: string; receipt: string | null; items: Array<{ name: string; price: number; quantity: number }>; total: number; payment: LandingPayment; freeShipping: boolean;
  customer: { name: string; whatsapp: string; email: string; document: string; department: string; city: string; address: string; neighborhood: string; notes: string };
  storeSlug: string; catalog: string;
}) {
  const c = o.customer;
  // En el subdominio de la tienda la ruta va sin el nombre; en remhub.co va con él.
  const prefix = window.location.pathname.startsWith(`/${o.storeSlug}/`) ? `/${o.storeSlug}` : "";
  const link = o.receipt ? `${window.location.origin}${prefix}/orden/${o.receipt}${o.catalog ? `?c=${encodeURIComponent(o.catalog)}` : ""}` : "";
  const lines = [
    `*NUEVO PEDIDO${o.receipt ? ` #${o.receipt}` : ""}*`,
    o.page,
    "",
    `*Cliente:* ${c.name.trim()}`,
    `*WhatsApp:* ${c.whatsapp.replace(/\D/g, "")}`,
    c.document.trim() ? `*Cédula:* ${c.document.trim()}` : "",
    c.email.trim() ? `*Correo:* ${c.email.trim()}` : "",
    "",
    "*Pedido:*",
    ...o.items.map((i) => `- ${i.quantity} x ${i.name} - ${money(i.price)}${i.quantity > 1 ? " c/u" : ""}`),
    "",
    `*Total: ${money(o.total)}*`,
    `*Pago:* ${PAY_LABEL[o.payment]}`,
    `*Envío:* ${o.freeShipping ? "GRATIS" : "por confirmar"}`,
    "",
    `*Dirección:* ${c.address.trim()}${c.neighborhood.trim() ? `, barrio ${c.neighborhood.trim()}` : ""}`,
    `*Ciudad:* ${c.city.trim()}, ${c.department}`,
    c.notes.trim() ? `*Indicaciones:* ${c.notes.trim()}` : "",
    "",
    "Quiero confirmar mi pedido.",
    link ? `\nPara la tienda: ${link}` : "",
  ];
  return lines.filter((l, k, a) => l !== "" || (k > 0 && a[k - 1] !== "")).join("\n").trim();
}

function OrderSheet({ data, cfg, startIdx, preview, exit, onClose, session, refInfo, metrics, ping }: {
  data: LandingData; cfg: ReturnType<typeof normalizeLanding>; startIdx: number; preview: boolean; exit: boolean; onClose: () => void;
  session: React.RefObject<string>; refInfo: React.RefObject<LandingRef>; metrics: React.RefObject<{ scroll: number; start: number; cta: number; started: boolean }>; ping: (e: string) => void;
}) {
  const items = data.items;
  const avail = items.filter((i) => i.stock === null || i.stock > 0);
  const first = (items[startIdx] && (items[startIdx].stock === null || items[startIdx].stock! > 0) ? items[startIdx] : avail[0])?.id ?? items[0].id;
  const bundles = cfg.bundles;
  const [tier, setTier] = useState(Math.max(0, bundles.findIndex((b) => b.highlight)));
  const [units, setUnits] = useState<string[]>(() => Array.from({ length: 10 }, () => first));
  const payOptions = ([["cod", data.payments.cod && cfg.payments.cod], ["online", data.payments.online], ["addi", data.payments.addi]] as const).filter(([, on]) => on).map(([k]) => k as LandingPayment);
  const [payment, setPayment] = useState<LandingPayment>(payOptions[0] ?? "cod");
  const [f, setF] = useState({ name: "", whatsapp: "", email: "", document: "", department: "", city: "", address: "", neighborhood: "", notes: "", confirm: !cfg.form.confirm_address });
  const [err, setErr] = useState<{ field?: string; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [upsellAsk, setUpsellAsk] = useState(false);
  // Si tocan afuera, la X o Esc: se pregunta antes de cerrar (que no pierdan el pedido por un toque sin querer).
  const [askLeave, setAskLeave] = useState(false);
  const [done, setDone] = useState<Done | null>(null);
  const leadSent = useRef("");
  const dimsSheet = optionDims(items.map((i) => i.option), cfg.option_label);
  const b: LandingBundle = bundles[Math.min(tier, bundles.length - 1)] ?? { qty: 1, pct: 0, label: "1", highlight: false };
  const chosen = units.slice(0, b.qty);
  const priceOf = (id: string) => items.find((i) => i.id === id)?.price ?? 0;
  const online = payment === "online" ? cfg.payments.online_pct : 0;
  const subtotal = chosen.reduce((s, id) => s + priceOf(id), 0);
  const xpct = exit && cfg.exit_offer.enabled ? cfg.exit_offer.pct : 0;
  const total = chosen.reduce((s, id) => s + discounted(priceOf(id), b.pct, xpct, online), 0);
  const upsell = cfg.upsell.enabled && data.upsell && (data.upsell.stock === null || data.upsell.stock > 0) ? data.upsell : null;
  const upsellPrice = upsell ? discounted(upsell.price, cfg.upsell.pct, online) : 0;
  const set = (k: keyof typeof f, v: string | boolean) => {
    setF((x) => ({ ...x, [k]: v }));
    if (err?.field === k) setErr(null);
    if (!metrics.current.started && typeof v === "string" && v.trim()) {
      metrics.current.started = true;
      if (!preview) {
        ping("started");
        const items4 = chosen.map((id) => ({ id, name: items.find((i) => i.id === id)?.name ?? "", price: discounted(priceOf(id), b.pct, online), quantity: 1 }));
        track.beginCheckout(items4, data.store.slug);
        landingPixelEvent("InitiateCheckout", { content_ids: chosen, content_type: "product", value: total, currency: "COP", num_items: b.qty });
      }
    }
  };

  // Cliente por recuperar: en cuanto el WhatsApp queda completo.
  useEffect(() => {
    const wa = f.whatsapp.replace(/\D/g, "").replace(/^57(?=3\d{9}$)/, "");
    if (preview || !/^3\d{9}$/.test(wa) || leadSent.current === wa) return;
    leadSent.current = wa;
    const selection = `${b.qty} × ${chosen.map((id) => items.find((i) => i.id === id)?.option).join(", ")}`;
    void supabaseBrowser().rpc("landing_lead", { p_store: data.store.slug, p_slug: data.page.slug, p_session: session.current, p: { name: f.name, whatsapp: wa, city: f.city, selection } }).then(() => undefined, () => undefined);
  }, [f.whatsapp, f.name, f.city, preview, b.qty, chosen, items, data.store.slug, data.page.slug, session]);

  function check(): boolean {
    const wa = f.whatsapp.replace(/\D/g, "").replace(/^57(?=3\d{9}$)/, "");
    const fail = (field: string, message: string) => { setErr({ field, message }); document.getElementById(`lp-${field}`)?.focus(); return false; };
    if (f.name.trim().split(/\s+/).length < 2) return fail("name", "Escribe tu nombre y apellido.");
    if (!/^3\d{9}$/.test(wa)) return fail("whatsapp", "Escribe un WhatsApp de 10 dígitos que empiece por 3.");
    if (cfg.form.ask_email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email.trim())) return fail("email", "Escribe tu correo.");
    if (cfg.form.ask_document && f.document.replace(/\D/g, "").length < 5) return fail("document", "Escribe tu número de cédula.");
    if (!f.department) return fail("department", "Elige tu departamento.");
    if (f.city.trim().length < 2) return fail("city", "Escribe tu ciudad o municipio.");
    if (f.address.trim().length < 5) return fail("address", "Escribe la dirección completa.");
    if (!f.confirm) return fail("confirm", "Confirma que la dirección es correcta.");
    return true;
  }

  function submit() {
    if (!check()) return;
    if (upsell && !upsellAsk) { setUpsellAsk(true); return; }
    void send(false);
  }

  async function send(takeUpsell: boolean) {
    setUpsellAsk(false);
    if (preview) { setErr({ message: "Vista previa: aquí se crearía el pedido. Publica la landing para recibir pedidos reales." }); return; }
    setBusy(true);
    setErr(null);
    // WhatsApp se abre ya, con el toque (los navegadores bloquean ventanas abiertas después de esperar); el mensaje se pone al terminar.
    const waNum = waNumber(cfg.whatsapp_number || data.store.whatsapp);
    let waTab: Window | null = null;
    try { waTab = waNum ? window.open("", "_blank") : null; } catch { waTab = null; }
    try {
      const res = await fetch("/api/landing/order", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          store: data.store.slug, slug: data.page.slug, session: session.current, units: chosen, payment, upsell: takeUpsell, exit: xpct > 0,
          customer: { ...f, whatsapp: f.whatsapp }, ref: refInfo.current, ...metaCookies(), url: window.location.href.split("#")[0],
        }),
      });
      const json = (await res.json().catch(() => null)) as { ok?: boolean; error?: string; field?: string; token?: string; receipt_no?: string; total?: number; event_id?: string; items?: Array<{ id: string; name: string; price: number; quantity: number }> } | null;
      if (!res.ok || !json?.ok) { waTab?.close(); setErr({ field: json?.field, message: json?.error ?? "No se pudo enviar el pedido. Intenta de nuevo." }); return; }
      const tItems = (json.items ?? []).map((i) => ({ id: i.id, name: i.name, price: Number(i.price), quantity: Number(i.quantity) }));
      track.order(json.event_id ?? `${data.store.slug}-${json.receipt_no ?? Date.now()}`, tItems, data.store.slug);
      landingPixelEvent("Purchase", { content_ids: tItems.map((i) => i.id), content_type: "product", value: json.total, currency: "COP", num_items: tItems.reduce((s, i) => s + i.quantity, 0) }, json.event_id);
      const waText = orderWhatsAppText({ page: data.page.name, receipt: json.receipt_no ?? null, items: tItems, total: Number(json.total) || 0, payment, freeShipping: cfg.shipping.free, customer: f, storeSlug: data.store.slug, catalog: data.page.catalog });
      const waUrl = waNum ? `https://wa.me/${waNum}?text=${encodeURIComponent(waText)}` : null;
      if (waUrl && waTab && !waTab.closed) waTab.location.href = waUrl;
      setDone({ receipt_no: json.receipt_no ?? null, total: Number(json.total) || 0, payment, waUrl });
    } catch {
      waTab?.close();
      setErr({ message: "Sin conexión. Revisa tu internet e intenta de nuevo." });
    } finally {
      setBusy(false);
    }
  }

  if (done) return <ThankYou data={data} cfg={cfg} done={done} name={f.name} onClose={onClose} />;

  const input = (k: keyof typeof f, label: string, props: Record<string, unknown> = {}) => (
    <label className="block">
      <span className="mb-1 block text-[13px] font-extrabold">{label}</span>
      <input id={`lp-${k}`} value={String(f[k])} onChange={(e) => set(k, e.target.value)} className={`lp-input w-full rounded-xl border-2 px-3 py-3 text-[16px] outline-none ${err?.field === k ? "border-red-500" : "border-slate-200"}`} {...props} />
      {err?.field === k ? <span className="mt-1 block text-xs font-bold text-red-600">{err.message}</span> : null}
    </label>
  );

  return (
    <Overlay title="Elige y completa tu pedido" onClose={() => setAskLeave(true)} wide>
      <div {...E("bundles", "Paquetes")} className="space-y-2">
        {bundles.map((bb, k) => {
          const on = k === tier;
          const now = Array.from({ length: bb.qty }, (_, j) => discounted(priceOf(units[j] ?? first), bb.pct, xpct, online)).reduce((s, v) => s + v, 0);
          const realBefore = cfg.compare_at_price && cfg.compare_at_price > priceOf(first) ? cfg.compare_at_price * bb.qty : 0;
          const full = Array.from({ length: bb.qty }, (_, j) => priceOf(units[j] ?? first)).reduce((a, v) => a + v, 0);
          const was = realBefore || (bb.pct > 0 || xpct > 0 || online > 0 ? full : 0);
          return (
            <div key={bb.qty} className={`lp-tier relative rounded-2xl border-2 p-3 transition ${on ? "lp-tier-on" : "border-slate-200"}`}>
              {bb.highlight ? <span className="lp-badge absolute -top-2.5 right-3 rounded-full px-2.5 py-0.5 text-[10px] font-black uppercase text-white">Más elegido</span> : null}
              <button type="button" onClick={() => setTier(k)} className="flex w-full items-center gap-3 text-left">
                <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border-2 ${on ? "lp-radio-on" : "border-slate-300"}`}>{on ? <span className="h-2 w-2 rounded-full bg-white" /> : null}</span>
                <span className="min-w-0 flex-1"><span className="block font-black">{bb.label}</span>{bb.pct > 0 ? <span className="text-xs font-extrabold text-emerald-600">Ahorra {bb.pct}% adicional</span> : <span className="text-xs text-slate-500">Precio de promo</span>}</span>
                <span className="text-right">{was > now ? <span className="block text-xs text-slate-400 line-through">{money(was)}</span> : null}<span className="block font-black">{money(now)}</span></span>
              </button>
              {on && dimsSheet ? (
                <div className="mt-3 space-y-2">
                  {Array.from({ length: bb.qty }, (_, j) => {
                    const cur = items.findIndex((it) => it.id === units[j]);
                    const p = dimsSheet.parts[cur] ?? dimsSheet.parts[0];
                    const pick = (d: number, v: string) => {
                      const want = d === 0 ? [v, p[1]] : [p[0], v];
                      let k = dimsSheet.parts.findIndex((x) => x[0] === want[0] && x[1] === want[1]);
                      if (k < 0) k = dimsSheet.parts.findIndex((x) => x[d] === v);
                      if (k >= 0) setUnits((u) => u.map((x, z) => (z === j ? items[k].id : x)));
                    };
                    return (
                      <div key={j} className="grid grid-cols-[auto_1fr_1fr] items-end gap-2">
                        <span className="pb-3 text-xs font-black text-slate-500">{j + 1}.</span>
                        {[0, 1].map((d) => (
                          <label key={d} className="text-xs font-bold text-slate-500">{dimsSheet.labels[d]}
                            <select value={p[d]} onChange={(e) => pick(d, e.target.value)} className="lp-input mt-1 w-full rounded-xl border-2 border-slate-200 bg-white px-2 py-2.5 text-[15px] font-semibold text-slate-900">
                              {dimsSheet.values[d].map((v) => {
                                const exists = dimsSheet.parts.some((x, k) => x[d] === v && (d === 0 || x[0] === p[0]) && (items[k].stock === null || items[k].stock! > 0));
                                return <option key={v} value={v} disabled={!exists}>{v}{exists ? "" : " (agotado)"}</option>;
                              })}
                            </select>
                          </label>
                        ))}
                      </div>
                    );
                  })}
                </div>
              ) : on && items.length > 1 ? (
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {Array.from({ length: bb.qty }, (_, j) => (
                    <label key={j} className="text-xs font-bold text-slate-500">{j + 1}. {cfg.option_label}
                      <select value={units[j]} onChange={(e) => setUnits((u) => u.map((x, z) => (z === j ? e.target.value : x)))} className="lp-input mt-1 w-full rounded-xl border-2 border-slate-200 bg-white px-3 py-2.5 text-[15px] font-semibold text-slate-900">
                        {items.map((it) => <option key={it.id} value={it.id} disabled={it.stock !== null && it.stock <= 0}>{it.option}{it.stock !== null && it.stock <= 0 ? " (agotado)" : ""}</option>)}
                      </select>
                    </label>
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      {payOptions.length > 1 || payOptions[0] !== "cod" ? (
        <div {...E("payments", "Formas de pago")} className="mt-5">
          <p className="mb-2 text-sm font-black">¿Cómo quieres pagar?</p>
          <div className="space-y-2">
            {payOptions.map((p) => (
              <button key={p} type="button" onClick={() => setPayment(p)} className={`flex w-full items-center gap-3 rounded-2xl border-2 p-3 text-left ${payment === p ? "lp-tier-on" : "border-slate-200"}`}>
                <span className="text-2xl">{p === "cod" ? "💵" : p === "online" ? "💳" : "🗓️"}</span>
                <span className="flex-1"><span className="block text-sm font-black">{p === "cod" ? "Pago contraentrega" : p === "online" ? `Pagar en línea${cfg.payments.online_pct > 0 ? ` y recibe ${cfg.payments.online_pct}% de descuento` : ""}` : "A cuotas con Addi"}</span>
                  <span className="block text-xs text-slate-500">{p === "cod" ? "Pagas en efectivo cuando lo recibes en tu casa" : p === "online" ? "Tarjeta, PSE, Nequi o Bancolombia con Wompi" : "Paga en cuotas, sujeto a aprobación de Addi"}</span></span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div {...E("shipping", "Envío y total")} className="mt-5 rounded-2xl bg-slate-50 p-4 text-sm">
        <div className="flex justify-between"><span>Subtotal</span><span>{money(subtotal)}</span></div>
        {subtotal > total ? <div className="flex justify-between font-bold text-emerald-600"><span>Ahorro</span><span>−{money(subtotal - total)}</span></div> : null}
        <div className="flex justify-between"><span>Envío</span><span className="font-bold">{cfg.shipping.free ? "GRATIS" : "Te lo confirmamos"}</span></div>
        <div className="mt-2 flex justify-between border-t border-slate-200 pt-2 text-lg font-black"><span>Total a pagar</span><span style={{ color: cfg.accent }}>{money(total)}</span></div>
      </div>

      <div {...E("form", "Formulario")} className="mt-5 space-y-3">
        {input("name", "Nombre y apellido", { autoComplete: "name", placeholder: "Ej. María López" })}
        {input("whatsapp", "WhatsApp para contactarte", { inputMode: "tel", autoComplete: "tel-national", placeholder: "300 123 4567" })}
        {cfg.form.ask_email ? input("email", "Correo electrónico", { type: "email", autoComplete: "email" }) : null}
        {cfg.form.ask_document ? input("document", "Cédula", { inputMode: "numeric", autoComplete: "off", "data-1p-ignore": true, "data-lpignore": "true" }) : null}
        <label className="block">
          <span className="mb-1 block text-[13px] font-extrabold">Departamento</span>
          <select id="lp-department" value={f.department} onChange={(e) => set("department", e.target.value)} className={`lp-input w-full rounded-xl border-2 bg-white px-3 py-3 text-[16px] ${err?.field === "department" ? "border-red-500" : "border-slate-200"}`}>
            <option value="">Elige tu departamento</option>
            {CO_DEPARTMENTS.map((d) => <option key={d}>{d}</option>)}
          </select>
          {err?.field === "department" ? <span className="mt-1 block text-xs font-bold text-red-600">{err.message}</span> : null}
        </label>
        {input("city", "Ciudad o municipio", { autoComplete: "address-level2" })}
        {input("address", "Dirección completa", { autoComplete: "street-address", placeholder: "Calle, número, apto o casa" })}
        {cfg.form.ask_neighborhood ? input("neighborhood", "Barrio (opcional)") : null}
        {input("notes", "Indicaciones para la entrega (opcional)", { placeholder: "Ej. portería, color de la casa…" })}
        {cfg.form.confirm_address ? (
          <label className={`flex items-start gap-2 rounded-xl p-2 text-sm ${err?.field === "confirm" ? "bg-red-50" : ""}`}>
            <input id="lp-confirm" type="checkbox" checked={f.confirm} onChange={(e) => set("confirm", e.target.checked)} className="mt-0.5 h-5 w-5" />
            <span className="font-semibold">Confirmo que esta es la dirección de entrega.</span>
          </label>
        ) : null}
      </div>

      {err && (!err.field || !["name", "whatsapp", "email", "document", "department", "city", "address"].includes(err.field)) ? <p className="mt-4 rounded-xl bg-red-50 p-3 text-sm font-bold text-red-700">{err.message}</p> : null}
      <button type="button" onClick={submit} disabled={busy} className="lp-cta mt-5 w-full rounded-2xl px-5 py-4 text-[16px] font-black uppercase text-white disabled:opacity-60">
        {busy ? "Enviando tu pedido…" : payment === "cod" ? `${cfg.cta_text.replace(/!$/, "")} · ${money(total)}` : `Hacer mi pedido · ${money(total)}`}
      </button>
      <p className="mt-3 text-center text-[11px] leading-4 text-slate-400">🔒 Tus datos se usan solo para tu pedido y su entrega (Ley 1581 de 2012). Al dejar tu WhatsApp aceptas que te contactemos sobre este pedido.</p>

      {askLeave ? createPortal(
        <div className="lp-portal fixed inset-0 z-80 grid place-items-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-label="¿Seguir con tu compra?">
          <div className="lp-pop w-full max-w-sm overflow-hidden rounded-3xl bg-white text-center text-slate-900 shadow-2xl">
            <div className="lp-topbar px-4 py-3 text-sm font-black uppercase text-white">¿Ya te vas? 😮</div>
            <div className="p-6">
              <p className="text-4xl">🛒</p>
              <h3 className="mt-2 text-xl font-black">¡Tu pedido está casi listo!</h3>
              <p className="mt-1 text-sm text-slate-600">{total ? `Son ${money(total)}` : "Ya casi terminas"}{data.payments.cod && cfg.payments.cod ? " y pagas cuando lo recibes." : "."} Solo te falta llenar tus datos.</p>
              <button type="button" autoFocus onClick={() => setAskLeave(false)} className="lp-cta lp-anim-bounce mt-5 w-full rounded-2xl px-4 py-3.5 font-black uppercase text-white">👉 Seguir con mi compra</button>
              <button type="button" onClick={() => { setAskLeave(false); onClose(); }} className="mt-2 w-full py-2 text-sm font-semibold text-slate-400 underline">Salir de todas formas</button>
            </div>
          </div>
        </div>, document.body) : null}
      {upsellAsk && upsell ? <UpsellModal cfg={cfg} item={upsell} price={upsellPrice} onYes={() => void send(true)} onNo={() => void send(false)} /> : null}
    </Overlay>
  );
}

function UpsellModal({ cfg, item, price, onYes, onNo }: { cfg: ReturnType<typeof normalizeLanding>; item: LandingItem; price: number; onYes: () => void; onNo: () => void }) {
  const [left, setLeft] = useState(cfg.upsell.seconds || 0);
  useEffect(() => {
    if (!cfg.upsell.seconds) return;
    const t = window.setInterval(() => setLeft((s) => s - 1), 1000);
    return () => window.clearInterval(t);
  }, [cfg.upsell.seconds]);
  useEffect(() => { if (cfg.upsell.seconds && left <= 0) onNo(); }, [left, cfg.upsell.seconds, onNo]);
  return createPortal(
    <div className="lp-portal fixed inset-0 z-70 grid place-items-center bg-black/70 p-4">
      <div {...E("upsell", "Adicional")} className="lp-pop w-full max-w-sm overflow-hidden rounded-3xl bg-white text-center text-slate-900 shadow-2xl">
        <div className="lp-topbar px-4 py-3 text-sm font-black uppercase text-white">{cfg.upsell.title}</div>
        <div className="p-5">
          {item.image ? <img src={item.image} alt={item.name} className="mx-auto h-44 w-44 rounded-2xl object-cover" /> : null}
          <h3 className="mt-3 text-lg font-black">{item.name}</h3>
          <p className="mt-1 text-sm text-slate-600">{cfg.upsell.text}</p>
          <p className="mt-3"><span className="text-slate-400 line-through">{money(item.price)}</span> <span className="text-3xl font-black" style={{ color: cfg.accent }}>{money(price)}</span></p>
          <button type="button" onClick={onYes} className="lp-cta lp-pulse mt-4 w-full rounded-2xl px-4 py-3.5 font-black uppercase text-white">¡Sí, agrégalo a mi pedido!</button>
          <button type="button" onClick={onNo} className="mt-2 w-full py-2 text-sm font-semibold text-slate-500 underline">No, gracias{cfg.upsell.seconds ? ` (${Math.max(0, left)} s)` : ""}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Lluvia de confeti al confirmar el pedido (puro CSS, se va sola). */
function Confetti() {
  const pieces = useMemo(() => Array.from({ length: 36 }, (_, i) => ({
    left: (i * 37) % 100, delay: (i % 9) * 0.12, dur: 1.8 + ((i * 7) % 10) / 10, rot: (i * 53) % 360,
    color: ["#f43f5e", "#f59e0b", "#10b981", "#3b82f6", "#a855f7", "#ec4899"][i % 6], size: 6 + (i % 4) * 2,
  })), []);
  return createPortal(
    <div className="lp-confetti pointer-events-none fixed inset-0 z-80 overflow-hidden" aria-hidden>
      {pieces.map((p, i) => (
        <span key={i} style={{ left: `${p.left}%`, width: p.size, height: p.size * 1.6, background: p.color, animationDelay: `${p.delay}s`, animationDuration: `${p.dur}s`, transform: `rotate(${p.rot}deg)` }} />
      ))}
    </div>,
    document.body,
  );
}

function ThankYou({ cfg, done, name, onClose }: { data: LandingData; cfg: ReturnType<typeof normalizeLanding>; done: Done; name: string; onClose: () => void }) {
  const first = name.trim().split(/\s+/)[0] ?? "";
  return (
    <Overlay title="¡Pedido recibido!" onClose={onClose}>
      <div className="text-center">
        <Confetti />
        <div className="lp-pop mx-auto grid h-20 w-20 place-items-center rounded-full bg-emerald-500 text-4xl text-white">✓</div>
        <h3 className="mt-4 text-2xl font-black">¡Gracias{first ? `, ${first}` : ""}! 🎉</h3>
        {done.receipt_no ? <p className="mt-1 text-sm font-bold text-slate-500">Pedido #{done.receipt_no} · {money(done.total)}</p> : null}
        <p className="mt-3 text-[15px] leading-6 text-slate-600">{cfg.thank_you}</p>
        {done.payment !== "cod" ? <p className="mt-3 rounded-2xl bg-amber-50 p-3 text-sm font-semibold text-amber-800">💳 Cuando confirmemos tu pedido te enviamos por WhatsApp el enlace para pagar {done.payment === "addi" ? "a cuotas con Addi" : "en línea"}.</p> : null}
        {done.waUrl ? (
          <>
            <p className="mt-4 text-sm font-bold text-slate-700">📲 Envíanos el mensaje que se abrió en WhatsApp para confirmar tu pedido.</p>
            <a href={done.waUrl} target="_blank" rel="noopener noreferrer" className="lp-anim-bounce mt-3 flex w-full items-center justify-center gap-2 rounded-2xl bg-[#25d366] px-4 py-4 font-black text-white shadow-lg">
              ✅ Enviar mi pedido por WhatsApp
            </a>
            <p className="mt-2 text-xs text-slate-400">Si no se abrió WhatsApp, toca el botón verde.</p>
          </>
        ) : null}
      </div>
    </Overlay>
  );
}

const LP_CSS = `
:root{--lp-dark:color-mix(in oklab,var(--lp-accent) 80%,#000)}
.lp-root{overflow-x:clip}
.lp-root,.lp-portal{--lp-dark:color-mix(in oklab,var(--lp-accent) 80%,#000);font-family:inherit;color-scheme:light}
.lp-font-elegante h1,.lp-font-elegante h2,.lp-font-elegante h3{font-family:"Playfair Display",Georgia,"Times New Roman",serif;letter-spacing:-.01em}
.lp-font-fuerte h1,.lp-font-fuerte h2,.lp-font-fuerte h3,.lp-font-fuerte .lp-cta{font-family:Impact,"Arial Black","Helvetica Neue",sans-serif;letter-spacing:.01em;text-transform:uppercase}
.lp-font-amable{font-family:"Trebuchet MS","Segoe UI",system-ui,sans-serif}
.lp-font-amable h1,.lp-font-amable h2{font-family:"Comic Neue","Trebuchet MS",system-ui,sans-serif}
.lp-topbar{background:linear-gradient(90deg,var(--lp-dark),var(--lp-accent),var(--lp-dark));background-size:200% 100%;animation:lpShine 6s linear infinite}
.lp-cta{background:linear-gradient(180deg,var(--lp-accent),var(--lp-dark));box-shadow:0 10px 30px -10px var(--lp-accent)}
.lp-cta:active{transform:scale(.98)}
/* «¡Ey, aquí estoy!»: el botón crece mucho con rebote y lanza una onda de color. */
.lp-pulse,.lp-anim-boom{animation:lpBoom 2.4s cubic-bezier(.3,1.6,.5,1) infinite,lpWave 2.4s ease-out infinite;font-weight:900;letter-spacing:.02em}
@keyframes lpBoom{0%,40%,100%{transform:scale(1) rotate(0)}8%{transform:scale(1.14) rotate(-1.5deg)}14%{transform:scale(.95) rotate(1deg)}20%{transform:scale(1.09) rotate(-.5deg)}27%{transform:scale(.99)}33%{transform:scale(1.03)}}
@keyframes lpWave{0%{box-shadow:0 10px 30px -10px var(--lp-accent),0 0 0 0 color-mix(in oklab,var(--lp-accent) 65%,transparent)}35%{box-shadow:0 14px 34px -10px var(--lp-accent),0 0 0 20px transparent}100%{box-shadow:0 10px 30px -10px var(--lp-accent),0 0 0 20px transparent}}
.lp-chip{background:var(--lp-accent-soft);color:var(--lp-accent)}
.lp-badge,.lp-check,.lp-radio-on{background:var(--lp-accent);border-color:var(--lp-accent)}
.lp-price-box{background:var(--lp-accent-soft);border:2px dashed color-mix(in oklab,var(--lp-accent) 40%,transparent)}
.lp-soft{background:color-mix(in oklab,var(--lp-accent) 5%,#f8fafc)}
.lp-opt{border-color:#e2e8f0;background:#fff;color:#0f172a}
.lp-opt-on{border-color:var(--lp-accent);background:var(--lp-accent-soft);color:var(--lp-accent)}
.lp-thumb-on{border-color:var(--lp-accent)}
.lp-tier-on{border-color:var(--lp-accent);background:var(--lp-accent-soft)}
.lp-input:focus{border-color:var(--lp-accent)}
.lp-dot{animation:lpBlink 1.2s ease-in-out infinite}
.lp-toast{animation:lpIn .45s cubic-bezier(.2,.9,.3,1.3)}
.lp-pop{animation:lpPop .45s cubic-bezier(.2,.9,.3,1.4)}
.lp-sheet{animation:lpUp .3s ease-out}
.lp-faq summary::-webkit-details-marker{display:none}
/* La landing es solo del producto: sin el botón de tema de RemHub. */
.theme-control{display:none!important}
.lp-portal .lp-input{border:2px solid #e2e8f0!important;border-radius:12px}
.lp-portal .lp-input.border-red-500{border-color:#ef4444!important}
.lp-portal .lp-input:focus{border-color:var(--lp-accent)!important;box-shadow:0 0 0 3px var(--lp-accent-soft)}
.lp-root select,.lp-portal select,.lp-root input:not([type=checkbox]),.lp-portal input:not([type=checkbox]),.lp-portal textarea{background-color:#fff!important;color:#0f172a!important;-webkit-text-fill-color:#0f172a}
.lp-eye{display:inline-block;animation:lpBlinkEye 4s ease-in-out infinite}
.lp-num{display:inline-block;font-weight:900;animation:lpNum .5s cubic-bezier(.2,.9,.3,1.4)}
@keyframes lpBlinkEye{0%,92%,100%{transform:scaleY(1)}95%{transform:scaleY(.1)}}
@keyframes lpNum{from{transform:translateY(-6px) scale(1.25);opacity:.3}}
.lp-ctab-light{background:#fff}
.lp-ctab-soft{background:color-mix(in oklab,var(--lp-accent) 9%,#fff)}
.lp-ctab-accent{background:linear-gradient(135deg,var(--lp-accent),var(--lp-dark))}
.lp-ctab-dark{background:#0f172a}
.lp-cta-inv{background:#fff!important;color:var(--lp-accent)!important;box-shadow:0 12px 30px -10px rgba(0,0,0,.45)!important}
.lp-anim-pulse{animation:lpPulse 2.2s ease-in-out infinite}
.lp-anim-bounce{animation:lpBounce 1.6s ease-in-out infinite}
.lp-anim-shake{animation:lpShake 3.2s ease-in-out infinite}
.lp-anim-glow{animation:lpGlow 1.8s ease-out infinite}
.lp-anim-shine{position:relative;overflow:hidden}
.lp-anim-shine::after{content:'';position:absolute;inset:0;background:linear-gradient(110deg,transparent 35%,rgba(255,255,255,.55) 50%,transparent 65%);transform:translateX(-120%);animation:lpSweep 2.6s ease-in-out infinite}
.lp-arrow{display:inline-block;animation:lpBounce 1.1s ease-in-out infinite}
@keyframes lpBounce{0%,100%{transform:translateY(0)}50%{transform:translateY(-8px)}}
@keyframes lpShake{0%,84%,100%{transform:rotate(0)}87%{transform:rotate(-3deg)}90%{transform:rotate(3deg)}93%{transform:rotate(-2deg)}96%{transform:rotate(2deg)}}
@keyframes lpGlow{0%{box-shadow:0 0 0 0 color-mix(in oklab,var(--lp-accent) 70%,transparent)}100%{box-shadow:0 0 0 18px transparent}}
@keyframes lpSweep{0%,55%{transform:translateX(-120%)}100%{transform:translateX(120%)}}
.lp-cd{background:linear-gradient(160deg,var(--lp-accent),var(--lp-dark));box-shadow:0 10px 22px -12px var(--lp-accent);perspective:300px}
.lp-cd::after{content:'';position:absolute;left:0;right:0;top:0;height:50%;background:rgba(255,255,255,.12);pointer-events:none}
.lp-cd-sec{animation:lpPulse 1s ease-in-out infinite}
.lp-flip{animation:lpFlip .45s cubic-bezier(.2,.9,.3,1.3)}
.lp-bell{display:inline-block;transform-origin:50% 10%;animation:lpRing 2.4s ease-in-out infinite}
.lp-flame{display:inline-block;transform-origin:50% 100%;animation:lpFlame .8s ease-in-out infinite alternate}
.lp-stockbar{background:repeating-linear-gradient(45deg,#ef4444 0 10px,#fb7185 10px 20px);background-size:28px 28px;animation:lpStripes 1s linear infinite;transition:width .8s ease}
.lp-hop{display:inline-block;animation:lpHop 2.2s ease-in-out infinite}
.lp-spark{display:inline-block;animation:lpPulse 1.6s ease-in-out infinite}
.lp-float{display:inline-block;animation:lpFloat 3s ease-in-out infinite}
.lp-icon-bubble{background:var(--lp-accent-soft)}
.lp-card{transition:transform .25s ease,box-shadow .25s ease}
.lp-card:hover{transform:translateY(-4px);box-shadow:0 18px 40px -18px rgba(0,0,0,.28)}
.lp-shimmer{position:relative;overflow:hidden}
.lp-shimmer::after{content:'';position:absolute;inset:0;background:linear-gradient(110deg,transparent 35%,rgba(255,255,255,.6) 50%,transparent 65%);transform:translateX(-120%);animation:lpSweep 2.8s ease-in-out infinite}
.lp-wobble{animation:lpWobble 3.2s ease-in-out infinite}
.lp-urg{animation:lpIn .5s both}
.lp-root [data-reveal]{opacity:0;transform:translateY(28px);transition:opacity .7s ease,transform .7s ease}
.lp-root [data-reveal].lp-in{opacity:1;transform:none}
.lp-confetti span{position:absolute;top:-24px;border-radius:2px;animation-name:lpFall;animation-timing-function:ease-in;animation-fill-mode:forwards}
@keyframes lpFlip{from{transform:rotateX(90deg) translateY(-6px);opacity:.2}}
@keyframes lpRing{0%,70%,100%{transform:rotate(0)}75%{transform:rotate(14deg)}80%{transform:rotate(-12deg)}85%{transform:rotate(8deg)}90%{transform:rotate(-6deg)}}
@keyframes lpFlame{from{transform:scale(1) rotate(-5deg)}to{transform:scale(1.2) rotate(5deg)}}
@keyframes lpStripes{to{background-position:28px 0}}
@keyframes lpHop{0%,60%,100%{transform:translateY(0)}70%{transform:translateY(-6px)}80%{transform:translateY(0)}88%{transform:translateY(-2px)}}
@keyframes lpFloat{0%,100%{transform:translateY(0)}50%{transform:translateY(-7px)}}
@keyframes lpWobble{0%,80%,100%{transform:rotate(0) scale(1)}85%{transform:rotate(-7deg) scale(1.1)}90%{transform:rotate(7deg) scale(1.1)}95%{transform:rotate(-3deg)}}
@keyframes lpFall{to{transform:translateY(112vh) rotate(760deg)}}
/* Animaciones suaves: sin lo que flota o salta; sin animación: nada se mueve. */
.lp-fx-soft .lp-float,.lp-fx-soft .lp-hop,.lp-fx-soft .lp-wobble,.lp-fx-soft .lp-bell,.lp-fx-soft .lp-flame,.lp-fx-soft .lp-spark,.lp-fx-soft .lp-cd-sec{animation:none}
.lp-fx-off *,.lp-fx-off *::after{animation:none!important}
.lp-fx-off [data-reveal]{opacity:1;transform:none;transition:none}
@keyframes lpPulse{0%,100%{transform:scale(1)}50%{transform:scale(1.03)}}
@keyframes lpShine{to{background-position:200% 0}}
@keyframes lpBlink{50%{opacity:.25}}
@keyframes lpIn{from{opacity:0;transform:translateY(20px) scale(.9)}}
@keyframes lpPop{from{opacity:0;transform:scale(.6)}}
@keyframes lpUp{from{transform:translateY(40px);opacity:.4}}
@media (prefers-reduced-motion:reduce){.lp-anim-boom,.lp-root [data-reveal]{opacity:1;transform:none;transition:none}.lp-confetti{display:none}.lp-cd-sec,.lp-flip,.lp-bell,.lp-flame,.lp-stockbar,.lp-hop,.lp-spark,.lp-float,.lp-shimmer::after,.lp-wobble,.lp-urg,.lp-anim-pulse,.lp-anim-bounce,.lp-anim-shake,.lp-anim-glow,.lp-anim-shine::after,.lp-arrow,.lp-eye,.lp-num,.lp-pulse,.lp-topbar,.lp-dot,.lp-toast,.lp-pop,.lp-sheet{animation:none}}
`;
