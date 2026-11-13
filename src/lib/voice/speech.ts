/**
 * REM: escuchar y hablar con lo que trae el navegador (gratis, sin servidor de RemHub).
 *   · Escuchar: SpeechRecognition (Chrome/Edge en Android y computador, Safari 14.5+). Firefox no lo trae.
 *   · Hablar: speechSynthesis con una voz en español del equipo.
 */

import { normalize } from "./spanish";

type RecognitionAlt = { transcript: string; confidence: number };
type RecognitionResult = { isFinal: boolean; length: number; [i: number]: RecognitionAlt };
type RecognitionEvent = { resultIndex: number; results: { length: number; [i: number]: RecognitionResult } };
type Recognition = {
  lang: string; continuous: boolean; interimResults: boolean; maxAlternatives: number;
  onresult: ((e: RecognitionEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void; stop(): void; abort(): void;
};
type RecognitionCtor = new () => Recognition;

function ctor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** ¿Este navegador puede escuchar y hablar? */
export function voiceSupported(): boolean {
  return Boolean(ctor()) && typeof window !== "undefined" && "speechSynthesis" in window;
}

export class VoiceError extends Error {
  code: "permission" | "network" | "mic" | "other";
  constructor(code: VoiceError["code"], message: string) { super(message); this.code = code; }
}

let current: Recognition | null = null;

/**
 * Escucha una frase. Devuelve las posibles lecturas (la primera es la más probable); [] si no se dijo nada.
 * `onInterim` muestra lo que va entendiendo mientras se habla.
 */
export function listen(opts: { onInterim?: (text: string) => void; timeoutMs?: number } = {}): Promise<string[]> {
  const Ctor = ctor();
  if (!Ctor) return Promise.reject(new VoiceError("other", "Este navegador no puede escuchar. Usa Chrome."));
  stopListening();
  stopWake();
  return new Promise((resolve, reject) => {
    const rec = new Ctor();
    current = rec;
    rec.lang = "es-CO";
    rec.continuous = false;
    rec.interimResults = true;
    rec.maxAlternatives = 3;
    let alts: string[] = [];
    let settled = false;
    const done = (fn: () => void) => { if (settled) return; settled = true; window.clearTimeout(timer); if (current === rec) current = null; fn(); };
    const timer = window.setTimeout(() => { try { rec.stop(); } catch { /* ya paró */ } }, opts.timeoutMs ?? 12_000);
    rec.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) {
          const list: string[] = [];
          for (let k = 0; k < r.length; k++) if (r[k]?.transcript?.trim()) list.push(r[k].transcript.trim());
          alts = list;
        } else interim += r[0]?.transcript ?? "";
      }
      if (interim) opts.onInterim?.(interim);
      else if (alts[0]) opts.onInterim?.(alts[0]);
    };
    rec.onerror = (e) => {
      if (e.error === "no-speech" || e.error === "aborted") return done(() => resolve([]));
      if (e.error === "not-allowed" || e.error === "service-not-allowed") return done(() => reject(new VoiceError("permission", "No hay permiso para usar el micrófono.")));
      if (e.error === "network") return done(() => reject(new VoiceError("network", "Sin internet: el reconocimiento de voz lo necesita.")));
      if (e.error === "audio-capture") return done(() => reject(new VoiceError("mic", "No se encontró el micrófono.")));
      done(() => reject(new VoiceError("other", `No se pudo escuchar (${e.error}).`)));
    };
    rec.onend = () => done(() => resolve(alts));
    try { rec.start(); } catch (err) { done(() => reject(new VoiceError("other", err instanceof Error ? err.message : "No se pudo escuchar."))); }
  });
}

/**
 * Escucha mientras REM habla, para poder interrumpirlo («sí, esa»). `accept` decide si lo oído es una
 * respuesta (true: deja de escuchar). Devuelve cómo pararla. No interfiere con `listen` (se para antes).
 */
export function listenWhile(accept: (alts: string[]) => boolean): () => void {
  const Ctor = ctor();
  if (!Ctor) return () => {};
  let stopped = false;
  let rec: Recognition | null = null;
  const begin = () => {
    if (stopped) return;
    const r = new Ctor();
    rec = r;
    r.lang = "es-CO";
    r.continuous = true;
    r.interimResults = false;
    r.maxAlternatives = 3;
    r.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (!res.isFinal) continue;
        const alts: string[] = [];
        for (let k = 0; k < res.length; k++) if (res[k]?.transcript?.trim()) alts.push(res[k].transcript.trim());
        if (alts.length && accept(alts)) { stop(); return; }
      }
    };
    r.onerror = () => {};
    r.onend = () => { if (!stopped) window.setTimeout(begin, 200); };
    try { r.start(); } catch { /* otro reconocimiento activo */ }
  };
  const stop = () => { stopped = true; try { rec?.abort(); } catch { /* ya paró */ } };
  begin();
  return stop;
}

