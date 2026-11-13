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
  /**
   * ¿Esta frase es de la pantalla? («muéstrame solo los agotados» en Productos). Si dice que sí, REM no la toma
   * como «ir a otra página» y se la pasa a la pantalla.
   */
  claims?: (text: string) => boolean;
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

/**
 * Espera a que una pantalla se registre (tras navegar). Con `title`, solo sirve esa pantalla
 * (la que estaba abierta antes de navegar no cuenta). null si no llega a tiempo.
 */
export function waitForRemHandler(ms = 8000, title?: string): Promise<RemHandler | null> {
  const ok = () => (handler && (!title || handler.title === title) ? handler : null);
  if (ok()) return Promise.resolve(ok());
  return new Promise((resolve) => {
    const t = window.setTimeout(() => { off(); resolve(ok()); }, ms);
    const off = onRemHandlerChange(() => { const h = ok(); if (h) { window.clearTimeout(t); off(); resolve(h); } });
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

// ---------------------------------------------------------------------------------------------
// Llamar a REM desde un botón dentro de una ventana (que tapa el botón del encabezado)

const callListeners = new Set<() => void>();

/** Abre REM y empieza a escuchar, como si se tocara el botón del encabezado. */
export function callRem() {
  callListeners.forEach((l) => l());
}

export function onRemCall(fn: () => void): () => void {
  callListeners.add(fn);
  return () => { callListeners.delete(fn); };
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
