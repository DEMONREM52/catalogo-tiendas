/**
 * REM: escuchar y hablar con lo que trae el navegador (gratis, sin servidor de RemHub).
 *   · Escuchar: SpeechRecognition (Chrome/Edge en Android y computador, Safari 14.5+). Firefox no lo trae.
 *   · Hablar: speechSynthesis con una voz en español del equipo.
 *
 * En computador la conversación es «a dos voces» (`capture`): REM escucha mientras habla, se calla apenas
 * la persona empieza a hablar y espera a que termine la frase completa (aguanta pausas). Lo que REM
 * mismo dice, si el micrófono lo oye por el parlante, se reconoce y se ignora.
 * En celular, abrir el micrófono corta la voz: se escucha después de hablar (y tocar la esfera lo calla).
 */

import { isQuickAnswer, normalize } from "./spanish";

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

const DUPLEX_KEY = "remhub:rem-duplex";
/** Se oyó a sí mismo por el parlante en esta sesión: filtra su propia voz con más rigor. */
let echoBlocked = false;

/** ¿Este equipo puede escuchar mientras habla? En celulares, abrir el micrófono corta la voz. */
export function duplexCapable(): boolean {
  return typeof navigator !== "undefined" && !/Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

/** La opción «Interrumpirlo hablando» (encendida por defecto en computador). */
export function duplexPref(): boolean {
  try { return localStorage.getItem(DUPLEX_KEY) !== "0"; } catch { return true; }
}

export function setDuplexPref(on: boolean) {
  try { if (on) localStorage.removeItem(DUPLEX_KEY); else localStorage.setItem(DUPLEX_KEY, "0"); } catch { /* sin almacenamiento */ }
  if (on) echoBlocked = false;
}

/** ¿Se apagó solo porque se oía por el parlante? */
export function echoDetected(): boolean {
  return echoBlocked;
}

/** ¿Escucha mientras habla (interrumpir con la voz)? Aunque se oiga por el parlante sigue: solo se vuelve más exigente. */
export function fullDuplex(): boolean {
  return duplexCapable() && duplexPref();
}

export class VoiceError extends Error {
  code: "permission" | "network" | "mic" | "other";
  constructor(code: VoiceError["code"], message: string) { super(message); this.code = code; }
}

function errorOf(code: string): VoiceError | null {
  if (code === "not-allowed" || code === "service-not-allowed") return new VoiceError("permission", "No hay permiso para usar el micrófono.");
  if (code === "network") return new VoiceError("network", "Sin internet: el reconocimiento de voz lo necesita.");
  if (code === "audio-capture") return new VoiceError("mic", "No se encontró el micrófono.");
  return null;
}

// ---------------------------------------------------------------------------------------------
// Nivel de voz (0 a 1) para que la esfera de REM reaccione al hablar y al escuchar.
// Sube con el micrófono (computador), con cada palabra que REM dice y con lo que se va reconociendo.

let levelNow = 0;
let levelAt = 0;

/** Empuja el nivel (se va apagando solo). */
export function pulseLevel(v: number) {
  const cur = voiceLevel();
  levelNow = Math.min(1, Math.max(cur, v));
  levelAt = typeof performance !== "undefined" ? performance.now() : Date.now();
}

/** Nivel actual, ya con la caída (≈ medio segundo). */
export function voiceLevel(): number {
  const now = typeof performance !== "undefined" ? performance.now() : Date.now();
  return levelNow * Math.max(0, 1 - (now - levelAt) / 550);
}

let meter: { stop: () => void } | null = null;

/**
 * Medidor del micrófono para la esfera (solo computador: en celular abrir el micrófono dos veces corta el reconocimiento).
 * Sin control automático de volumen, para no cambiarle el nivel al micrófono que usa el reconocimiento.
 */
export function startMicMeter(): () => void {
  if (meter || !duplexCapable() || typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) return () => {};
  let stopped = false;
  let raf = 0;
  let ctx: AudioContext | null = null;
  let stream: MediaStream | null = null;
  const me = {
    stop: () => {
      stopped = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
      void ctx?.close().catch(() => {});
      if (meter === me) meter = null;
    },
  };
  meter = me;
  void navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: false } }).then((s) => {
    if (stopped) { s.getTracks().forEach((t) => t.stop()); return; }
    stream = s;
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    ctx = new Ctx();
    const an = ctx.createAnalyser();
    an.fftSize = 512;
    ctx.createMediaStreamSource(s).connect(an);
    const buf = new Uint8Array(an.fftSize);
    const tick = () => {
      if (stopped) return;
      an.getByteTimeDomainData(buf);
      let sum = 0;
      for (const b of buf) { const x = (b - 128) / 128; sum += x * x; }
      const rms = Math.sqrt(sum / buf.length);
      if (rms > 0.015) pulseLevel(Math.min(1, rms * 6));
      raf = requestAnimationFrame(tick);
    };
    tick();
  }).catch(() => { if (meter === me) meter = null; });
  return () => me.stop();
}

