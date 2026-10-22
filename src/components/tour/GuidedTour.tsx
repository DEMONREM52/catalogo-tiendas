"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import { helpFor, type TourStep } from "./tours";

/**
 * Recorrido guiado («▶️ Mostrarme cómo»): oscurece la pantalla, ilumina cada botón en orden y explica para qué sirve.
 * Cada paso busca su elemento por selector CSS o por texto («text:Cobrar»). Si no está (permisos, celular,
 * pantalla vacía), el paso se muestra en el centro: la explicación nunca se pierde.
 * A quien entra por primera vez a una pantalla se le ofrece el recorrido una sola vez.
 */

const START = "remhub-start-tour";
const SEEN = (key: string) => `remhub:tour-seen:${key}`;
const OFF = "remhub:tours-off";

export const startTour = (key?: string) => window.dispatchEvent(new CustomEvent(START, { detail: key }));

const fold = (t: string) => t.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();
const visible = (el: Element) => {
  const r = el.getBoundingClientRect();
  const st = window.getComputedStyle(el);
  return r.width > 0 && r.height > 0 && st.visibility !== "hidden" && st.display !== "none";
};

/** Busca el elemento de un paso: el primero de la lista que exista y se vea. */
function findTarget(target: TourStep["target"]): Element | null {
  const list = Array.isArray(target) ? target : target ? [target] : [];
  for (const t of list) {
    if (t.startsWith("text:")) {
      const needle = fold(t.slice(5));
      const all = Array.from(document.querySelectorAll("main button, main a, main h1, main h2, main h3, main label, main th, main summary, header button, header a, nav button, nav a, aside a, aside button"));
      const hits = all.filter((el) => visible(el) && fold(el.textContent ?? "").includes(needle) && !el.closest("[data-tour-ui]"));
      // El más pequeño que contiene el texto (el botón, no toda la sección).
      hits.sort((a, b) => (a.textContent?.length ?? 0) - (b.textContent?.length ?? 0));
      if (hits[0]) return hits[0];
    } else {
      try {
        const el = Array.from(document.querySelectorAll(t)).find((x) => visible(x) && !x.closest("[data-tour-ui]"));
        if (el) return el;
      } catch { /* selector no válido */ }
    }
  }
  return null;
}

type Rect = { top: number; left: number; width: number; height: number };

