"use client";

import { BUILD_RELEASE, releaseTouches, type Release } from "./release";

/**
 * Instalación y actualización de la app (PWA) en el navegador.
 * Usa lo que el navegador realmente ofrece: el evento «beforeinstallprompt» (Chrome, Edge, Samsung…),
 * el modo «standalone» (ya abierta como app) y el Service Worker. Nada se simula.
 */

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

export type PwaState = {
  /** El navegador ofrece el diálogo nativo de instalación. */
  canPrompt: boolean;
  /** La página está abierta como app instalada (pantalla completa, sin barra del navegador). */
  standalone: boolean;
  /** Se instaló en esta visita (evento «appinstalled» del navegador). */
  installedNow: boolean;
  /** Hay una versión nueva que cambia la página donde está la persona. */
  updateReady: boolean;
  /** Qué cambió en esta página (para el aviso y el simulador). */
  notes: Release[];
};

let deferred: BeforeInstallPromptEvent | null = null;
let state: PwaState = { canPrompt: false, standalone: false, installedNow: false, updateReady: false, notes: [] };
const listeners = new Set<() => void>();
let started = false;
let waitingWorker: ServiceWorker | null = null;

function set(next: Partial<PwaState>) {
  state = { ...state, ...next };
  listeners.forEach((fn) => fn());
}

export function subscribePwa(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
export const getPwaState = () => state;
const SERVER_STATE: PwaState = { canPrompt: false, standalone: false, installedNow: false, updateReady: false, notes: [] };
export const getPwaServerState = () => SERVER_STATE;

function isStandalone() {
  const nav = navigator as Navigator & { standalone?: boolean };
  return window.matchMedia?.("(display-mode: standalone)").matches || window.matchMedia?.("(display-mode: minimal-ui)").matches || nav.standalone === true;
}

/** Se llama una vez (lo hace PwaProvider). Escucha la instalación y registra el Service Worker. */
export function startPwa() {
  if (started || typeof window === "undefined") return;
  started = true;
  set({ standalone: isStandalone() });
  window.matchMedia?.("(display-mode: standalone)").addEventListener?.("change", () => set({ standalone: isStandalone() }));

  // El aviso pudo llegar antes de que cargara la app (lo guarda un script mínimo en el layout).
  const early = (window as Window & { __remhubBIP?: BeforeInstallPromptEvent }).__remhubBIP;
  if (early) {
    deferred = early;
    set({ canPrompt: true });
  }
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault(); // se muestra con nuestro botón, cuando el usuario quiera
    deferred = e as BeforeInstallPromptEvent;
    set({ canPrompt: true });
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    set({ canPrompt: false, installedNow: true });
  });

  void registerServiceWorker();
}

/** Abre el diálogo nativo de instalación. Devuelve el resultado real que reporta el navegador. */
export async function promptInstall(): Promise<"accepted" | "dismissed" | "unavailable"> {
  if (!deferred) return "unavailable";
  const ev = deferred;
  deferred = null;
  set({ canPrompt: false });
  await ev.prompt();
  const choice = await ev.userChoice.catch(() => ({ outcome: "dismissed" as const }));
  return choice.outcome;
}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  const local = location.hostname === "localhost" || location.hostname === "127.0.0.1";
  // Solo en producción (https). En desarrollo no se registra para no interferir con la recarga en caliente.
  if (process.env.NODE_ENV !== "production" || (location.protocol !== "https:" && !local)) return;
  try {
    const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
    const watch = (w: ServiceWorker | null) => {
      if (!w) return;
      w.addEventListener("statechange", () => {
        if (w.state === "installed" && navigator.serviceWorker.controller) {
          waitingWorker = w;
          news = null; // otra versión: se vuelven a pedir las novedades
          void evaluateUpdate();
        }
      });
    };
    if (reg.waiting && navigator.serviceWorker.controller) {
      waitingWorker = reg.waiting;
      void evaluateUpdate();
    }
    reg.addEventListener("updatefound", () => watch(reg.installing));
    // Revisa si hay versión nueva al volver a la app y cada hora.
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") void reg.update().catch(() => undefined);
    });
    window.setInterval(() => void reg.update().catch(() => undefined), 60 * 60 * 1000);

    let reloaded = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      // Recarga una sola vez cuando la versión nueva toma el control (evita bucles).
      if (reloaded || !sessionStorageFlag()) return;
      reloaded = true;
      window.location.reload();
    });
  } catch {
    /* sin Service Worker la página funciona igual */
  }
}

/*
 * ¿Avisar o no? Cada despliegue trae un Service Worker nuevo, pero no todo despliegue le cambia algo a quien
 * está trabajando. Se piden las novedades publicadas (/api/version, sale de lib/pwa/changelog.ts) y:
 *   · Si alguna toca la página donde está (o es importante): aviso con lo que cambió y su simulador.
 *   · Si no: no se molesta. La versión nueva se aplica sola la próxima vez que cambie de sección
 *     (justo al llegar a otra página, cuando no hay nada a medio escribir).
 */
let news: Release[] | null = null;
let watchingPath = false;
const NEWS_KEY = "remhub:sw-news";

async function loadNews() {
  if (news) return news;
  const res = await fetch("/api/version", { cache: "no-store", credentials: "same-origin" });
  if (!res.ok) throw new Error("sin versión");
  const j = (await res.json()) as { releases?: Release[] };
  news = (j.releases ?? []).filter((r) => r.id > BUILD_RELEASE);
  return news;
}