/** Lo que esté escuchando ahora (una sola cosa a la vez). */
let active: { cancel: () => void } | null = null;

export function stopListening() {
  const a = active;
  active = null;
  a?.cancel();
}

// ---------------------------------------------------------------------------------------------
// Computador: escuchar «a dos voces»

export type Capture = {
  /** Lo que dijo la persona (lecturas posibles, la primera es la más probable); [] si no dijo nada. */
  result: Promise<string[]>;
  /** REM terminó de hablar: desde ya todo lo que se oiga es de la persona (y empieza a contar el silencio). */
  listening(): void;
  /** ¿La persona ya empezó a hablar? */
  started(): boolean;
  cancel(): void;
};

/**
 * Escucha una frase completa. Con `echo` (lo que REM está diciendo) empieza mientras REM habla:
 * apenas la persona habla, llama `onUserStart` (para callar a REM). La frase termina tras un silencio.
 */
export function capture(opts: { echo?: string; onUserStart?: () => void; onInterim?: (text: string) => void; noSpeechMs?: number } = {}): Capture {
  const Ctor = ctor();
  stopListening();
  stopWake();
  const echo = opts.echo ?? "";
  let speaking = Boolean(echo);
  // Lo que empezó a oírse mientras REM hablaba, o hasta 1,8 s después (el reconocedor entrega tarde), se revisa:
  // si es REM oyéndose por el parlante, se descarta.
  let echoUntil = speaking ? Number.POSITIVE_INFINITY : 0;
  let startedDuringSpeech = false;
  let listenCalled = false;
  let echoCount = 0;
  let started = false;
  let finished = false;
  let kept: string[][] = []; // frases ya cerradas de sesiones anteriores (Chrome corta cada tanto)
  let finals: string[][] = [];
  let interim = "";
  let rec: Recognition | null = null;
  let silence = 0;
  let noSpeech = 0;
  let hardStop = 0;
  let resolveFn: (v: string[]) => void = () => {};
  let rejectFn: (e: VoiceError) => void = () => {};
  const result = new Promise<string[]>((res, rej) => { resolveFn = res; rejectFn = rej; });

  const segs = () => [...kept, ...finals];
  const textNow = () => [...segs().map((s) => s[0]), interim].filter(Boolean).join(" ").trim();
  const clearTimers = () => { window.clearTimeout(silence); window.clearTimeout(noSpeech); window.clearTimeout(hardStop); };

  function finish() {
    if (finished) return;
    finished = true;
    clearTimers();
    try { rec?.abort(); } catch { /* ya paró */ }
    if (active === handle) active = null;
    const best = textNow();
    if (!best) return resolveFn([]);
    const alts = [best];
    const all = segs();
    const last = all.at(-1);
    if (last && last.length > 1 && !interim) {
      const head = all.slice(0, -1).map((s) => s[0]).join(" ");
      last.slice(1).forEach((a) => alts.push(`${head} ${a}`.trim()));
    }
    resolveFn([...new Set(alts)]);
  }
  function fail(e: VoiceError) {
    if (finished) return;
    finished = true;
    clearTimers();
    try { rec?.abort(); } catch { /* ya paró */ }
    if (active === handle) active = null;
    rejectFn(e);
  }

  function begin() {
    if (finished || !Ctor) return;
    const r = new Ctor();
    rec = r;
    r.lang = "es-CO";
    r.continuous = true;
    r.interimResults = true;
    r.maxAlternatives = 3;
    const seen: number[] = []; // cuándo empezó a oírse cada resultado de esta sesión
    const echoed = new Set<number>(); // resultados que eran su propia voz
    finals = [];
    r.onresult = (e) => {
      if (finished) return;
      const now = Date.now();
      const fin: string[][] = [];
      let inter = "";
      for (let i = 0; i < e.results.length; i++) {
        const res = e.results[i];
        if (seen[i] === undefined) seen[i] = now;
        const alts: string[] = [];
        for (let k = 0; k < res.length; k++) if (res[k]?.transcript?.trim()) alts.push(res[k].transcript.trim());
        if (!alts.length) continue;
        // Empezó mientras REM hablaba (o justo después): si es su propia voz, fuera; si trae algo más, se le quita lo de REM.
        const suspect = seen[i] < echoUntil;
        let use = alts;
        if (suspect) {
          if (isEchoOf(alts[0], echo)) {
            // Se está oyendo por el parlante: dos veces y deja de escuchar mientras habla (en esta sesión).
            if (alts[0].split(" ").length >= 3 && !echoed.has(i)) { echoed.add(i); if (++echoCount >= 2) echoBlocked = true; }
            continue;
          }
          use = alts.map((a) => stripEcho(a, echo)).filter(Boolean);
          if (!use.length) continue;
          // Mientras habla (o justo después) el parlante se mezcla y sale cualquier cosa («nos comemos»): solo vale una
          // respuesta corta clara o una frase de 3 palabras o más que casi no tenga palabras de REM.
          const n = use[0].split(" ").length;
          // Si ya se oyó por el parlante, más exigente todavía (pero sigue dejándose interrumpir).
          if (!(isQuickAnswer(use[0]) || (n >= 3 && echoRatio(use[0], echo) < (echoBlocked ? 0.25 : 0.4)))) continue;
        }
        if (res.isFinal) fin.push(use);
        else inter += `${use[0]} `;
      }
      inter = inter.trim();
      const text = [...fin.map((f) => f[0]), inter].join(" ").trim();
      if (!started) {
        if (!text) return;
        // Mientras habla: una palabra suelta puede ser ruido o su propia voz; un «sí» o «la dos» sí cuenta.
        if (speaking && text.split(" ").length < 2 && !isQuickAnswer(text)) return;
        if (speaking) startedDuringSpeech = true;
        started = true;
        window.clearTimeout(noSpeech);
        opts.onUserStart?.();
      }
      finals = fin;
      interim = inter;
      const said = textNow();
      if (said) { opts.onInterim?.(said); pulseLevel(0.55); }
      if (!speaking || startedDuringSpeech) {
        window.clearTimeout(silence);
        // Respuesta corta ya cerrada: rápido. Frase: aguanta pausas para seguir hablando.
        const ms = !interim && isQuickAnswer(said) ? 700 : interim ? 2000 : 1300;
        silence = window.setTimeout(finish, ms);
      }
    };
    r.onerror = (e) => {
      const err = errorOf(e.error);
      if (err) fail(err);
    };
    // Chrome corta la escucha cada tanto: se guarda lo oído y se sigue.
    r.onend = () => {
      kept = [...kept, ...finals];
      finals = [];
      if (!finished) window.setTimeout(begin, 120);
    };
    try { r.start(); } catch { window.setTimeout(begin, 300); }
  }

  const handle = { cancel: () => { if (finished) return; finished = true; clearTimers(); try { rec?.abort(); } catch { /* ya paró */ } resolveFn([]); } };
  active = handle;
  if (!Ctor) { finished = true; rejectFn(new VoiceError("other", "Este navegador no puede escuchar. Usa Chrome.")); }
  else begin();

  return {
    result,
    started: () => started,
    cancel: handle.cancel,
    listening() {
      if (finished || listenCalled) return;
      listenCalled = true;
      speaking = false;
      if (echo && !started) {
        // Nadie lo interrumpió: escucha en limpio desde aquí, para que lo que diga la persona no quede pegado
        // a lo que el micrófono oyó de REM (se reinicia y solo lo de los primeros 0,3 s se revisa).
        echoUntil = Date.now() + 300;
        try { rec?.abort(); } catch { /* ya paró: onend vuelve a empezar */ }
      } else if (echo) echoUntil = Date.now() + 1800;
      if (!started) noSpeech = window.setTimeout(finish, opts.noSpeechMs ?? 9000);
      else if (!interim && finals.length) { window.clearTimeout(silence); silence = window.setTimeout(finish, 1300); }
      hardStop = window.setTimeout(finish, 30_000);
    },
  };
}