/** ¿Se puede escuchar mientras habla? En celulares, abrir el micrófono corta la voz: ahí se interrumpe tocando. */
export function bargeInSupported(): boolean {
  return typeof navigator !== "undefined" && !/Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

export function stopListening() {
  const rec = current;
  current = null;
  try { rec?.abort(); } catch { /* ya paró */ }
}

let voice: SpeechSynthesisVoice | null | undefined;

async function spanishVoice(): Promise<SpeechSynthesisVoice | null> {
  if (voice !== undefined) return voice;
  const synth = window.speechSynthesis;
  let list = synth.getVoices();
  if (!list.length) {
    // Chrome carga las voces después.
    await new Promise<void>((r) => { const t = window.setTimeout(r, 1200); synth.addEventListener("voiceschanged", () => { window.clearTimeout(t); r(); }, { once: true }); });
    list = synth.getVoices();
  }
  const es = list.filter((v) => v.lang.toLowerCase().startsWith("es"));
  const order = ["es-co", "es-419", "es-mx", "es-us", "es-es"];
  es.sort((a, b) => {
    const ia = order.indexOf(a.lang.toLowerCase()); const ib = order.indexOf(b.lang.toLowerCase());
    const ra = (ia < 0 ? 9 : ia) - (a.localService ? 0.5 : 0); const rb = (ib < 0 ? 9 : ib) - (b.localService ? 0.5 : 0);
    return ra - rb;
  });
  voice = es[0] ?? null;
  return voice;
}

/** Dice el texto en voz alta y espera a que termine (o a que se calle con `stopSpeaking`). */
export async function speak(text: string): Promise<void> {
  if (typeof window === "undefined" || !("speechSynthesis" in window) || !text.trim()) return;
  const synth = window.speechSynthesis;
  synth.cancel();
  const v = await spanishVoice();
  text = spokenText(text);
  await new Promise<void>((resolve) => {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = v?.lang ?? "es-CO";
    if (v) u.voice = v;
    u.rate = 1.05;
    // Chrome a veces no avisa que terminó: tiempo máximo según el largo.
    const t = window.setTimeout(resolve, 2500 + text.length * 85);
    u.onend = () => { window.clearTimeout(t); resolve(); };
    u.onerror = () => { window.clearTimeout(t); resolve(); };
    synth.speak(u);
  });
}

export function stopSpeaking() {
  if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
}

/** Pitido corto para saber que REM ya escucha. */
export function beep(kind: "listen" | "done" = "listen") {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = kind === "listen" ? 880 : 520;
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.16);
    o.connect(g).connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + 0.18);
    o.onended = () => void ctx.close();
  } catch { /* sin sonido */ }
}

// ---------------------------------------------------------------------------------------------
// «Oye REM»: escucha de fondo solo con la pantalla encendida y la pestaña a la vista.

let wake: { rec: Recognition; stopped: boolean } | null = null;

// Cómo suele escribir el reconocedor «Oye REM»: «oye ren», «olle rem», «oyeren», «hey Ram», «R.E.M.».
const CALL = "(?:oye|oie|olle|oyes|oiga|hoye|hey|ey|hei|ei|hola|ola|ok|okey|okay|alo|epa)";
const NAME = "(?:rem|ren|ram|rim|rhem|reem|remm|renn|frem|brem|r e m|erre e eme)";
const WAKE = [
  new RegExp(`(?:^|\\s)${CALL}\\s+${NAME}(?:\\s+(.*))?$`),
  new RegExp(`(?:^|\\s)(?:oye|olle|hey|hola)(?:rem|ren|ram)(?:\\s+(.*))?$`),
  // «REM, quiero hacer un traslado»: el nombre solo, al empezar la frase.
  /^(?:rem|r e m)(?:\s+(.*))?$/,
];

/** Frase con «Oye REM» → lo que se dijo después ("" si nada). null si no llamó a REM. */
export function wakeRest(text: string): string | null {
  const t = normalize(text);
  for (const re of WAKE) {
    const m = t.match(re);
    if (m) return (m[1] ?? "").trim();
  }
  return null;
}

/** Cómo se dice «REM» en voz alta: en mayúsculas la voz lo lee como sigla («rien»). */
export function spokenText(text: string): string {
  return text.replace(/\bREM\b/g, "Rrem");
}

/**
 * Empieza a esperar «Oye REM». Llama `onWake` con lo que se dijo después (puede venir vacío).
 * Devuelve cómo pararla. `onError` si no hay permiso de micrófono.
 */
export function startWake(onWake: (rest: string) => void, onError?: (e: VoiceError) => void, onHeard?: (text: string) => void): () => void {
  const Ctor = ctor();
  if (!Ctor) return () => {};
  stopWake();
  const me = { rec: new Ctor(), stopped: false };
  wake = me;
  const begin = () => {
    if (me.stopped) return;
    const rec = new Ctor();
    me.rec = rec;
    rec.lang = "es-CO";
    rec.continuous = true;
    rec.interimResults = false;
    rec.maxAlternatives = 2;
    rec.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (!r.isFinal) continue;
        onHeard?.(r[0]?.transcript?.trim() ?? "");
        for (let k = 0; k < r.length; k++) {
          const rest = wakeRest(r[k]?.transcript ?? "");
          if (rest !== null) { stopWake(); onWake(rest); return; }
        }
      }
    };
    rec.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") { me.stopped = true; onError?.(new VoiceError("permission", "No hay permiso para usar el micrófono.")); }
    };
    // Chrome corta la escucha cada tanto: se vuelve a empezar mientras siga encendida.
    rec.onend = () => { if (!me.stopped) window.setTimeout(begin, 400); };
    try { rec.start(); } catch { window.setTimeout(begin, 1500); }
  };
  begin();
  return () => { if (wake === me) stopWake(); else me.stopped = true; };
}

export function stopWake() {
  const w = wake;
  wake = null;
  if (!w) return;
  w.stopped = true;
  try { w.rec.abort(); } catch { /* ya paró */ }
}
