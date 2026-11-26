/**
 * Revisión periódica que no le pide a la base más de lo necesario.
 *
 * Por qué existe (auditoría 2026-11-26, pg_stat_statements de producción): las revisiones automáticas del panel
 * (avisos, pedidos internos, mensajes, precios por autorizar) eran lo más llamado de la base, y cada vez que la
 * ventana recuperaba el foco (cerrar la ventana de imprimir, volver de WhatsApp) salían ~20 consultas a la vez.
 *
 * Reglas:
 * - Solo revisa con la pestaña a la vista. Una pestaña oculta no gasta; al volver a ella revisa.
 * - Al recuperar el foco o volver a la pestaña revisa, pero como mucho una vez cada `minGap` ms.
 * - El reloj de respaldo (`every`) se salta su turno si hubo una revisión hace poco (por ejemplo por un evento
 *   en vivo): entre dos revisiones nunca pasa más de 1,5 × `every` con la pestaña a la vista.
 * - `run()` revisa ya (eventos en vivo, acciones del usuario) y `poke()` revisa solo si ya pasó `minGap`.
 * - `stop()` limpia el reloj y los eventos (va en el return del efecto).
 */
export type Poll = { run: () => void; poke: () => void; stop: () => void };

export type PollEnv = {
  now: () => number;
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (id: unknown) => void;
  setInterval: (fn: () => void, ms: number) => unknown;
  clearInterval: (id: unknown) => void;
  visible: () => boolean;
  /** Avisa al recuperar el foco o al volver a la pestaña; devuelve cómo dejar de escuchar. */
  onReturn: (fn: () => void) => () => void;
};

export type PollOptions = {
  /** Reloj de respaldo, en ms. */
  every: number;
  /** Mínimo entre revisiones por foco o por volver a la pestaña. Por defecto, la mitad de `every` (máx. 30 s). */
  minGap?: number;
  /** Primera revisión: a los N ms; `null` = no revisar al empezar (la pantalla ya cargó por su cuenta). */
  firstDelay?: number | null;
  env?: PollEnv;
};

function browserEnv(): PollEnv {
  return {
    now: () => Date.now(),
    setTimeout: (fn, ms) => window.setTimeout(fn, ms),
    clearTimeout: (id) => window.clearTimeout(id as number),
    setInterval: (fn, ms) => window.setInterval(fn, ms),
    clearInterval: (id) => window.clearInterval(id as number),
    visible: () => document.visibilityState === "visible",
    onReturn: (fn) => {
      const onVisible = () => { if (document.visibilityState === "visible") fn(); };
      window.addEventListener("focus", fn);
      document.addEventListener("visibilitychange", onVisible);
      return () => {
        window.removeEventListener("focus", fn);
        document.removeEventListener("visibilitychange", onVisible);
      };
    },
  };
}

export function startPoll(fn: () => unknown, opts: PollOptions): Poll {
  const env = opts.env ?? browserEnv();
  const every = Math.max(1000, opts.every);
  const minGap = Math.max(0, opts.minGap ?? Math.min(every / 2, 30_000));
  let last = -Infinity;
  let stopped = false;

  const run = () => {
    if (stopped) return;
    last = env.now();
    try {
      const out = fn();
      if (out && typeof (out as Promise<unknown>).catch === "function") (out as Promise<unknown>).catch(() => undefined);
    } catch { /* una revisión que falla no detiene las siguientes */ }
  };
  const poke = () => { if (!stopped && env.visible() && env.now() - last >= minGap) run(); };

  const first = opts.firstDelay === null ? null : env.setTimeout(run, Math.max(0, opts.firstDelay ?? 0));
  if (opts.firstDelay === null) last = env.now();
  const timer = env.setInterval(() => { if (env.visible() && env.now() - last >= every / 2) run(); }, every);
  const off = env.onReturn(poke);

  return {
    run,
    poke,
    stop: () => {
      stopped = true;
      if (first !== null) env.clearTimeout(first);
      env.clearInterval(timer);
      off();
    },
  };
}
