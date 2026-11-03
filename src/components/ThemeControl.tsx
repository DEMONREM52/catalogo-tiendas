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
const BG_KEY = "remhub-bg-anim";
const PREF_EVENT = "remhub-appearance-change";

/** Preferencias de apariencia del panel (encendidas salvo que la persona las apague; se guardan en este navegador). */
function readPref(key: string): boolean {
  try { return localStorage.getItem(key) !== "off"; } catch { return true; }
}

function subscribePref(onChange: () => void) {
  const onStorage = (event: StorageEvent) => { if (event.key === GLASS_KEY || event.key === BG_KEY) onChange(); };
  window.addEventListener("storage", onStorage);
  window.addEventListener(PREF_EVENT, onChange);
  return () => { window.removeEventListener("storage", onStorage); window.removeEventListener(PREF_EVENT, onChange); };
}

function setPref(key: string, on: boolean) {
  try { localStorage.setItem(key, on ? "on" : "off"); } catch { /* sin almacenamiento */ }
  window.dispatchEvent(new Event(PREF_EVENT));
}

/** ¿Va el fondo animado? (Apariencia → Fondo animado). */
export function useAnimatedBackground() {
  return useSyncExternalStore(subscribePref, () => readPref(BG_KEY), () => false);
}

export function ThemeControl() {
  const mode = useSyncExternalStore(subscribeColorMode, readColorMode, (): ColorMode => "system");
  const glass = useSyncExternalStore(subscribePref, () => readPref(GLASS_KEY), () => true);
  const animated = useAnimatedBackground();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setColorMode(mode);
  }, [mode]);

  useEffect(() => {
    document.documentElement.dataset.glass = glass ? "on" : "off";
  }, [glass]);

  const toggleGlass = () => setPref(GLASS_KEY, !glass);

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
        <div className="theme-control-menu mt-2 w-52 overflow-hidden rounded-2xl border p-1 shadow-2xl backdrop-blur-2xl">
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
          <PrefSwitch icon="✨" label="Vidrio" title="Tarjetas y ventanas transparentes, como vidrio (solo en el panel)" on={glass} onToggle={toggleGlass} />
          <PrefSwitch icon="🌌" label="Fondo animado" title="La red con pulsos y la luz que sigue al mouse, como en la página principal (solo en el panel)" on={animated} onToggle={() => setPref(BG_KEY, !animated)} />
        </div>
      ) : null}
    </div>
  );
}

function PrefSwitch({ icon, label, title, on, onToggle }: { icon: string; label: string; title: string; on: boolean; onToggle: () => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} onClick={onToggle} title={title}
      className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-semibold transition hover:bg-fuchsia-500/10">
      <span aria-hidden>{icon}</span>
      {label}
      <span className="ml-auto inline-flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition" style={{ background: on ? "#a855f7" : "var(--t-card-border)" }}>
        <span className="h-4 w-4 rounded-full bg-white shadow transition" style={{ transform: on ? "translateX(16px)" : "none" }} />
      </span>
    </button>
  );
}
