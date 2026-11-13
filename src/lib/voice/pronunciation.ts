/**
 * Cómo se pronuncian en voz alta los nombres propios (solo la voz: el texto en pantalla no cambia nunca).
 *
 * REM habla con la voz del navegador (Web Speech API, `speechSynthesis`). Ese motor no admite SSML ni fonemas
 * (Chrome y Safari leen o ignoran las etiquetas), así que la pronunciación se arregla cambiando solo el texto
 * que se le entrega a la voz. Cada equipo trae voces distintas: la opción por defecto es la que suena en español
 * en la mayoría, y en «¿Qué le puedo decir?» se pueden oír las otras y elegir la que mejor suene en ese equipo.
 *
 * Para agregar otro nombre: una entrada más en PRONUNCIATIONS (id, cómo se reconoce y las formas de decirlo).
 */

export type Pronunciation = {
  id: string;
  /** Cómo se ve escrito (para la configuración). */
  label: string;
  /** Qué palabra cambia: palabra completa, en mayúsculas o minúsculas. */
  match: RegExp;
  /** Formas de escribirlo para la voz; la primera es la de siempre. */
  options: string[];
};

/** Palabra completa (las letras con tilde o ñ cuentan como parte de la palabra: «remá», «remó» no cambian). */
const word = (w: string) => new RegExp(`(?<![\\p{L}\\p{N}])${w}(?![\\p{L}\\p{N}])`, "giu");

export const PRONUNCIATIONS: Pronunciation[] = [
  {
    id: "rem",
    label: "REM",
    match: word("rem"),
    // Solo formas sin tilde ni mayúsculas raras: «Rém» con tilde la voz del iPhone lo deletreaba («R, E con acento agudo, M»).
    // «rem» en minúscula se lee como palabra española de una sílaba (/rem/). «Rhem» y «Remm» suenan igual en español
    // (la h no suena, la doble m tampoco) y sirven de reserva si alguna voz insiste en deletrear.
    // «REM» en mayúsculas se leía como sigla («rien»), y «Rrem» como «rariem».
    options: ["rem", "Rem", "Rhem", "Remm"],
  },
];

const KEY = "remhub:voice-pron";

function readChoices(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(KEY) ?? "{}") as Record<string, string>; } catch { return {}; }
}

/** La forma elegida en este equipo (o la de siempre). */
export function pronunciationChoice(id: string): string {
  const p = PRONUNCIATIONS.find((x) => x.id === id);
  if (!p) return "";
  const chosen = typeof localStorage === "undefined" ? undefined : readChoices()[id];
  return chosen && p.options.includes(chosen) ? chosen : p.options[0];
}

export function setPronunciationChoice(id: string, value: string) {
  try {
    const all = readChoices();
    all[id] = value;
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch { /* sin almacenamiento */ }
}

/** El texto tal como se le da a la voz. `choose` permite probar una forma sin guardarla. */
export function applyPronunciations(text: string, choose: (p: Pronunciation) => string = (p) => pronunciationChoice(p.id)): string {
  let out = text;
  for (const p of PRONUNCIATIONS) out = out.replace(p.match, choose(p));
  return out;
}
