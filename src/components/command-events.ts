// Abrir el buscador (Ctrl+K) y la lista de atajos desde cualquier botón, sin cargar el buscador completo.
// CommandPalette escucha estos eventos; vive en un archivo aparte que se descarga después de la página.
export const OPEN_PALETTE_EVENT = "remhub-open-palette";
export const OPEN_SHORTCUTS_EVENT = "remhub-open-shortcuts";

export const openCommandPalette = () => window.dispatchEvent(new Event(OPEN_PALETTE_EVENT));
export const openShortcuts = () => window.dispatchEvent(new Event(OPEN_SHORTCUTS_EVENT));
