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

// Pila: la última pantalla abierta atiende (un pedido interno abierto encima del POS);
// al cerrarse, vuelve a atender la de abajo.
const stack: RemHandler[] = [];
let handler: RemHandler | null = null;
const listeners = new Set<() => void>();

export function registerRemHandler(h: RemHandler): () => void {
  stack.push(h);
  handler = h;
  listeners.forEach((l) => l());
  return () => {
    const i = stack.lastIndexOf(h);
    if (i >= 0) stack.splice(i, 1);
    const next = stack.at(-1) ?? null;
    if (next !== handler) { handler = next; listeners.forEach((l) => l()); }
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


// ---------------------------------------------------------------------------------------------
// Retomar la conversación (p. ej. después de elegir el producto con la foto)

const resumeListeners = new Set<(r: RemReply) => void>();

/** REM vuelve a hablar con esta frase y sigue escuchando (abre el panel si estaba cerrado). */
export function resumeRem(reply: RemReply) {
  resumeListeners.forEach((l) => l(reply));
}

export function onRemResume(fn: (r: RemReply) => void): () => void {
  resumeListeners.add(fn);
  return () => { resumeListeners.delete(fn); };
}

/**
 * Abre la búsqueda por foto de la pantalla: el botón 📷 marcado con `data-rem-photo`
 * (el primero visible). false si la pantalla no tiene.
 */
export function clickRemPhoto(): boolean {
  const all = [...document.querySelectorAll<HTMLElement>("[data-rem-photo] button, button[data-rem-photo]")];
  const btn = all.find((b) => b.offsetParent !== null && !(b as HTMLButtonElement).disabled) ?? null;
  if (!btn) return false;
  btn.click();
  return true;
}
