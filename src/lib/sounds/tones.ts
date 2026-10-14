/**
 * 50 tonos de notificación creados con el sintetizador del navegador (Web Audio).
 * No se descarga ningún archivo: pesan 0 KB, no tienen derechos de autor y suenan igual en todos los equipos.
 */

type Voice = "sine" | "triangle" | "square" | "sawtooth" | "bell" | "marimba" | "pluck" | "glass" | "noise";
/** [nota o frecuencia, inicio (s), duración (s), voz, volumen 0-1, desliza hasta (nota/frecuencia)] */
type Step = [string | number, number, number, Voice?, number?, (string | number)?];

export type ToneCategory = "Campanas" | "Marimba" | "Cristal" | "Retro" | "Burbujas" | "Naturaleza" | "Tienda" | "Timbres" | "Divertidos";
export type Tone = { id: string; name: string; emoji: string; cat: ToneCategory; steps: Step[] };

export const TONE_CATEGORIES: Array<{ cat: ToneCategory; emoji: string }> = [
  { cat: "Campanas", emoji: "🔔" },
  { cat: "Marimba", emoji: "🎵" },
  { cat: "Cristal", emoji: "💎" },
  { cat: "Retro", emoji: "👾" },
  { cat: "Burbujas", emoji: "🫧" },
  { cat: "Naturaleza", emoji: "🐦" },
  { cat: "Tienda", emoji: "🛒" },
  { cat: "Timbres", emoji: "🚪" },
  { cat: "Divertidos", emoji: "🎉" },
];

