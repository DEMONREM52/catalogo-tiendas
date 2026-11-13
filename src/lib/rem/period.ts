/**
 * Fechas dichas en voz: «hoy», «ayer», «antier», «el lunes», «hace tres días», «el 5 de noviembre», «5/11».
 * Siempre con la fecha de Colombia (America/Bogota), igual que los informes de la base.
 */

export type Period = {
  /** YYYY-MM-DD (Colombia). */
  day: string;
  /** Días antes de hoy (0 = hoy). Negativo = futuro. */
  ago: number;
  /** Cómo decirlo: «hoy», «ayer», «el lunes 10 de noviembre». */
  label: string;
};

const TZ = "America/Bogota";
const WEEK = ["domingo", "lunes", "martes", "miercoles", "jueves", "viernes", "sabado"];
const WEEK_SAY = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const SMALL: Record<string, number> = { un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, quince: 15, veinte: 20, treinta: 30 };

/** Hoy en Colombia, como fecha UTC a medianoche (para contar días sin líos de zona horaria). */
export function bogotaToday(now: Date): Date {
  const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  return new Date(`${ymd}T00:00:00Z`);
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86400000);

export function periodOf(day: Date, today: Date): Period {
  const ago = Math.round((today.getTime() - day.getTime()) / 86400000);
  const label = ago === 0 ? "hoy" : ago === 1 ? "ayer" : ago === 2 ? "antier"
    : `el ${WEEK_SAY[day.getUTCDay()]} ${day.getUTCDate()} de ${MONTHS[day.getUTCMonth()]}${day.getUTCFullYear() !== today.getUTCFullYear() ? ` de ${day.getUTCFullYear()}` : ""}`;
  return { day: iso(day), ago, label };
}

/** La fecha que se dijo (texto ya sin tildes ni mayúsculas). null si no se dijo ninguna. */
export function parsePeriod(text: string, now = new Date()): Period | null {
  const t = ` ${text} `;
  const today = bogotaToday(now);
  const at = (n: number) => periodOf(addDays(today, -n), today);

  if (/\b(?:antier|anteayer|antes de ayer|antes de anoche)\b/.test(t)) return at(2);
  if (/\b(?:ayer|anoche)\b/.test(t)) return at(1);
  if (/\b(?:hoy|el dia de hoy|en el dia|del dia|esta manana|esta tarde|esta noche|en lo que va del dia)\b/.test(t)) return at(0);

  const ago = t.match(/\bhace (\d{1,2}|[a-z]+) dias?\b/);
  if (ago) {
    const n = /^\d+$/.test(ago[1]) ? Number(ago[1]) : SMALL[ago[1]];
    if (n && n <= 366) return at(n);
  }

  const wd = t.match(/\b(?:el |este |el pasado )?(domingo|lunes|martes|miercoles|jueves|viernes|sabado)( pasado)?\b/);
  if (wd) {
    const target = WEEK.indexOf(wd[1]);
    let back = (today.getUTCDay() - target + 7) % 7;
    if (back === 0 && (wd[2] || /\bel pasado\b/.test(wd[0]))) back = 7;
    return at(back);
  }

  const named = t.match(/\b(?:el )?(\d{1,2}|primero) de (enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)(?: (?:de |del )?(\d{4}))?\b/);
  if (named) {
    const d = named[1] === "primero" ? 1 : Number(named[1]);
    const m = named[2] === "setiembre" ? 8 : MONTHS.indexOf(named[2]);
    return fromParts(d, m, named[3] ? Number(named[3]) : null, today);
  }

  const slash = t.match(/\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/);
  if (slash) {
    const y = slash[3] ? Number(slash[3].length === 2 ? `20${slash[3]}` : slash[3]) : null;
    return fromParts(Number(slash[1]), Number(slash[2]) - 1, y, today);
  }
  return null;
}

/** Día y mes (y año si se dijo). Sin año: el más reciente que ya pasó. */
function fromParts(d: number, m: number, y: number | null, today: Date): Period | null {
  if (m < 0 || m > 11 || d < 1 || d > 31) return null;
  let year = y ?? today.getUTCFullYear();
  let date = new Date(Date.UTC(year, m, d));
  if (date.getUTCMonth() !== m) return null; // 31 de noviembre
  if (!y && date > today) { year -= 1; date = new Date(Date.UTC(year, m, d)); }
  return periodOf(date, today);
}

// ---------------------------------------------------------------------------------------------
// Rangos: «este mes», «el mes pasado», «esta semana», «la semana pasada», «en octubre», «este año».

export type Range = { from: string; to: string; label: string; days: number };

const MONTH_RE = "enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre";

/** El rango que se dijo. Un día suelto («ayer», «el lunes») también sirve, como rango de un día. null si no se dijo nada. */
export function parseRange(text: string, now = new Date()): Range | null {
  const t = ` ${text} `;
  const today = bogotaToday(now);
  const y = today.getUTCFullYear();
  const m = today.getUTCMonth();
  const make = (from: Date, to: Date, label: string): Range => ({
    from: iso(from), to: iso(to), label, days: Math.round((to.getTime() - from.getTime()) / 86400000) + 1,
  });
  if (/\b(?:el mes pasado|mes anterior|el otro mes pasado)\b/.test(t)) {
    return make(new Date(Date.UTC(y, m - 1, 1)), new Date(Date.UTC(y, m, 0)), `en ${MONTHS[(m + 11) % 12]}`);
  }
  if (/\b(?:este mes|del mes|en el mes|lo que va del mes|en lo que va del mes|el mes)\b/.test(t)) {
    return make(new Date(Date.UTC(y, m, 1)), today, "este mes");
  }
  if (/\b(?:la semana pasada|semana anterior)\b/.test(t)) {
    const back = (today.getUTCDay() + 6) % 7; // días desde el lunes
    const monday = addDays(today, -back - 7);
    return make(monday, addDays(monday, 6), "la semana pasada");
  }
  if (/\b(?:esta semana|la semana|en la semana|de la semana)\b/.test(t)) {
    return make(addDays(today, -((today.getUTCDay() + 6) % 7)), today, "esta semana");
  }
  if (/\b(?:este ano|en el ano|del ano|lo que va del ano)\b/.test(t)) {
    return make(new Date(Date.UTC(y, 0, 1)), today, `en ${y}`);
  }
  const mo = t.match(new RegExp(`\\b(?:en|de|del mes de|durante) (${MONTH_RE})(?: (?:de |del )?(\\d{4}))?\\b`));
  if (mo && !new RegExp(`\\b\\d{1,2} de (?:${MONTH_RE})\\b`).test(t) && !/\bprimero de\b/.test(t)) {
    const idx = mo[1] === "setiembre" ? 8 : MONTHS.indexOf(mo[1]);
    let year = mo[2] ? Number(mo[2]) : y;
    if (!mo[2] && idx > m) year -= 1;
    const last = new Date(Date.UTC(year, idx + 1, 0));
    return make(new Date(Date.UTC(year, idx, 1)), last > today ? today : last, `en ${MONTHS[idx]}${year !== y ? ` de ${year}` : ""}`);
  }
  const d = parsePeriod(text, now);
  if (d) { const day = new Date(`${d.day}T00:00:00Z`); return make(day, day, d.label); }
  return null;
}