// Números que la voz dice en palabras y el reconocedor puede escribir en cifras (o al revés).
const NUM_WORDS = ["cero", "uno", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve", "diez"];

function echoWordsOf(said: string): Set<string> {
  const words = normalize(spokenText(said)).split(" ").filter(Boolean);
  const out = new Set(words);
  words.forEach((w) => { const n = Number(w); if (Number.isInteger(n) && n >= 0 && n <= 10) out.add(NUM_WORDS[n]); });
  return out;
}

/** Qué parte de lo oído es lo que REM dijo (0 a 1). Con 0,5 o más, es REM oyéndose. */
export function echoRatio(heard: string, said: string): number {
  if (!said.trim()) return 0;
  const echo = echoWordsOf(said);
  const w = normalize(heard).split(" ").filter((x) => x.length > 1 || /\d/.test(x));
  if (!w.length) return 1;
  return w.filter((x) => echo.has(x)).length / w.length;
}

/**
 * ¿Lo oído era REM oyéndose por el parlante? La mitad o más son palabras de lo que dijo y quedan menos de 3 propias.
 * («a bodega principal» tras «Pedido a bodega principal…» sí; «hola soy andrea qué hacemos quiero pedir mercancía» no).
 */
export function isEchoOf(heard: string, said: string): boolean {
  if (!said.trim()) return false;
  const echo = echoWordsOf(said);
  const w = normalize(heard).split(" ").filter((x) => x.length > 1 || /\d/.test(x));
  if (!w.length) return true;
  const own = w.filter((x) => !echo.has(x)).length;
  return own / w.length <= 0.5 && own < 3;
}

/** Quita del principio lo que era la voz de REM («pedido a bodega principal quiero cinco…» → «quiero cinco…»). */
export function stripEcho(heard: string, said: string): string {
  if (!said.trim()) return heard;
  const echo = echoWordsOf(said);
  const words = heard.split(" ").filter(Boolean);
  let i = 0;
  while (i < words.length && echo.has(normalize(words[i]))) i++;
  return words.slice(i).join(" ");
}

// ---------------------------------------------------------------------------------------------
// Celular: una frase (el reconocimiento del celular cierra solo al hacer pausa)

/**
 * Escucha una frase. Devuelve las posibles lecturas (la primera es la más probable); [] si no se dijo nada.
 * `onInterim` muestra lo que va entendiendo mientras se habla. En computador usa `capture` (aguanta pausas).
 */
export function listen(opts: { onInterim?: (text: string) => void; timeoutMs?: number } = {}): Promise<string[]> {
  const Ctor = ctor();
  if (!Ctor) return Promise.reject(new VoiceError("other", "Este navegador no puede escuchar. Usa Chrome."));
  if (duplexCapable()) {
    const c = capture({ onInterim: opts.onInterim, noSpeechMs: opts.timeoutMs ?? 10_000 });
    c.listening();
    return c.result;
  }
  stopListening();
  stopWake();
  return new Promise((resolve, reject) => {
    const rec = new Ctor();
    rec.lang = "es-CO";
    rec.continuous = false;
    rec.interimResults = true;
    rec.maxAlternatives = 3;
    let alts: string[] = [];
    let settled = false;
    const done = (fn: () => void) => { if (settled) return; settled = true; window.clearTimeout(timer); if (active === handle) active = null; fn(); };
    const handle = { cancel: () => { try { rec.abort(); } catch { /* ya paró */ } done(() => resolve([])); } };
    active = handle;
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
      if (interim || alts[0]) pulseLevel(0.55);
      if (interim) opts.onInterim?.(interim);
      else if (alts[0]) opts.onInterim?.(alts[0]);
    };
    rec.onerror = (e) => {
      if (e.error === "no-speech" || e.error === "aborted") return done(() => resolve([]));
      const err = errorOf(e.error);
      done(() => reject(err ?? new VoiceError("other", `No se pudo escuchar (${e.error}).`)));
    };
    rec.onend = () => done(() => resolve(alts));
    try { rec.start(); } catch (err) { done(() => reject(new VoiceError("other", err instanceof Error ? err.message : "No se pudo escuchar."))); }
  });
}

