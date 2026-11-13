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