export const TONES: Tone[] = [
  // 🔔 Campanas
  { id: "campana-dorada", name: "Campana dorada", emoji: "🔔", cat: "Campanas", steps: [["E6", 0, 1.2, "bell", 0.9], ["B6", 0.14, 1.1, "bell", 0.6]] },
  { id: "campanita", name: "Campanita", emoji: "🛎️", cat: "Campanas", steps: [["A6", 0, 0.9, "bell", 0.8]] },
  { id: "doble-campana", name: "Doble campana", emoji: "🔔", cat: "Campanas", steps: [["C6", 0, 0.8, "bell"], ["C6", 0.22, 0.9, "bell", 0.7]] },
  { id: "carrillon", name: "Carrillón", emoji: "⛪", cat: "Campanas", steps: [["E5", 0, 0.9, "bell"], ["C5", 0.3, 0.9, "bell"], ["D5", 0.6, 0.9, "bell"], ["G4", 0.9, 1.3, "bell"]] },
  { id: "campana-suave", name: "Campana suave", emoji: "🌙", cat: "Campanas", steps: [["G5", 0, 1.4, "bell", 0.55]] },
  { id: "templo", name: "Templo", emoji: "🏯", cat: "Campanas", steps: [["D4", 0, 2.2, "bell", 0.9], ["A4", 0.02, 2, "bell", 0.35]] },
  { id: "navidad", name: "Navideño", emoji: "🎄", cat: "Campanas", steps: [["E6", 0, 0.3, "bell"], ["E6", 0.18, 0.3, "bell"], ["E6", 0.36, 0.6, "bell"]] },
  { id: "aviso-hotel", name: "Recepción de hotel", emoji: "🏨", cat: "Campanas", steps: [["F#6", 0, 1, "bell", 0.85], ["F#6", 0.12, 0.8, "bell", 0.5]] },

  // 🎵 Marimba
  { id: "marimba-feliz", name: "Marimba feliz", emoji: "🎵", cat: "Marimba", steps: [["C5", 0, 0.3, "marimba"], ["E5", 0.11, 0.3, "marimba"], ["G5", 0.22, 0.45, "marimba"]] },
  { id: "marimba-subida", name: "Subida", emoji: "📈", cat: "Marimba", steps: [["G4", 0, 0.25, "marimba"], ["C5", 0.09, 0.25, "marimba"], ["E5", 0.18, 0.25, "marimba"], ["G5", 0.27, 0.25, "marimba"], ["C6", 0.36, 0.5, "marimba"]] },
  { id: "marimba-pregunta", name: "¿Hola?", emoji: "❓", cat: "Marimba", steps: [["E5", 0, 0.25, "marimba"], ["A5", 0.16, 0.45, "marimba"]] },
  { id: "marimba-listo", name: "¡Listo!", emoji: "✅", cat: "Marimba", steps: [["A5", 0, 0.22, "marimba"], ["E5", 0.12, 0.22, "marimba"], ["A5", 0.24, 0.5, "marimba"]] },
  { id: "tropical", name: "Tropical", emoji: "🌴", cat: "Marimba", steps: [["D5", 0, 0.2, "marimba"], ["F#5", 0.1, 0.2, "marimba"], ["A5", 0.2, 0.2, "marimba"], ["F#5", 0.3, 0.2, "marimba"], ["D6", 0.4, 0.5, "marimba"]] },
  { id: "gotas-madera", name: "Gotas de madera", emoji: "🪵", cat: "Marimba", steps: [["B5", 0, 0.18, "marimba", 0.8], ["G5", 0.08, 0.18, "marimba", 0.7], ["E5", 0.16, 0.35, "marimba", 0.6]] },

  // 💎 Cristal
  { id: "cristal", name: "Cristal", emoji: "💎", cat: "Cristal", steps: [["C7", 0, 0.7, "glass", 0.7], ["G7", 0.07, 0.7, "glass", 0.4]] },
  { id: "brindis", name: "Brindis", emoji: "🥂", cat: "Cristal", steps: [["A6", 0, 1, "glass", 0.8], ["A6", 0.09, 0.9, "glass", 0.45]] },
  { id: "destello", name: "Destello", emoji: "✨", cat: "Cristal", steps: [["E6", 0, 0.4, "glass", 0.6], ["G#6", 0.06, 0.4, "glass", 0.55], ["B6", 0.12, 0.4, "glass", 0.5], ["E7", 0.18, 0.8, "glass", 0.45]] },
  { id: "hada", name: "Hada", emoji: "🧚", cat: "Cristal", steps: [["B6", 0, 0.3, "glass"], ["D7", 0.07, 0.3, "glass"], ["F#7", 0.14, 0.3, "glass"], ["A7", 0.21, 0.6, "glass", 0.5]] },
  { id: "copa", name: "Copa", emoji: "🍷", cat: "Cristal", steps: [["D7", 0, 1.3, "glass", 0.6]] },

  // 👾 Retro
  { id: "moneda", name: "Moneda", emoji: "🪙", cat: "Retro", steps: [["B5", 0, 0.08, "square", 0.35], ["E6", 0.08, 0.35, "square", 0.35]] },
  { id: "power-up", name: "Power up", emoji: "🍄", cat: "Retro", steps: [["C5", 0, 0.07, "square", 0.3], ["E5", 0.07, 0.07, "square", 0.3], ["G5", 0.14, 0.07, "square", 0.3], ["C6", 0.21, 0.07, "square", 0.3], ["E6", 0.28, 0.07, "square", 0.3], ["G6", 0.35, 0.25, "square", 0.3]] },
  { id: "nivel", name: "Nivel superado", emoji: "🏆", cat: "Retro", steps: [["G5", 0, 0.12, "square", 0.3], ["C6", 0.12, 0.12, "square", 0.3], ["E6", 0.24, 0.12, "square", 0.3], ["G6", 0.36, 0.4, "square", 0.3]] },
  { id: "laser", name: "Láser", emoji: "🔫", cat: "Retro", steps: [["C7", 0, 0.3, "sawtooth", 0.22, "C5"]] },
  { id: "salto", name: "Salto", emoji: "🦘", cat: "Retro", steps: [["C5", 0, 0.22, "square", 0.3, "C6"]] },
  { id: "arcade", name: "Arcade", emoji: "🕹️", cat: "Retro", steps: [["E6", 0, 0.08, "square", 0.3], ["C6", 0.1, 0.08, "square", 0.3], ["E6", 0.2, 0.08, "square", 0.3], ["G6", 0.3, 0.25, "square", 0.3]] },
  { id: "mensaje-8bit", name: "Mensaje 8-bit", emoji: "💌", cat: "Retro", steps: [["A5", 0, 0.1, "square", 0.3], ["A6", 0.12, 0.2, "square", 0.3]] },
  { id: "robot", name: "Robot", emoji: "🤖", cat: "Retro", steps: [["G4", 0, 0.1, "sawtooth", 0.25], ["C5", 0.12, 0.1, "sawtooth", 0.25], ["G4", 0.24, 0.1, "sawtooth", 0.25], ["D5", 0.36, 0.2, "sawtooth", 0.25]] },

  // 🫧 Burbujas
  { id: "burbuja", name: "Burbuja", emoji: "🫧", cat: "Burbujas", steps: [["C5", 0, 0.14, "sine", 0.8, "C6"]] },
  { id: "burbujas", name: "Burbujas", emoji: "🫧", cat: "Burbujas", steps: [["D5", 0, 0.12, "sine", 0.7, "D6"], ["G5", 0.14, 0.12, "sine", 0.6, "G6"], ["C6", 0.28, 0.14, "sine", 0.55, "C7"]] },
  { id: "gota", name: "Gota de agua", emoji: "💧", cat: "Burbujas", steps: [["A6", 0, 0.16, "sine", 0.8, "A5"]] },
  { id: "pop", name: "Pop", emoji: "🍿", cat: "Burbujas", steps: [["G4", 0, 0.08, "sine", 0.9, "G5"], [0, 0.02, 0.05, "noise", 0.15]] },
  { id: "pecera", name: "Pecera", emoji: "🐠", cat: "Burbujas", steps: [["E5", 0, 0.1, "sine", 0.5, "E6"], ["B5", 0.1, 0.1, "sine", 0.45, "B6"], ["E5", 0.24, 0.1, "sine", 0.4, "E6"]] },

  // 🐦 Naturaleza
  { id: "pajarito", name: "Pajarito", emoji: "🐦", cat: "Naturaleza", steps: [["E7", 0, 0.08, "sine", 0.5, "B7"], ["E7", 0.12, 0.08, "sine", 0.5, "B7"]] },
  { id: "grillo", name: "Grillo", emoji: "🦗", cat: "Naturaleza", steps: [["G7", 0, 0.04, "triangle", 0.35], ["G7", 0.07, 0.04, "triangle", 0.35], ["G7", 0.14, 0.04, "triangle", 0.35], ["G7", 0.35, 0.04, "triangle", 0.35], ["G7", 0.42, 0.04, "triangle", 0.35]] },
  { id: "viento", name: "Viento", emoji: "🍃", cat: "Naturaleza", steps: [[0, 0, 0.6, "noise", 0.12], ["A5", 0, 0.7, "sine", 0.25, "E6"]] },
  { id: "buho", name: "Búho", emoji: "🦉", cat: "Naturaleza", steps: [["A4", 0, 0.3, "sine", 0.7, "G4"], ["A4", 0.4, 0.5, "sine", 0.7, "F4"]] },

  // 🛒 Tienda
  { id: "caja-registradora", name: "Caja registradora", emoji: "💰", cat: "Tienda", steps: [[0, 0, 0.05, "noise", 0.35], ["C7", 0.05, 0.6, "bell", 0.7], ["G7", 0.08, 0.5, "bell", 0.4]] },
  { id: "venta", name: "¡Venta!", emoji: "🤑", cat: "Tienda", steps: [["E6", 0, 0.15, "bell"], ["A6", 0.12, 0.6, "bell"]] },
  { id: "escaner", name: "Escáner", emoji: "📟", cat: "Tienda", steps: [["A6", 0, 0.12, "square", 0.25]] },
  { id: "paquete", name: "Paquete listo", emoji: "📦", cat: "Tienda", steps: [["C5", 0, 0.12, "pluck"], ["G5", 0.1, 0.12, "pluck"], ["C6", 0.2, 0.35, "pluck"]] },

  // 🚪 Timbres
  { id: "ding-dong", name: "Ding dong", emoji: "🚪", cat: "Timbres", steps: [["E5", 0, 0.8, "bell"], ["C5", 0.45, 1.1, "bell"]] },
  { id: "timbre-largo", name: "Timbre de casa", emoji: "🏠", cat: "Timbres", steps: [["G5", 0, 0.6, "bell"], ["E5", 0.35, 0.6, "bell"], ["C5", 0.7, 1, "bell"]] },
  { id: "intercomunicador", name: "Intercomunicador", emoji: "📞", cat: "Timbres", steps: [["A5", 0, 0.15, "sine", 0.5], ["E6", 0.18, 0.15, "sine", 0.5], ["A5", 0.36, 0.15, "sine", 0.5], ["E6", 0.54, 0.15, "sine", 0.5]] },
  { id: "aeropuerto", name: "Aeropuerto", emoji: "✈️", cat: "Timbres", steps: [["C5", 0, 0.6, "bell", 0.6], ["E5", 0.3, 0.6, "bell", 0.6], ["G5", 0.6, 0.9, "bell", 0.6]] },

  // 🎉 Divertidos
  { id: "boing", name: "Boing", emoji: "🤸", cat: "Divertidos", steps: [["C4", 0, 0.4, "triangle", 0.7, "C6"], ["C6", 0.4, 0.2, "triangle", 0.5, "G5"]] },
  { id: "wow", name: "Wooow", emoji: "😮", cat: "Divertidos", steps: [["C5", 0, 0.5, "sawtooth", 0.18, "G5"], ["G5", 0.5, 0.3, "sawtooth", 0.18, "E5"]] },
  { id: "fiesta", name: "¡Fiesta!", emoji: "🎉", cat: "Divertidos", steps: [["C6", 0, 0.1, "marimba"], ["E6", 0.08, 0.1, "marimba"], ["G6", 0.16, 0.1, "marimba"], ["C7", 0.24, 0.1, "marimba"], [0, 0.3, 0.2, "noise", 0.12], ["C7", 0.34, 0.5, "glass", 0.5]] },
  { id: "sapo", name: "Sapito", emoji: "🐸", cat: "Divertidos", steps: [["G3", 0, 0.12, "square", 0.25, "C4"], ["G3", 0.2, 0.12, "square", 0.25, "C4"]] },
  { id: "silbido", name: "Silbido", emoji: "😗", cat: "Divertidos", steps: [["G6", 0, 0.25, "sine", 0.45, "D7"], ["D7", 0.3, 0.35, "sine", 0.45, "G6"]] },
  { id: "tadaa", name: "¡Tadaa!", emoji: "🥳", cat: "Divertidos", steps: [["G4", 0, 0.12, "sawtooth", 0.2], ["C5", 0.14, 0.6, "sawtooth", 0.2], ["E5", 0.14, 0.6, "sawtooth", 0.15], ["G5", 0.14, 0.6, "sawtooth", 0.12]] },
];