// ---------------------------------------------------------------------------------------------
// Hablar

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

/**
 * Cómo se dice en voz alta. «REM» en mayúsculas la voz lo lee como sigla («rien») y «Rrem» como «rariem»:
 * «Rem» se lee como palabra en español (la r inicial ya suena fuerte).
 */
export function spokenText(text: string): string {
  return text.replace(/\bREM\b/g, "Rem");
}

// ---------------------------------------------------------------------------------------------
// iPhone / iPad: Safari solo deja sonar (voz y pitidos) si el sonido arranca dentro de un toque.
// Al tocar REM se «desbloquea» con una frase muda; desde ahí ya puede hablar solo.

/** ¿Es iPhone o iPad (también el iPad que se presenta como Mac)? */
export function isAppleMobile(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && (navigator.maxTouchPoints ?? 0) > 1);
}

/** ¿Está abierta como app instalada (desde la pantalla de inicio)? */
export function isInstalledApp(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia?.("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

let audioCtx: AudioContext | null = null;
let unlocked = false;

function sharedAudio(): AudioContext | null {
  if (audioCtx) return audioCtx;
  const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  audioCtx = Ctx ? new Ctx() : null;
  return audioCtx;
}

/**
 * Llamar DENTRO del toque (sin esperar nada antes): deja lista la voz y los pitidos en iPhone.
 * En los demás equipos no estorba. También precarga la voz en español.
 */
export function unlockAudio() {
  if (typeof window === "undefined") return;
  try {
    const synth = window.speechSynthesis;
    if (synth) {
      synth.resume();
      if (!unlocked) {
        const u = new SpeechSynthesisUtterance(" ");
        u.volume = 0;
        synth.speak(u);
        unlocked = true;
      }
    }
  } catch { /* sin voz */ }
  try {
    const ctx = sharedAudio();
    if (ctx && ctx.state === "suspended") void ctx.resume();
  } catch { /* sin sonido */ }
  void spanishVoice();
}

/** Dice el texto en voz alta y espera a que termine (o a que se calle con `stopSpeaking`). */
export async function speak(text: string): Promise<void> {
  if (typeof window === "undefined" || !("speechSynthesis" in window) || !text.trim()) return;
  const synth = window.speechSynthesis;
  // Safari pierde la frase si se cancela y se habla en el mismo instante: solo se cancela si algo suena.
  if (synth.speaking || synth.pending) {
    synth.cancel();
    if (isAppleMobile()) await new Promise((r) => window.setTimeout(r, 60));
  }
  synth.resume();
  // La voz ya cargada se usa sin esperar (en iPhone, esperar hace perder el permiso del toque).
  const v = voice !== undefined ? voice : await spanishVoice();
  const said = spokenText(text);
  await new Promise<void>((resolve) => {
    const u = new SpeechSynthesisUtterance(said);
    u.lang = v?.lang ?? "es-CO";
    if (v) u.voice = v;
    u.rate = 1.05;
    // Chrome a veces no avisa que terminó: tiempo máximo según el largo.
    const t = window.setTimeout(resolve, 2500 + said.length * 85);
    // La esfera «habla»: cada palabra la hace latir.
    u.onboundary = () => pulseLevel(0.75);
    u.onstart = () => pulseLevel(0.6);
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
    const ctx = sharedAudio();
    if (!ctx) return;
    if (ctx.state === "suspended") void ctx.resume();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = kind === "listen" ? 880 : 520;
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.16);
    o.connect(g).connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + 0.18);
  } catch { /* sin sonido */ }
}

// ---------------------------------------------------------------------------------------------
// «Oye REM»: escucha de fondo solo con la pantalla encendida y la pestaña a la vista.

let wake: { rec: Recognition | null; stopped: boolean } | null = null;

// Cómo suele escribir el reconocedor «Oye REM»: «oye ren», «olle rem», «oyeren», «hey Ram», «R.E.M.».
const CALL = "(?:oye|oie|olle|oyes|oiga|hoye|hey|ey|hei|ei|hola|ola|ok|okey|okay|alo|epa)";
const NAME = "(?:rem|ren|ram|rim|rhem|reem|remm|renn|frem|brem|r e m|erre e eme)";
const WAKE = [
  new RegExp(`(?:^|\\s)${CALL}\\s+${NAME}(?:\\s+(.*))?$`),
  new RegExp(`(?:^|\\s)(?:oye|olle|hey|hola)(?:rem|ren|ram)(?:\\s+(.*))?$`),
  // «REM, quiero hacer un traslado»: el nombre solo, al empezar la frase.
  /^(?:rem|r e m)(?:\s+(.*))?$/,
  // «Bueno, REM, abre los gastos»: el nombre en medio de la frase (solo las formas que no son otra palabra).
  /(?:^|\s)(?:rem|reem|rhem|remm)(?:\s+(.*))?$/,
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

/**
 * Empieza a esperar «Oye REM». Llama `onWake` con lo que se dijo después (puede venir vacío).
 * Reacciona con lo que va oyendo (no espera a que la frase se cierre, que con ruido puede tardar mucho):
 * al oír «oye REM» espera un momento a que termine la orden («…quiero hacer un traslado») y despierta.
 * `onHeard` muestra lo que oye (para revisar cómo lo escribe el reconocedor). Devuelve cómo pararla.
 */
export function startWake(onWake: (rest: string) => void, onError?: (e: VoiceError) => void, onHeard?: (text: string) => void): () => void {
  const Ctor = ctor();
  if (!Ctor) return () => {};
  stopWake();
  const me: { rec: Recognition | null; stopped: boolean } = { rec: null, stopped: false };
  wake = me;
  let fired = false;
  let pendingRest: string | null = null;
  let timer = 0;
  const fire = (rest: string) => {
    if (fired || me.stopped) return;
    fired = true;
    window.clearTimeout(timer);
    stopWake();
    onWake(rest);
  };
  const begin = () => {
    if (me.stopped) return;
    const rec = new Ctor();
    me.rec = rec;
    rec.lang = "es-CO";
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 3;
    rec.onresult = (e) => {
      const res = e.results[e.results.length - 1];
      if (!res) return;
      const text = res[0]?.transcript?.trim() ?? "";
      if (text) { onHeard?.(text); pulseLevel(0.3); }
      let rest: string | null = null;
      for (let k = 0; k < res.length && rest === null; k++) rest = wakeRest(res[k]?.transcript ?? "");
      if (rest === null) return;
      if (res.isFinal) return fire(rest);
      // Oyó «oye REM»: espera un momento por si sigue la orden.
      pendingRest = rest;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => fire(pendingRest ?? ""), 1200);
    };
    rec.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") { me.stopped = true; onError?.(new VoiceError("permission", "No hay permiso para usar el micrófono.")); }
    };
    // Chrome corta la escucha cada tanto: se vuelve a empezar mientras siga encendida.
    rec.onend = () => {
      if (pendingRest !== null && !fired) return fire(pendingRest);
      if (!me.stopped) window.setTimeout(begin, 300);
    };
    try { rec.start(); } catch { window.setTimeout(begin, 1500); }
  };
  begin();
  return () => { window.clearTimeout(timer); if (wake === me) stopWake(); else me.stopped = true; };
}

export function stopWake() {
  const w = wake;
  wake = null;
  if (!w) return;
  w.stopped = true;
  try { w.rec?.abort(); } catch { /* ya paró */ }
}
