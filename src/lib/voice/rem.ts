/**
 * REM: quién atiende la conversación. Una pantalla que sabe trabajar por voz (por ahora, Traslados)
 * se registra aquí mientras está abierta; el botón REM del encabezado le pasa lo que se dice.
 */

export type RemReply = {
  /** Lo que REM dice en voz alta. */
  say: string;
  /** Texto en pantalla si es distinto de lo dicho. */
  show?: string;
  /** true: termina la conversación después de decirlo. */
  end?: boolean;
};

export type RemHandler = {
  /** Qué se está haciendo («Traslado»), para el panel. */
  title: string;
  /** Primera frase al empezar. `firstWords` es lo que se dijo para llegar aquí («traslado de bodega a zamora»). */
  start(firstWords?: string[]): Promise<RemReply> | RemReply;
  /** Lo que se dijo (posibles lecturas, la primera es la más probable). */
  hear(alternatives: string[]): Promise<RemReply> | RemReply;
  /** Frases de ejemplo para la ayuda del panel. */
  examples: string[];
};

let handler: RemHandler | null = null;
const listeners = new Set<() => void>();

export function registerRemHandler(h: RemHandler): () => void {
  handler = h;
  listeners.forEach((l) => l());
  return () => {
    if (handler === h) { handler = null; listeners.forEach((l) => l()); }
  };
}

export function remHandler(): RemHandler | null {
  return handler;
}

export function onRemHandlerChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** Espera a que una pantalla se registre (tras navegar). null si no llega a tiempo. */
export function waitForRemHandler(ms = 8000): Promise<RemHandler | null> {
  if (handler) return Promise.resolve(handler);
  return new Promise((resolve) => {
    const t = window.setTimeout(() => { off(); resolve(handler); }, ms);
    const off = onRemHandlerChange(() => { if (handler) { window.clearTimeout(t); off(); resolve(handler); } });
  });
}