export const TONE_BY_ID = new Map(TONES.map((t) => [t.id, t]));
export const SILENT = "silencio";

const NOTE: Record<string, number> = { C: -9, "C#": -8, D: -7, "D#": -6, E: -5, F: -4, "F#": -3, G: -2, "G#": -1, A: 0, "A#": 1, B: 2 };
function freq(n: string | number) {
  if (typeof n === "number") return n;
  const m = n.match(/^([A-G]#?)(\d)$/);
  if (!m) return 440;
  return 440 * Math.pow(2, (NOTE[m[1]] + (Number(m[2]) - 4) * 12) / 12);
}

let ctx: AudioContext | null = null;
let noiseBuffer: AudioBuffer | null = null;

function audio() {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const AC = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === "suspended") void ctx.resume().catch(() => undefined);
  return ctx;
}

/**
 * Los celulares solo dejan sonar después de que la persona toca la pantalla.
 * Se llama una vez: al primer toque o tecla, el sonido queda habilitado para el resto de la visita.
 */
export function unlockAudioOnFirstTouch() {
  if (typeof window === "undefined") return;
  const unlock = () => {
    const c = audio();
    if (c) {
      const b = c.createBuffer(1, 1, 22050);
      const s = c.createBufferSource();
      s.buffer = b;
      s.connect(c.destination);
      s.start(0);
    }
    window.removeEventListener("pointerdown", unlock);
    window.removeEventListener("keydown", unlock);
  };
  window.addEventListener("pointerdown", unlock, { once: true });
  window.addEventListener("keydown", unlock, { once: true });
}

function voice(c: AudioContext, out: AudioNode, step: Step, t0: number) {
  const [note, start, dur, kind = "sine", vol = 0.8, glide] = step;
  const at = t0 + start;
  const g = c.createGain();
  g.connect(out);
  const peak = Math.max(0.0001, vol * 0.5);
  if (kind === "noise") {
    if (!noiseBuffer) {
      noiseBuffer = c.createBuffer(1, c.sampleRate * 1, c.sampleRate);
      const d = noiseBuffer.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    const src = c.createBufferSource();
    src.buffer = noiseBuffer;
    const hp = c.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 3000;
    src.connect(hp).connect(g);
    g.gain.setValueAtTime(peak, at);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    src.start(at);
    src.stop(at + dur + 0.05);
    return;
  }
  const partials: Array<[number, number, OscillatorType]> =
    kind === "bell" ? [[1, 1, "sine"], [2.76, 0.35, "sine"], [5.4, 0.12, "sine"]]
    : kind === "marimba" ? [[1, 1, "sine"], [4, 0.25, "sine"]]
    : kind === "glass" ? [[1, 1, "sine"], [2.32, 0.3, "sine"], [4.25, 0.12, "sine"]]
    : kind === "pluck" ? [[1, 1, "triangle"], [2, 0.3, "sine"]]
    : [[1, 1, kind as OscillatorType]];
  const decayFast = kind === "marimba" || kind === "pluck";
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(peak, at + 0.008);
  if (decayFast || kind === "bell" || kind === "glass") g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  else {
    g.gain.setValueAtTime(peak, at + Math.max(0.01, dur - 0.04));
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  }
  const f = freq(note);
  for (const [ratio, amp, type] of partials) {
    const o = c.createOscillator();
    const pg = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f * ratio, at);
    if (glide !== undefined) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq(glide) * ratio), at + dur);
    pg.gain.value = amp;
    o.connect(pg).connect(g);
    o.start(at);
    o.stop(at + dur + 0.05);
  }
}

/** Reproduce un tono (volumen 0 a 1). Devuelve false si el navegador no permite sonar todavía. */
export function playTone(id: string | null | undefined, volume = 0.8): boolean {
  if (!id || id === SILENT || volume <= 0) return false;
  const tone = TONE_BY_ID.get(id);
  const c = audio();
  if (!tone || !c) return false;
  const master = c.createGain();
  master.gain.value = Math.min(1, Math.max(0, volume));
  master.connect(c.destination);
  const t0 = c.currentTime + 0.02;
  for (const step of tone.steps) voice(c, master, step, t0);
  return c.state === "running";
}
