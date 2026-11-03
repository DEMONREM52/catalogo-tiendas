"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { Monitor, Moon, Sun } from "lucide-react";

type ColorMode = "system" | "light" | "dark";

const STORAGE_KEY = "remhub-color-mode";

function readColorMode(): ColorMode {
  const saved = localStorage.getItem(STORAGE_KEY);
  return saved === "light" || saved === "dark" ? saved : "system";
}

function subscribeColorMode(onChange: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) onChange();
  };
  const onModeChange = () => onChange();
  const onSystemChange = () => {
    if (readColorMode() === "system") setColorMode("system");
  };
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  window.addEventListener("storage", onStorage);
  window.addEventListener("remhub-color-mode-change", onModeChange);
  media.addEventListener("change", onSystemChange);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener("remhub-color-mode-change", onModeChange);
    media.removeEventListener("change", onSystemChange);
  };
}

function setColorMode(mode: ColorMode) {
  const root = document.documentElement;
  root.dataset.themeChoice = mode;
  if (mode === "system") {
    root.removeAttribute("data-theme");
    root.classList.toggle("dark", window.matchMedia("(prefers-color-scheme: dark)").matches);
    return;
  }
  root.dataset.theme = mode;
  root.classList.toggle("dark", mode === "dark");
}

const GLASS_KEY = "remhub-glass";

/** Efecto vidrio del panel: encendido salvo que la persona lo apague (se guarda en este navegador). */
function readGlass(): boolean {
  try { return localStorage.getItem(GLASS_KEY) !== "off"; } catch { return true; }
}

function subscribeGlass(onChange: () => void) {
  const onStorage = (event: StorageEvent) => { if (event.key === GLASS_KEY) onChange(); };
  window.addEventListener("storage", onStorage);
  window.addEventListener("remhub-glass-change", onChange);
  return () => { window.removeEventListener("storage", onStorage); window.removeEventListener("remhub-glass-change", onChange); };
}

export function ThemeControl() {
  const mode = useSyncExternalStore(subscribeColorMode, readColorMode, (): ColorMode => "system");
  const glass = useSyncExternalStore(subscribeGlass, readGlass, () => true);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setColorMode(mode);
  }, [mode]);

  useEffect(() => {
    document.documentElement.dataset.glass = glass ? "on" : "off";
  }, [glass]);

  function toggleGlass() {
    try { localStorage.setItem(GLASS_KEY, glass ? "off" : "on"); } catch { /* sin almacenamiento */ }
    window.dispatchEvent(new Event("remhub-glass-change"));
  }

  function choose(nextMode: ColorMode) {
    localStorage.setItem(STORAGE_KEY, nextMode);
    window.dispatchEvent(new Event("remhub-color-mode-change"));
    setColorMode(nextMode);
    setOpen(false);
  }

  const Icon = mode === "light" ? Sun : mode === "dark" ? Moon : Monitor;

  return (
    <div className="theme-control fixed bottom-4 left-4 z-[80]">
      <button
        type="button"
        className="theme-control-trigger inline-flex h-11 items-center gap-2 rounded-full border px-3 shadow-lg backdrop-blur-xl transition hover:scale-[1.02]"
        aria-label="Cambiar apariencia"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="theme-control-logo grid h-7 w-7 place-items-center rounded-full bg-gradient-to-br from-fuchsia-500 to-violet-600 text-white shadow-sm">
          <Icon size={15} />
        </span>
        <span className="hidden text-xs font-bold sm:inline">
          {mode === "system" ? "Sistema" : mode === "light" ? "Claro" : "Oscuro"}
        </span>
      </button>
      {open ? (
        <div className="theme-control-menu mt-2 w-44 overflow-hidden rounded-2xl border p-1 shadow-2xl backdrop-blur-2xl">
          {([
            ["system", "Sistema", Monitor],
            ["light", "Claro", Sun],
            ["dark", "Oscuro", Moon],
          ] as const).map(([value, label, OptionIcon]) => (
            <button
              key={value}
              type="button"
              onClick={() => choose(value)}
              className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-semibold transition hover:bg-fuchsia-500/10"
              aria-pressed={mode === value}
            >
              <OptionIcon size={16} className="text-fuchsia-600 dark:text-fuchsia-300" />
              {label}
              {mode === value ? <span className="ml-auto text-fuchsia-600">✓</span> : null}
            </button>
          ))}
          <div className="my-1 h-px" style={{ background: "var(--t-card-border)" }} />
          <button
            type="button"
            role="switch"
            aria-checked={glass}
            onClick={toggleGlass}
            title="Tarjetas y ventanas transparentes, como vidrio (solo en el panel)"
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-semibold transition hover:bg-fuchsia-500/10"
          >
            <span aria-hidden>✨</span>
            Vidrio
            <span className="ml-auto inline-flex h-5 w-9 items-center rounded-full p-0.5 transition" style={{ background: glass ? "#a855f7" : "var(--t-card-border)" }}>
              <span className="h-4 w-4 rounded-full bg-white shadow transition" style={{ transform: glass ? "translateX(16px)" : "none" }} />
            </span>
          </button>
        </div>
      ) : null}
    </div>
  );
}