async function evaluateUpdate() {
  if (!waitingWorker) return;
  try {
    const all = await loadNews();
    const notes = all.filter((r) => releaseTouches(r, location.pathname));
    set({ updateReady: notes.length > 0, notes });
  } catch {
    /* sin conexión: se revisa al volver o al cambiar de sección */
  }
  if (!watchingPath) {
    watchingPath = true;
    // Navegar dentro de la app no recarga la página: al llegar a otra sección se aplica la versión nueva.
    let last = location.pathname;
    window.setInterval(() => {
      const now = location.pathname;
      if (now === last) return;
      last = now;
      const el = document.activeElement as HTMLElement | null;
      const typing = !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
      if (waitingWorker && !typing) applyUpdate(true);
      else void evaluateUpdate();
    }, 400);
  }
}

/** Lo nuevo que se debe mostrar después de actualizar (lo deja applyUpdate antes de recargar). */
export function takeUpdateNews(): Release[] {
  try {
    const raw = sessionStorage.getItem(NEWS_KEY);
    sessionStorage.removeItem(NEWS_KEY);
    const list = raw ? (JSON.parse(raw) as Release[]) : [];
    return list.filter((r) => releaseTouches(r, location.pathname) && r.id <= BUILD_RELEASE);
  } catch {
    return [];
  }
}

function sessionStorageFlag() {
  try {
    const v = sessionStorage.getItem("remhub:sw-update");
    sessionStorage.removeItem("remhub:sw-update");
    return v === "1";
  } catch {
    return true;
  }
}

/** Activa la versión nueva (el usuario tocó «Actualizar», o en silencio al cambiar de sección). */
export function applyUpdate(silent = false) {
  try {
    // Después de recargar se muestra lo nuevo de la página a la que llega (con su simulador).
    sessionStorage.setItem(NEWS_KEY, JSON.stringify((news ?? []).filter((r) => r.demo?.length || !silent)));
  } catch {
    /* sin almacenamiento */
  }
  if (!waitingWorker) return window.location.reload();
  try {
    sessionStorage.setItem("remhub:sw-update", "1");
  } catch {
    /* sin almacenamiento */
  }
  waitingWorker.postMessage({ type: "SKIP_WAITING" });
  set({ updateReady: false });
}

export type PlatformInfo = {
  os: "ios" | "android" | "desktop";
  /** Navegador, solo para elegir las instrucciones correctas (la instalación usa capacidades reales). */
  browser: "safari" | "chrome" | "edge" | "firefox" | "samsung" | "opera" | "other";
  /** Navegador interno de una app (WhatsApp, Instagram, Facebook…): no permite instalar. */
  inApp: string | null;
};

const SERVER_PLATFORM: PlatformInfo = { os: "desktop", browser: "other", inApp: null };
let cachedPlatform: PlatformInfo | null = null;
/** Para useSyncExternalStore: mismo objeto en cada llamada; en el servidor, uno neutro. */
export const getPlatformSnapshot = () => (cachedPlatform ??= detectPlatform());
export const getPlatformServerSnapshot = () => SERVER_PLATFORM;
export const subscribeNoop = () => () => {};

export function detectPlatform(): PlatformInfo {
  if (typeof navigator === "undefined") return { os: "desktop", browser: "other", inApp: null };
  const ua = navigator.userAgent;
  const iPadOS = navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
  const os: PlatformInfo["os"] = /iPhone|iPad|iPod/i.test(ua) || iPadOS ? "ios" : /Android/i.test(ua) ? "android" : "desktop";
  const inApp = /Instagram/i.test(ua) ? "Instagram" : /FBAN|FBAV|FB_IAB/i.test(ua) ? "Facebook" : /WhatsApp/i.test(ua) ? "WhatsApp" : /TikTok|musical_ly/i.test(ua) ? "TikTok" : /Line\//i.test(ua) ? "LINE" : null;
  const browser: PlatformInfo["browser"] = /SamsungBrowser/i.test(ua)
    ? "samsung"
    : /EdgiOS|EdgA|Edg\//i.test(ua)
      ? "edge"
      : /OPR\/|OPiOS/i.test(ua)
        ? "opera"
        : /FxiOS|Firefox/i.test(ua)
          ? "firefox"
          : /CriOS|Chrome/i.test(ua)
            ? "chrome"
            : /Safari/i.test(ua)
              ? "safari"
              : "other";
  return { os, browser, inApp };
}

/** Copia al <head> el icono y el nombre para «Agregar a pantalla de inicio» de iPhone si quedaron en el <body>. */
function syncAppleTags() {
  const pairs: Array<[string, string]> = [
    ['link[rel="apple-touch-icon"]', "link"],
    ['meta[name="apple-mobile-web-app-title"]', "meta"],
  ];
  for (const [selector, tag] of pairs) {
    const source = document.body.querySelector<HTMLElement>(selector);
    if (!source) continue;
    let clone = document.head.querySelector<HTMLElement>(`${selector}[data-remhub-pwa]`);
    if (!clone) {
      clone = document.createElement(tag);
      clone.setAttribute("data-remhub-pwa", "1");
      document.head.prepend(clone);
    }
    for (const attr of Array.from(source.attributes)) clone.setAttribute(attr.name, attr.value);
  }
}

/** Cambia el manifest de la página (ej. para incluir la clave del catálogo o el enlace de acceso del equipo). */
export function setManifestHref(href: string) {
  if (typeof document === "undefined") return;
  // Etiqueta propia al inicio del <head>: Chrome usa el primer manifest del documento. No se tocan las
  // etiquetas que maneja Next/React (en páginas dinámicas Next puede dejarlas en el <body>, donde Chrome no las lee).
  let link = document.head.querySelector<HTMLLinkElement>('link[rel="manifest"][data-remhub-pwa]');
  if (!link) {
    link = document.createElement("link");
    link.rel = "manifest";
    link.setAttribute("data-remhub-pwa", "1");
    document.head.prepend(link);
  }
  if (link.getAttribute("href") !== href) link.setAttribute("href", href);
  syncAppleTags();
}