export function GuidedTourHost() {
  const mounted = useSyncExternalStore(() => () => {}, () => true, () => false);
  const pathname = usePathname();
  const [steps, setSteps] = useState<TourStep[] | null>(null);
  const [title, setTitle] = useState("");
  const [tourKey, setTourKey] = useState("");
  const [i, setI] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const [offer, setOffer] = useState<{ key: string; title: string } | null>(null);
  const [vw, setVw] = useState(0);
  const tipRef = useRef<HTMLDivElement>(null);

  const begin = useCallback((key?: string) => {
    const h = helpFor(window.location.pathname, window.location.search, key);
    if (!h?.steps?.length) return;
    setOffer(null);
    setTitle(h.title);
    setTourKey(h.key);
    setSteps(h.steps);
    setI(0);
  }, []);

  const close = useCallback((done: boolean) => {
    if (tourKey) { try { window.localStorage.setItem(SEEN(tourKey), done ? "done" : "skipped"); } catch { /* sin almacenamiento */ } }
    setSteps(null);
    setRect(null);
  }, [tourKey]);

  // Inicio a pedido (botón «?» o «Mostrarme cómo»).
  useEffect(() => {
    const on = (e: Event) => begin((e as CustomEvent<string | undefined>).detail);
    window.addEventListener(START, on);
    return () => window.removeEventListener(START, on);
  }, [begin]);

  // Primera vez en una pantalla: se ofrece el recorrido (una sola vez por pantalla; se puede apagar para siempre).
  useEffect(() => {
    const check = () => {
      if (steps) return;
      let off = false, seen = false;
      const h = helpFor(window.location.pathname, window.location.search);
      try { off = window.localStorage.getItem(OFF) === "1"; seen = h ? Boolean(window.localStorage.getItem(SEEN(h.key))) : true; } catch { off = true; }
      setOffer(!off && !seen && h?.steps?.length ? { key: h.key, title: h.title } : null);
    };
    const t = window.setTimeout(check, 1800);
    window.addEventListener("remhub-tab-change", check);
    return () => { window.clearTimeout(t); window.removeEventListener("remhub-tab-change", check); };
  }, [pathname, steps]);

  // Ubica el elemento del paso actual (y lo sigue si la página se mueve).
  const step = steps?.[i] ?? null;
  useLayoutEffect(() => {
    if (!step) return;
    let raf = 0;
    const el = findTarget(step.target);
    if (el) el.scrollIntoView({ block: "center", behavior: "smooth" });
    const measure = () => {
      setVw(window.innerWidth);
      const r = el?.getBoundingClientRect();
      setRect(r ? { top: r.top, left: r.left, width: r.width, height: r.height } : null);
    };
    const loop = () => { measure(); raf = window.requestAnimationFrame(loop); };
    const t = window.setTimeout(loop, el ? 350 : 0);
    return () => { window.clearTimeout(t); window.cancelAnimationFrame(raf); };
  }, [step]);

  useEffect(() => {
    if (!steps) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close(false);
      else if (e.key === "ArrowRight" || e.key === "Enter") setI((n) => { if (n + 1 >= steps.length) { close(true); return n; } return n + 1; });
      else if (e.key === "ArrowLeft") setI((n) => Math.max(0, n - 1));
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [steps, close]);

  if (!mounted) return null;

  const pad = 8;
  const tipW = Math.min(340, (vw || 360) - 24);
  let tipStyle: React.CSSProperties = { left: "50%", top: "50%", transform: "translate(-50%, -50%)", width: tipW };
  if (rect) {
    const below = rect.top + rect.height + pad + 12;
    const fitsBelow = below + 190 < window.innerHeight;
    const left = Math.min(Math.max(12, rect.left + rect.width / 2 - tipW / 2), (vw || window.innerWidth) - tipW - 12);
    tipStyle = fitsBelow ? { left, top: below, width: tipW } : { left, top: Math.max(12, rect.top - pad - 12 - 190), width: tipW };
  }

  return createPortal(
    <>
      {offer && !steps ? (
        <div data-tour-ui className="fixed bottom-20 right-3 z-[170] max-w-[calc(100vw-1.5rem)] rounded-2xl border p-3 text-sm shadow-2xl sm:bottom-5 sm:right-5 sm:w-80"
          style={{ borderColor: "color-mix(in oklab, var(--t-accent) 45%, var(--t-card-border))", background: "var(--t-bg-base)", color: "var(--t-text)" }}>
          <p className="font-bold">👋 ¿Primera vez en {offer.title}?</p>
          <p className="mt-0.5 text-xs" style={{ color: "var(--t-muted)" }}>Te mostramos en 30 segundos para qué sirve cada botón.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" onClick={() => begin(offer.key)} className="rounded-xl px-3 py-1.5 text-xs font-bold text-white" style={{ background: "var(--t-cta)" }}>▶️ Ver recorrido</button>
            <button type="button" onClick={() => { try { window.localStorage.setItem(SEEN(offer.key), "skipped"); } catch { /* */ } setOffer(null); }} className="rounded-xl border px-3 py-1.5 text-xs font-semibold" style={{ borderColor: "var(--t-card-border)" }}>Ahora no</button>
            <button type="button" onClick={() => { try { window.localStorage.setItem(OFF, "1"); } catch { /* */ } setOffer(null); }} className="text-[11px] underline" style={{ color: "var(--t-muted)" }}>No mostrar más</button>
          </div>
        </div>
      ) : null}
      {steps && step ? (
        <div data-tour-ui className="fixed inset-0 z-[200]" role="dialog" aria-modal="true" aria-label={`Recorrido: ${title}`}>
          {/* Capa oscura con un hueco sobre el elemento. */}
          {rect ? (
            <div className="pointer-events-none fixed rounded-xl transition-all duration-300"
              style={{ top: rect.top - pad, left: rect.left - pad, width: rect.width + pad * 2, height: rect.height + pad * 2, boxShadow: "0 0 0 9999px rgba(2,6,23,.72), 0 0 0 3px #a855f7, 0 0 26px 6px rgba(168,85,247,.55)" }} />
          ) : <div className="fixed inset-0" style={{ background: "rgba(2,6,23,.72)" }} />}
          <div className="fixed inset-0" onClick={() => close(false)} />
          <div ref={tipRef} className="fixed rounded-2xl border p-4 shadow-2xl transition-all duration-300" style={{ ...tipStyle, borderColor: "var(--t-card-border)", background: "var(--t-bg-base)", color: "var(--t-text)" }}>
            <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "var(--t-accent)" }}>{title} · paso {i + 1} de {steps.length}</p>
            <p className="mt-1 text-base font-black leading-snug">{step.title}</p>
            <p className="mt-1 text-sm" style={{ color: "var(--t-muted)" }}>{step.text}</p>
            <div className="mt-3 flex items-center justify-between gap-2">
              <div className="flex gap-1">{steps.map((_, k) => <span key={k} className="h-1.5 w-1.5 rounded-full" style={{ background: k === i ? "var(--t-accent)" : "var(--t-card-border)" }} />)}</div>
              <div className="flex gap-2">
                <button type="button" onClick={() => close(false)} className="rounded-lg px-2.5 py-1.5 text-xs font-semibold" style={{ color: "var(--t-muted)" }}>Salir</button>
                {i > 0 ? <button type="button" onClick={() => setI(i - 1)} className="rounded-lg border px-3 py-1.5 text-xs font-semibold" style={{ borderColor: "var(--t-card-border)" }}>Atrás</button> : null}
                <button type="button" autoFocus onClick={() => (i + 1 >= steps.length ? close(true) : setI(i + 1))} className="rounded-lg px-3 py-1.5 text-xs font-bold text-white" style={{ background: "var(--t-cta)" }}>
                  {i + 1 >= steps.length ? "¡Listo! ✓" : "Siguiente →"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>,
    document.body,
  );
}
