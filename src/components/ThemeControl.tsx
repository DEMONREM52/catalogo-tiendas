"use client";

// Apariencia (botón flotante abajo a la izquierda): temas oficiales, mis temas, efectos y personalización.
// Todo se guarda en la cuenta (src/lib/appearance/store.ts); sin sesión queda en este navegador.
import { useEffect, useState, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import dynamic from "next/dynamic";
import { Check, Monitor, Moon, Palette, Plus, Settings2, Sparkles, Sun } from "lucide-react";
import { OBSIDIAN, PEARL, swatches, type ThemeConfig } from "@/lib/appearance/theme";
import {
  activateTheme, apply, getAppearance, listThemes, resolveTheme, restoreDefaults, startAppearance, subscribeAppearance, updatePrefs,
  type Intensity, type UserTheme,
} from "@/lib/appearance/store";

// El editor solo se descarga cuando se abre.
const ThemeStudio = dynamic(() => import("./appearance/ThemeStudio").then((m) => m.ThemeStudio), { ssr: false });

const serverState = getAppearance();
export function useAppearanceState() {
  return useSyncExternalStore(subscribeAppearance, getAppearance, () => serverState);
}

/** ¿Va el fondo animado? (Apariencia → Fondo animado). */
export function useAnimatedBackground() {
  const s = useSyncExternalStore(subscribeAppearance, getAppearance, () => null);
  return s ? s.prefs.animated && !s.prefs.reducedMotion : false;
}

export type StudioOpen = { view: "manager" } | { view: "editor"; theme?: UserTheme | null; from?: ThemeConfig; name?: string };

export function ThemeControl() {
  const s = useAppearanceState();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [mine, setMine] = useState<{ items: UserTheme[]; total: number } | null>(null);
  const [studio, setStudio] = useState<StudioOpen | null>(null);

  useEffect(() => { startAppearance(); }, []);
  // El tema personal solo va en el panel: se vuelve a pintar al cambiar de página.
  useEffect(() => { apply(); }, [pathname]);
  // «Mis temas» se pide al abrir el menú (no en cada página).
  useEffect(() => {
    if (!open || !s.userId) return;
    let alive = true;
    listThemes({ limit: 6 }).then((r) => { if (alive) setMine(r); }, () => { if (alive) setMine({ items: [], total: 0 }); });
    return () => { alive = false; };
  }, [open, s.userId, s.version]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const p = s.prefs;
  const current = resolveTheme(s);
  const Icon = p.mode === "light" ? Sun : p.mode === "dark" ? Moon : p.mode === "custom" ? Palette : Monitor;
  const label = p.mode === "system" ? "Sistema" : p.mode === "light" ? "Pearl" : p.mode === "dark" ? "Obsidian" : current.label;
  const showTip = Boolean(s.userId && mine && mine.total > 2 && !p.tipDismissed);

  function openStudio(v: StudioOpen) { setOpen(false); setStudio(v); }

  return (
    <div className="theme-control fixed bottom-4 left-4 z-[80]">
      <button type="button" aria-label="Apariencia" aria-expanded={open} onClick={() => setOpen((v) => !v)}
        className="theme-control-trigger inline-flex h-11 items-center gap-2 rounded-full border px-3 shadow-lg backdrop-blur-xl transition hover:scale-[1.02]">
        <span className="theme-control-logo grid h-7 w-7 place-items-center rounded-full text-white shadow-sm" style={{ background: "linear-gradient(135deg, var(--t-accent3, #d946ef), var(--t-accent2, #8b5cf6))" }}>
          <Icon size={15} />
        </span>
        <span className="hidden max-w-32 truncate text-xs font-bold sm:inline">{label}</span>
      </button>

      {open ? (
        <>
          <button type="button" aria-label="Cerrar" className="fixed inset-0 -z-10 cursor-default" onClick={() => setOpen(false)} />
          <div role="menu" className="theme-control-menu absolute bottom-14 left-0 max-h-[min(78dvh,40rem)] w-[min(20rem,calc(100vw-2rem))] overflow-y-auto overscroll-contain rounded-3xl border p-2 shadow-2xl backdrop-blur-2xl">
            <p className="px-2 pb-1 pt-1 text-[10px] font-black uppercase tracking-[0.18em]" style={{ color: "var(--t-muted)" }}>Apariencia</p>

            <Section title="Tema oficial">
              <Option icon={<Monitor size={15} />} label="Automático" hint="Claro u oscuro según tu equipo" active={p.mode === "system"} onClick={() => void updatePrefs({ mode: "system" })} />
              <Option icon={<Dots colors={swatches(PEARL)} />} label="Pearl Amethyst" hint="Claro" active={p.mode === "light"} onClick={() => void updatePrefs({ mode: "light" })} />
              <Option icon={<Dots colors={swatches(OBSIDIAN)} />} label="Obsidian Amethyst" hint="Oscuro" active={p.mode === "dark"} onClick={() => void updatePrefs({ mode: "dark" })} />
            </Section>

            <Section title="Mis temas" action={s.userId ? <button type="button" onClick={() => openStudio({ view: "manager" })} className="text-[11px] font-bold" style={{ color: "var(--t-accent)" }}>Administrar</button> : null}>
              {!s.userId ? (
                <p className="px-2 py-1.5 text-xs" style={{ color: "var(--t-muted)" }}>Inicia sesión para crear tus temas y verlos en todos tus dispositivos.</p>
              ) : s.error === "missing" ? (
                <p className="px-2 py-1.5 text-xs" style={{ color: "var(--t-warning)" }}>Falta ejecutar la migración 20261284 en Supabase.</p>
              ) : !mine ? (
                <p className="px-2 py-1.5 text-xs" style={{ color: "var(--t-muted)" }}>Cargando…</p>
              ) : (
                <>
                  {mine.items.map((t) => (
                    <Option key={t.id} icon={<Dots colors={swatches(t.config)} />} label={t.name} hint={`${t.favorite ? "★ " : ""}${t.base_mode === "dark" ? "Oscuro" : "Claro"}`}
                      active={p.mode === "custom" && p.themeId === t.id} onClick={() => void activateTheme(t)} />
                  ))}
                  {mine.total > mine.items.length ? (
                    <button type="button" onClick={() => openStudio({ view: "manager" })} className="w-full rounded-xl px-2 py-1.5 text-left text-xs font-bold" style={{ color: "var(--t-accent)" }}>Ver los {mine.total} temas →</button>
                  ) : null}
                  <button type="button" onClick={() => openStudio({ view: "editor", from: current.custom ?? (current.base === "dark" ? OBSIDIAN : PEARL), name: "Mi tema" })}
                    className="mt-1 flex w-full items-center gap-2 rounded-xl border border-dashed px-3 py-2 text-sm font-bold transition hover:-translate-y-px"
                    style={{ borderColor: "color-mix(in oklab, var(--t-accent) 50%, transparent)", color: "var(--t-accent)" }}>
                    <Plus size={15} /> Crear tema
                  </button>
                  {showTip ? <ThemesTip onManage={() => openStudio({ view: "manager" })} /> : null}
                </>
              )}
            </Section>

            <Section title="Efectos">
              <Switch icon="✨" label="Vidrio" title="Tarjetas y ventanas como cristal (solo en el panel)" on={p.glass} onToggle={() => void updatePrefs({ glass: !p.glass })} />
              {p.glass ? (
                <div className="mx-2 mb-1.5 grid grid-cols-3 gap-1 rounded-xl border p-0.5" style={{ borderColor: "var(--t-card-border)" }} role="radiogroup" aria-label="Intensidad del vidrio">
                  {([["subtle", "Sutil"], ["elegant", "Elegante"], ["premium", "Premium"]] as Array<[Intensity, string]>).map(([k, l]) => (
                    <button key={k} type="button" role="radio" aria-checked={p.intensity === k} onClick={() => void updatePrefs({ intensity: k })}
                      className="rounded-lg px-1 py-1 text-[11px] font-bold transition"
                      style={p.intensity === k ? { background: "var(--t-accent)", color: "var(--t-on-accent, #fff)" } : { color: "var(--t-text)" }}>{l}</button>
                  ))}
                </div>
              ) : null}
              <Switch icon="🌌" label="Fondo animado" title="La red con pulsos de fondo (solo en el panel; movimiento lento)" on={p.animated} onToggle={() => void updatePrefs({ animated: !p.animated })} />
              <Switch icon="🐢" label="Reducir animaciones" title="Quita movimientos y transiciones (también lo respeta si tu equipo lo pide)" on={p.reducedMotion} onToggle={() => void updatePrefs({ reducedMotion: !p.reducedMotion })} />
            </Section>

            <div className="mt-1 grid grid-cols-2 gap-1.5 border-t px-1 pt-2" style={{ borderColor: "var(--t-card-border)" }}>
              <button type="button" disabled={!s.userId} onClick={() => openStudio({ view: "manager" })} className="inline-flex items-center justify-center gap-1.5 rounded-xl px-2 py-2 text-xs font-bold disabled:opacity-50" style={{ background: "color-mix(in oklab, var(--t-accent) 14%, transparent)", color: "var(--t-accent)" }}>
                <Settings2 size={14} /> Personalizar
              </button>
              <button type="button" onClick={() => void restoreDefaults()} className="inline-flex items-center justify-center gap-1.5 rounded-xl border px-2 py-2 text-xs font-bold" style={{ borderColor: "var(--t-card-border)" }} title="Automático, vidrio elegante y fondo animado (no borra tus temas)">
                <Sparkles size={14} /> Restaurar
              </button>
            </div>
            {s.saving ? <p className="px-2 pt-1 text-[10px]" style={{ color: "var(--t-muted)" }}>Guardando en tu cuenta…</p> : null}
          </div>
        </>
      ) : null}

      {studio ? <ThemeStudio open={studio} onClose={() => setStudio(null)} onOpen={setStudio} /> : null}
    </div>
  );
}

/** Recomendación discreta cuando hay más de dos temas propios (se puede descartar y no vuelve sola). */
export function ThemesTip({ onManage }: { onManage: () => void }) {
  return (
    <div className="mt-2 rounded-2xl border p-2.5 text-xs" style={{ borderColor: "color-mix(in oklab, var(--t-accent) 30%, var(--t-card-border))", background: "color-mix(in oklab, var(--t-accent) 7%, transparent)" }}>
      <p className="font-bold">💡 Organiza tus temas</p>
      <p className="mt-0.5 leading-snug" style={{ color: "var(--t-muted)" }}>Tienes varios temas personalizados. Si algunos ya no los usas, puedes eliminarlos para mantener tu colección organizada. No es obligatorio.</p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <button type="button" onClick={onManage} className="rounded-full px-2.5 py-1 text-[11px] font-bold" style={{ background: "var(--t-accent)", color: "var(--t-on-accent, #fff)" }}>Administrar temas</button>
        <button type="button" onClick={() => void updatePrefs({ tipDismissed: true })} className="rounded-full border px-2.5 py-1 text-[11px] font-bold" style={{ borderColor: "var(--t-card-border)" }}>No mostrar por ahora</button>
      </div>
    </div>
  );
}

function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="mt-1.5">
      <div className="flex items-center justify-between px-2 pb-0.5">
        <p className="text-[11px] font-bold" style={{ color: "var(--t-muted)" }}>{title}</p>
        {action}
      </div>
      {children}
    </div>
  );
}

function Option({ icon, label, hint, active, onClick }: { icon: React.ReactNode; label: string; hint?: string; active: boolean; onClick: () => void }) {
  return (
    <button type="button" role="menuitemradio" aria-checked={active} onClick={onClick}
      className="flex w-full items-center gap-2.5 rounded-xl px-2 py-2 text-left text-sm font-semibold transition hover:bg-[color:var(--t-card-bg-soft)]"
      style={active ? { background: "color-mix(in oklab, var(--t-accent) 12%, transparent)" } : undefined}>
      <span className="grid h-7 w-7 shrink-0 place-items-center" style={{ color: "var(--t-accent)" }}>{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate">{label}</span>
        {hint ? <span className="block truncate text-[11px] font-medium" style={{ color: "var(--t-muted)" }}>{hint}</span> : null}
      </span>
      {active ? <Check size={16} style={{ color: "var(--t-accent)" }} /> : null}
    </button>
  );
}

/** Miniatura con los colores del tema. */
export function Dots({ colors, size = 28 }: { colors: string[]; size?: number }) {
  return (
    <span className="relative inline-block overflow-hidden rounded-full border" style={{ width: size, height: size, borderColor: "color-mix(in oklab, var(--t-text) 18%, transparent)", background: colors[0] }} aria-hidden>
      <span className="absolute inset-y-0 right-0 w-1/2" style={{ background: colors[1] }} />
      <span className="absolute bottom-0 left-0 h-1/2 w-1/2" style={{ background: colors[2] }} />
      <span className="absolute bottom-0 right-0 h-1/2 w-1/2" style={{ background: `linear-gradient(135deg, ${colors[3]}, ${colors[4]})` }} />
    </span>
  );
}

function Switch({ icon, label, title, on, onToggle }: { icon: string; label: string; title: string; on: boolean; onToggle: () => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} onClick={onToggle} title={title}
      className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left text-sm font-semibold transition hover:bg-[color:var(--t-card-bg-soft)]">
      <span aria-hidden className="grid h-7 w-7 place-items-center">{icon}</span>
      {label}
      <span className="ml-auto inline-flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition" style={{ background: on ? "var(--t-accent)" : "var(--t-card-border)" }}>
        <span className="h-4 w-4 rounded-full bg-white shadow transition" style={{ transform: on ? "translateX(16px)" : "none" }} />
      </span>
    </button>
  );
}
