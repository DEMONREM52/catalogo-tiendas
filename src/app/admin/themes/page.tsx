"use client";

import { useEffect, useMemo, useState } from "react";
import Swal from "sweetalert2";
import { supabaseBrowser } from "@/lib/supabase/client";

type ThemeConfig = {
  text: string;
  mutedText: string;
  border: string;

  cardBg: string;
  cardBorder: string;

  accent: string;
  accent2: string;

  radius: number;
  glow: number;

  bgMode: "solid" | "gradient";
  bgSolid: string;
  bgGradA: string;
  bgGradB: string;
  bgAngle: number;

  ctaMode: "solid" | "gradient";
  ctaSolid: string;
  ctaA: string;
  ctaB: string;
  ctaAngle: number;
};

type ThemeRow = {
  id: string;
  name: string;
  active: boolean;
  sort_order: number;
  config: any; // viene de supabase como json
};

const DEFAULT_CFG: ThemeConfig = {
  text: "#ffffff",
  mutedText: "rgba(255,255,255,0.72)",
  border: "rgba(255,255,255,0.12)",

  cardBg: "rgba(255,255,255,0.06)",
  cardBorder: "rgba(255,255,255,0.12)",

  accent: "#d946ef",
  accent2: "#8b5cf6",

  radius: 24,
  glow: 60,

  bgMode: "gradient",
  bgSolid: "#07060d",
  bgGradA: "#2a0a5e",
  bgGradB: "#060620",
  bgAngle: 135,

  ctaMode: "gradient",
  ctaSolid: "#d946ef",
  ctaA: "#d946ef",
  ctaB: "#8b5cf6",
  ctaAngle: 90,
};

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}

function gradient(angle: number, a: string, b: string) {
  return `linear-gradient(${angle}deg, ${a}, ${b})`;
}

function hexToRgba(hex: string, alpha: number) {
  const h = hex.replace("#", "").trim();
  const full = h.length === 3 ? h.split("").map((x) => x + x).join("") : h;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

/** Convierte lo que venga en config a ThemeConfig completo */
function normalizeConfig(raw: any): ThemeConfig {
  const o = raw && typeof raw === "object" ? raw : {};
  return {
    ...DEFAULT_CFG,
    ...o,
    radius: Number.isFinite(Number(o.radius)) ? Number(o.radius) : DEFAULT_CFG.radius,
    glow: Number.isFinite(Number(o.glow)) ? Number(o.glow) : DEFAULT_CFG.glow,
    bgAngle: Number.isFinite(Number(o.bgAngle)) ? Number(o.bgAngle) : DEFAULT_CFG.bgAngle,
    ctaAngle: Number.isFinite(Number(o.ctaAngle)) ? Number(o.ctaAngle) : DEFAULT_CFG.ctaAngle,
    bgMode: o.bgMode === "solid" ? "solid" : "gradient",
    ctaMode: o.ctaMode === "solid" ? "solid" : "gradient",
  };
}

/** =========================
 * Theme tokens (auto light/dark)
 * ========================= */
function swalTheme() {
  return {
    background: "var(--ap-bg-base)",
    color: "var(--ap-text)",
  } as const;
}

function Preview({ cfg }: { cfg: ThemeConfig }) {
  const bg =
    cfg.bgMode === "gradient"
      ? gradient(cfg.bgAngle, cfg.bgGradA, cfg.bgGradB)
      : cfg.bgSolid;

  const ctaBg =
    cfg.ctaMode === "gradient"
      ? gradient(cfg.ctaAngle, cfg.ctaA, cfg.ctaB)
      : cfg.ctaSolid;

  const glowA = hexToRgba(cfg.accent, cfg.glow / 100);
  const glowB = hexToRgba(cfg.accent2, (cfg.glow / 100) * 0.75);

  return (
    <div className="rounded-[28px] border overflow-hidden ap-card">
      <div className="relative p-5" style={{ background: bg, color: cfg.text }}>
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background: `radial-gradient(circle at 25% 20%, ${glowA}, transparent 55%),
                         radial-gradient(circle at 75% 25%, ${glowB}, transparent 60%)`,
          }}
        />
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.12]"
          style={{
            backgroundImage: "radial-gradient(#ffffff 1px, transparent 1px)",
            backgroundSize: "20px 20px",
          }}
        />

        <div className="relative">
          <p className="text-xs font-semibold tracking-[0.24em] opacity-80">PREVIEW</p>

          <div
            className="mt-4 rounded-[24px] p-4"
            style={{
              borderRadius: cfg.radius,
              background: cfg.cardBg,
              border: `1px solid ${cfg.cardBorder}`,
              backdropFilter: "blur(10px)",
            }}
          >
            <div className="flex items-center justify-between">
              <p className="font-semibold">Landing / Panel</p>
              <span
                className="rounded-full px-2 py-1 text-[11px] font-semibold"
                style={{
                  background: hexToRgba(cfg.accent, 0.18),
                  border: `1px solid ${hexToRgba(cfg.accent, 0.28)}`,
                }}
              >
                Preview
              </span>
            </div>

            <div className="mt-4 grid grid-cols-3 gap-3">
              {["Catálogo", "Pedidos", "Factura PDF"].map((t) => (
                <div
                  key={t}
                  className="rounded-2xl p-2.5 text-[11px]"
                  style={{
                    borderRadius: cfg.radius,
                    background: hexToRgba("#ffffff", 0.06),
                    border: `1px solid ${hexToRgba("#ffffff", 0.12)}`,
                    color: cfg.mutedText,
                  }}
                >
                  <p className="text-white/90 font-semibold text-[11px]">{t}</p>
                  <p className="mt-1 opacity-80 leading-tight">UI limpia</p>
                </div>
              ))}
            </div>

            <button
              className="mt-4 w-full rounded-2xl px-4 py-3 text-sm font-semibold"
              style={{
                borderRadius: cfg.radius,
                background: ctaBg,
                color: "#0b0b0b",
                boxShadow: `0 18px 40px ${hexToRgba(cfg.accent, 0.28)}`,
              }}
            >
              Botón principal (CTA)
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function AdminThemesPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [rows, setRows] = useState<ThemeRow[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");

  // Este cfg SÍ cambia por theme seleccionado
  const [cfg, setCfg] = useState<ThemeConfig>(DEFAULT_CFG);

  const selected = useMemo(
    () => rows.find((x) => x.id === selectedId) ?? null,
    [rows, selectedId],
  );

  async function load() {
    setLoading(true);
    try {
      const sb = supabaseBrowser();

      // ✅ IMPORTANTE: ahora traemos config
      const { data, error } = await sb
        .from("themes")
        .select("id,name,active,sort_order,config")
        .order("sort_order", { ascending: true });

      if (error) throw error;

      const arr = (data as ThemeRow[]) ?? [];
      setRows(arr);

      // Seleccionar el primero si no hay
      if (!selectedId && arr[0]) {
        setSelectedId(arr[0].id);
        setCfg(normalizeConfig(arr[0].config));
      }
    } catch (e: any) {
      await Swal.fire({
        icon: "error",
        title: "Error cargando themes",
        text: e?.message ?? "Error",
        ...swalTheme(),
        confirmButtonColor: "var(--ap-danger)",
      });
    } finally {
      setLoading(false);
    }
  }

  // ✅ carga inicial
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ✅ CUANDO CAMBIA EL THEME SELECCIONADO -> cargar su config real
  useEffect(() => {
    if (!selected) return;
    setCfg(normalizeConfig(selected.config));
  }, [selectedId]); // intencional: cuando cambie id

  function patchRow(id: string, p: Partial<ThemeRow>) {
    setRows((prev) => prev.map((x) => (x.id === id ? { ...x, ...p } : x)));
  }

  async function saveSelected() {
    if (!selected) return;

    setSaving(true);
    try {
      const sb = supabaseBrowser();

      // ✅ guardamos meta + config
      const { error } = await sb
        .from("themes")
        .update({
          name: selected.name,
          active: selected.active,
          sort_order: selected.sort_order,
          config: cfg, // ✅ AQUÍ SE GUARDA LO QUE EDITASTE
        })
        .eq("id", selected.id);

      if (error) throw error;

      // ✅ reflejar en UI el config guardado
      setRows((prev) =>
        prev.map((x) => (x.id === selected.id ? { ...x, config: cfg } : x)),
      );

      await Swal.fire({
        icon: "success",
        title: "Guardado",
        text: "Theme guardado con su configuración.",
        timer: 1100,
        showConfirmButton: false,
        ...swalTheme(),
      });
    } catch (e: any) {
      await Swal.fire({
        icon: "error",
        title: "No se pudo guardar",
        text: e?.message ?? "Error",
        ...swalTheme(),
        confirmButtonColor: "var(--ap-danger)",
      });
    } finally {
      setSaving(false);
    }
  }

  async function createTheme() {
    const res = await Swal.fire({
      title: "Nuevo theme",
      html: `
        <input id="id" class="swal2-input" placeholder="id (ej: lavender_neon)">
        <input id="name" class="swal2-input" placeholder="name (texto)">
      `,
      showCancelButton: true,
      confirmButtonText: "Crear",
      cancelButtonText: "Cancelar",
      ...swalTheme(),
      confirmButtonColor: "var(--ap-cta)",
      preConfirm: () => {
        const id = (document.getElementById("id") as HTMLInputElement).value.trim();
        const name = (document.getElementById("name") as HTMLInputElement).value.trim();
        if (!id || !name) {
          Swal.showValidationMessage("Completa id y name.");
          return;
        }
        return { id, name };
      },
    });

    if (!res.isConfirmed) return;

    setSaving(true);
    try {
      const sb = supabaseBrowser();

      // ✅ insertar con config default (o lo que quieras)
      const { data, error } = await sb
        .from("themes")
        .insert({
          id: res.value.id,
          name: res.value.name,
          active: true,
          sort_order: 0,
          config: DEFAULT_CFG,
        })
        .select("id,name,active,sort_order,config")
        .single();

      if (error) throw error;

      const row = data as ThemeRow;
      setRows((prev) => [row, ...prev]);
      setSelectedId(row.id);
      setCfg(normalizeConfig(row.config));

      await Swal.fire({
        icon: "success",
        title: "Theme creado",
        timer: 900,
        showConfirmButton: false,
        ...swalTheme(),
      });
    } catch (e: any) {
      await Swal.fire({
        icon: "error",
        title: "No se pudo crear",
        text: e?.message ?? "Error",
        ...swalTheme(),
        confirmButtonColor: "var(--ap-danger)",
      });
    } finally {
      setSaving(false);
    }
  }

  async function removeTheme(t: ThemeRow) {
    const res = await Swal.fire({
      icon: "warning",
      title: "Eliminar theme",
      text: `Eliminar "${t.id}"`,
      showCancelButton: true,
      confirmButtonText: "Eliminar",
      cancelButtonText: "Cancelar",
      confirmButtonColor: "var(--ap-danger)",
      ...swalTheme(),
    });
    if (!res.isConfirmed) return;

    setSaving(true);
    try {
      const sb = supabaseBrowser();
      const { error } = await sb.from("themes").delete().eq("id", t.id);
      if (error) throw error;

      setRows((prev) => prev.filter((x) => x.id !== t.id));
      if (selectedId === t.id) {
        setSelectedId("");
        setCfg(DEFAULT_CFG);
      }
    } catch (e: any) {
      await Swal.fire({
        icon: "error",
        title: "No se pudo eliminar",
        text: e?.message ?? "Error",
        ...swalTheme(),
        confirmButtonColor: "var(--ap-danger)",
      });
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p style={{ color: "var(--ap-muted)" }}>Cargando themes...</p>;

  return (
    <div className="text-[color:var(--ap-text)]">
      {/* ✅ Tokens globales (solo visual) */}
      <style jsx global>{`
        :root {
          --ap-text: rgba(255, 255, 255, 0.92);
          --ap-muted: rgba(255, 255, 255, 0.7);
          --ap-border: rgba(255, 255, 255, 0.12);
          --ap-card: rgba(255, 255, 255, 0.06);
          --ap-bg-base: #0b0b0b;

          --ap-cta: #a855f7;
          --ap-danger: #ef4444;
          --ap-success: #22c55e;
          --ap-info: #38bdf8;
        }

        @media (prefers-color-scheme: light) {
          :root {
            --ap-text: rgba(17, 24, 39, 0.92);
            --ap-muted: rgba(17, 24, 39, 0.65);
            --ap-border: rgba(17, 24, 39, 0.14);
            --ap-card: rgba(255, 255, 255, 0.86);
            --ap-bg-base: #f7f7fb;

            --ap-cta: #7c3aed;
            --ap-danger: #dc2626;
            --ap-success: #16a34a;
            --ap-info: #0284c7;
          }
        }

        .ap-card {
          border-color: var(--ap-border) !important;
          background: var(--ap-card) !important;
          backdrop-filter: blur(16px);
          -webkit-backdrop-filter: blur(16px);
        }

        /* Inputs del swal2 (para que se vean bien en light/dark) */
        .swal2-popup {
          background: var(--ap-bg-base) !important;
          color: var(--ap-text) !important;
        }
        .swal2-input {
          border: 1px solid var(--ap-border) !important;
          background: color-mix(in oklab, var(--ap-card) 72%, transparent) !important;
          color: var(--ap-text) !important;
          border-radius: 14px !important;
        }
      `}</style>

      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-xl font-semibold">Themes</h2>
          <p className="text-sm" style={{ color: "var(--ap-muted)" }}>
            Selecciona un theme y edita sus colores. Cada theme guarda su propio config.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            className="rounded-2xl border px-4 py-2 text-sm font-semibold"
            style={{
              borderColor: "var(--ap-border)",
              background: "color-mix(in oklab, var(--ap-card) 72%, transparent)",
              color: "var(--ap-text)",
            }}
            onClick={load}
            disabled={saving}
          >
            Recargar
          </button>

          <button
            className="rounded-2xl px-4 py-2 text-sm font-semibold disabled:opacity-60"
            style={{
              background: "color-mix(in oklab, var(--ap-cta) 22%, transparent)",
              border: "1px solid color-mix(in oklab, var(--ap-cta) 40%, var(--ap-border))",
              color: "var(--ap-text)",
              boxShadow: "0 0 22px color-mix(in oklab, var(--ap-cta) 14%, transparent)",
            }}
            onClick={createTheme}
            disabled={saving}
          >
            + Nuevo
          </button>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-4 xl:grid-cols-[340px_minmax(520px,1fr)_minmax(360px,440px)]">
        {/* Lista */}
        <aside className="rounded-[28px] border p-3 ap-card">
          <div className="mb-2 px-2">
            <p
              className="text-xs font-semibold tracking-[0.22em]"
              style={{ color: "color-mix(in oklab, var(--ap-text) 65%, transparent)" }}
            >
              THEMES
            </p>
          </div>

          <div className="max-h-[72vh] overflow-auto pr-1 space-y-2">
            {rows.map((t) => {
              const activeSel = t.id === selectedId;
              return (
                <button
                  key={t.id}
                  onClick={() => setSelectedId(t.id)}
                  className={cx(
                    "w-full rounded-2xl border px-3 py-3 text-left transition",
                    activeSel ? "ap-selected" : "ap-item",
                  )}
                  style={{
                    borderColor: activeSel
                      ? "color-mix(in oklab, var(--ap-cta) 45%, var(--ap-border))"
                      : "var(--ap-border)",
                    background: activeSel
                      ? "color-mix(in oklab, var(--ap-cta) 14%, transparent)"
                      : "color-mix(in oklab, var(--ap-card) 72%, transparent)",
                    color: "var(--ap-text)",
                  }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{t.name}</p>
                      <p className="truncate text-xs" style={{ color: "var(--ap-muted)" }}>
                        {t.id}
                      </p>
                    </div>

                    <span
                      className="rounded-full px-2 py-1 text-[11px] font-semibold border"
                      style={{
                        borderColor: t.active
                          ? "color-mix(in oklab, var(--ap-success) 40%, var(--ap-border))"
                          : "var(--ap-border)",
                        background: t.active
                          ? "color-mix(in oklab, var(--ap-success) 14%, transparent)"
                          : "color-mix(in oklab, var(--ap-card) 72%, transparent)",
                        color: "var(--ap-text)",
                      }}
                    >
                      {t.active ? "Activo" : "Inactivo"}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </aside>

        {/* Editor */}
        <section className="rounded-[28px] border p-4 max-h-[72vh] overflow-auto pr-1 ap-card">
          {!selected ? (
            <div
              className="rounded-2xl border p-4 text-sm"
              style={{
                borderColor: "var(--ap-border)",
                background: "color-mix(in oklab, var(--ap-card) 72%, transparent)",
                color: "var(--ap-muted)",
              }}
            >
              Selecciona un theme de la izquierda.
            </div>
          ) : (
            <div className="space-y-4">
              <div
                className="rounded-2xl border p-4"
                style={{
                  borderColor: "var(--ap-border)",
                  background: "color-mix(in oklab, var(--ap-card) 72%, transparent)",
                }}
              >
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold">Theme</p>
                    <p className="text-xs" style={{ color: "var(--ap-muted)" }}>
                      ID: {selected.id}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      className="rounded-2xl border px-3 py-2 text-sm font-semibold"
                      style={{
                        borderColor: "var(--ap-border)",
                        background: "color-mix(in oklab, var(--ap-card) 72%, transparent)",
                        color: "var(--ap-text)",
                      }}
                      onClick={() => removeTheme(selected)}
                      disabled={saving}
                    >
                      Eliminar
                    </button>

                    <button
                      className="rounded-2xl px-3 py-2 text-sm font-semibold disabled:opacity-60"
                      style={{
                        background: "color-mix(in oklab, var(--ap-success) 18%, transparent)",
                        border: "1px solid color-mix(in oklab, var(--ap-success) 40%, var(--ap-border))",
                        color: "var(--ap-text)",
                      }}
                      onClick={saveSelected}
                      disabled={saving}
                    >
                      Guardar (incluye colores)
                    </button>
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
                  <div>
                    <label className="text-xs" style={{ color: "var(--ap-muted)" }}>
                      Nombre
                    </label>
                    <input
                      className="mt-1 w-full rounded-2xl border px-3 py-2 outline-none"
                      style={{
                        borderColor: "var(--ap-border)",
                        background: "color-mix(in oklab, var(--ap-card) 72%, transparent)",
                        color: "var(--ap-text)",
                      }}
                      value={selected.name}
                      onChange={(e) => patchRow(selected.id, { name: e.target.value })}
                    />
                  </div>

                  <div>
                    <label className="text-xs" style={{ color: "var(--ap-muted)" }}>
                      Orden
                    </label>
                    <input
                      type="number"
                      className="mt-1 w-full rounded-2xl border px-3 py-2 outline-none"
                      style={{
                        borderColor: "var(--ap-border)",
                        background: "color-mix(in oklab, var(--ap-card) 72%, transparent)",
                        color: "var(--ap-text)",
                      }}
                      value={selected.sort_order}
                      onChange={(e) =>
                        patchRow(selected.id, { sort_order: Number(e.target.value) })
                      }
                    />
                  </div>

                  <div className="md:col-span-2 flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={selected.active}
                      onChange={(e) => patchRow(selected.id, { active: e.target.checked })}
                    />
                    <span className="text-sm">Activo</span>
                  </div>
                </div>
              </div>

              {/* Editor dinámico */}
              <div
                className="rounded-2xl border p-4"
                style={{
                  borderColor: "var(--ap-border)",
                  background: "color-mix(in oklab, var(--ap-card) 72%, transparent)",
                }}
              >
                <p className="text-sm font-semibold">🎨 Colores</p>
                <p className="mt-1 text-xs" style={{ color: "var(--ap-muted)" }}>
                  Cambia el theme, y verás colores diferentes (porque se cargan de la BD).
                </p>

                <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div
                    className="rounded-2xl border p-4"
                    style={{
                      borderColor: "var(--ap-border)",
                      background: "color-mix(in oklab, var(--ap-card) 72%, transparent)",
                    }}
                  >
                    <p className="text-xs font-semibold" style={{ color: "color-mix(in oklab, var(--ap-text) 85%, transparent)" }}>
                      Básico
                    </p>

                    <div className="mt-3 grid grid-cols-2 gap-3">
                      <label className="text-xs" style={{ color: "var(--ap-muted)" }}>
                        Accent
                        <input
                          type="color"
                          className="mt-2 h-10 w-full rounded-xl border bg-transparent"
                          style={{ borderColor: "var(--ap-border)" }}
                          value={cfg.accent}
                          onChange={(e) => setCfg((p) => ({ ...p, accent: e.target.value }))}
                        />
                      </label>

                      <label className="text-xs" style={{ color: "var(--ap-muted)" }}>
                        Accent 2
                        <input
                          type="color"
                          className="mt-2 h-10 w-full rounded-xl border bg-transparent"
                          style={{ borderColor: "var(--ap-border)" }}
                          value={cfg.accent2}
                          onChange={(e) => setCfg((p) => ({ ...p, accent2: e.target.value }))}
                        />
                      </label>
                    </div>

                    <div className="mt-4">
                      <label className="text-xs" style={{ color: "var(--ap-muted)" }}>
                        Radio: {cfg.radius}px
                      </label>
                      <input
                        type="range"
                        min={12}
                        max={32}
                        value={cfg.radius}
                        onChange={(e) =>
                          setCfg((p) => ({ ...p, radius: Number(e.target.value) }))
                        }
                        className="mt-2 w-full"
                      />
                    </div>

                    <div className="mt-4">
                      <label className="text-xs" style={{ color: "var(--ap-muted)" }}>
                        Glow: {cfg.glow}%
                      </label>
                      <input
                        type="range"
                        min={0}
                        max={90}
                        value={cfg.glow}
                        onChange={(e) =>
                          setCfg((p) => ({
                            ...p,
                            glow: clamp(Number(e.target.value), 0, 90),
                          }))
                        }
                        className="mt-2 w-full"
                      />
                    </div>
                  </div>

                  <div
                    className="rounded-2xl border p-4"
                    style={{
                      borderColor: "var(--ap-border)",
                      background: "color-mix(in oklab, var(--ap-card) 72%, transparent)",
                    }}
                  >
                    <p className="text-xs font-semibold" style={{ color: "color-mix(in oklab, var(--ap-text) 85%, transparent)" }}>
                      Fondo
                    </p>

                    <div className="mt-3 flex gap-2">
                      <button
                        className="rounded-2xl border px-3 py-2 text-xs font-semibold"
                        style={{
                          borderColor:
                            cfg.bgMode === "gradient"
                              ? "color-mix(in oklab, var(--ap-cta) 45%, var(--ap-border))"
                              : "var(--ap-border)",
                          background:
                            cfg.bgMode === "gradient"
                              ? "color-mix(in oklab, var(--ap-cta) 14%, transparent)"
                              : "color-mix(in oklab, var(--ap-card) 72%, transparent)",
                          color: "var(--ap-text)",
                        }}
                        onClick={() => setCfg((p) => ({ ...p, bgMode: "gradient" }))}
                      >
                        Gradient
                      </button>

                      <button
                        className="rounded-2xl border px-3 py-2 text-xs font-semibold"
                        style={{
                          borderColor:
                            cfg.bgMode === "solid"
                              ? "color-mix(in oklab, var(--ap-cta) 45%, var(--ap-border))"
                              : "var(--ap-border)",
                          background:
                            cfg.bgMode === "solid"
                              ? "color-mix(in oklab, var(--ap-cta) 14%, transparent)"
                              : "color-mix(in oklab, var(--ap-card) 72%, transparent)",
                          color: "var(--ap-text)",
                        }}
                        onClick={() => setCfg((p) => ({ ...p, bgMode: "solid" }))}
                      >
                        Solid
                      </button>
                    </div>

                    <div className="mt-4 grid grid-cols-2 gap-3">
                      <label className="text-xs" style={{ color: "var(--ap-muted)" }}>
                        Gradient A
                        <input
                          type="color"
                          className="mt-2 h-10 w-full rounded-xl border bg-transparent"
                          style={{ borderColor: "var(--ap-border)" }}
                          value={cfg.bgGradA}
                          onChange={(e) => setCfg((p) => ({ ...p, bgGradA: e.target.value }))}
                        />
                      </label>

                      <label className="text-xs" style={{ color: "var(--ap-muted)" }}>
                        Gradient B
                        <input
                          type="color"
                          className="mt-2 h-10 w-full rounded-xl border bg-transparent"
                          style={{ borderColor: "var(--ap-border)" }}
                          value={cfg.bgGradB}
                          onChange={(e) => setCfg((p) => ({ ...p, bgGradB: e.target.value }))}
                        />
                      </label>
                    </div>

                    <div className="mt-4">
                      <label className="text-xs" style={{ color: "var(--ap-muted)" }}>
                        Ángulo: {cfg.bgAngle}°
                      </label>
                      <input
                        type="range"
                        min={0}
                        max={360}
                        value={cfg.bgAngle}
                        onChange={(e) =>
                          setCfg((p) => ({ ...p, bgAngle: Number(e.target.value) }))
                        }
                        className="mt-2 w-full"
                      />
                    </div>
                  </div>

                  <div
                    className="rounded-2xl border p-4 md:col-span-2"
                    style={{
                      borderColor: "var(--ap-border)",
                      background: "color-mix(in oklab, var(--ap-card) 72%, transparent)",
                    }}
                  >
                    <p className="text-xs font-semibold" style={{ color: "color-mix(in oklab, var(--ap-text) 85%, transparent)" }}>
                      Botón (CTA)
                    </p>

                    <div className="mt-3 flex gap-2">
                      <button
                        className="rounded-2xl border px-3 py-2 text-xs font-semibold"
                        style={{
                          borderColor:
                            cfg.ctaMode === "gradient"
                              ? "color-mix(in oklab, var(--ap-cta) 45%, var(--ap-border))"
                              : "var(--ap-border)",
                          background:
                            cfg.ctaMode === "gradient"
                              ? "color-mix(in oklab, var(--ap-cta) 14%, transparent)"
                              : "color-mix(in oklab, var(--ap-card) 72%, transparent)",
                          color: "var(--ap-text)",
                        }}
                        onClick={() => setCfg((p) => ({ ...p, ctaMode: "gradient" }))}
                      >
                        Gradient
                      </button>

                      <button
                        className="rounded-2xl border px-3 py-2 text-xs font-semibold"
                        style={{
                          borderColor:
                            cfg.ctaMode === "solid"
                              ? "color-mix(in oklab, var(--ap-cta) 45%, var(--ap-border))"
                              : "var(--ap-border)",
                          background:
                            cfg.ctaMode === "solid"
                              ? "color-mix(in oklab, var(--ap-cta) 14%, transparent)"
                              : "color-mix(in oklab, var(--ap-card) 72%, transparent)",
                          color: "var(--ap-text)",
                        }}
                        onClick={() => setCfg((p) => ({ ...p, ctaMode: "solid" }))}
                      >
                        Solid
                      </button>
                    </div>

                    <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-3">
                      <label className="text-xs" style={{ color: "var(--ap-muted)" }}>
                        CTA A
                        <input
                          type="color"
                          className="mt-2 h-10 w-full rounded-xl border bg-transparent"
                          style={{ borderColor: "var(--ap-border)" }}
                          value={cfg.ctaA}
                          onChange={(e) => setCfg((p) => ({ ...p, ctaA: e.target.value }))}
                        />
                      </label>

                      <label className="text-xs" style={{ color: "var(--ap-muted)" }}>
                        CTA B
                        <input
                          type="color"
                          className="mt-2 h-10 w-full rounded-xl border bg-transparent"
                          style={{ borderColor: "var(--ap-border)" }}
                          value={cfg.ctaB}
                          onChange={(e) => setCfg((p) => ({ ...p, ctaB: e.target.value }))}
                        />
                      </label>

                      <label className="text-xs" style={{ color: "var(--ap-muted)" }}>
                        CTA Solid
                        <input
                          type="color"
                          className="mt-2 h-10 w-full rounded-xl border bg-transparent"
                          style={{ borderColor: "var(--ap-border)" }}
                          value={cfg.ctaSolid}
                          onChange={(e) => setCfg((p) => ({ ...p, ctaSolid: e.target.value }))}
                        />
                      </label>
                    </div>

                    <div className="mt-4">
                      <label className="text-xs" style={{ color: "var(--ap-muted)" }}>
                        Ángulo CTA: {cfg.ctaAngle}°
                      </label>
                      <input
                        type="range"
                        min={0}
                        max={360}
                        value={cfg.ctaAngle}
                        onChange={(e) =>
                          setCfg((p) => ({ ...p, ctaAngle: Number(e.target.value) }))
                        }
                        className="mt-2 w-full"
                      />
                    </div>

                    <div className="mt-5 flex flex-wrap gap-2">
                      <button
                        className="rounded-2xl border px-4 py-2 text-sm font-semibold"
                        style={{
                          borderColor: "var(--ap-border)",
                          background: "color-mix(in oklab, var(--ap-card) 72%, transparent)",
                          color: "var(--ap-text)",
                        }}
                        onClick={() => setCfg(DEFAULT_CFG)}
                        type="button"
                      >
                        Reset
                      </button>

                      <button
                        className="rounded-2xl px-4 py-2 text-sm font-semibold disabled:opacity-60"
                        style={{
                          background: "color-mix(in oklab, var(--ap-cta) 22%, transparent)",
                          border: "1px solid color-mix(in oklab, var(--ap-cta) 40%, var(--ap-border))",
                          color: "var(--ap-text)",
                          boxShadow: "0 0 22px color-mix(in oklab, var(--ap-cta) 14%, transparent)",
                        }}
                        onClick={saveSelected}
                        disabled={saving}
                        type="button"
                      >
                        Guardar colores en este theme
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </section>

        {/* Preview */}
        <aside className="space-y-3 xl:sticky xl:top-6">
          <div className="max-w-[440px] xl:max-w-none">
            <Preview cfg={cfg} />
          </div>

          <div className="rounded-[28px] border p-4 text-sm ap-card max-w-[440px] xl:max-w-none">
            <p className="font-semibold" style={{ color: "var(--ap-text)" }}>
              ✅ Ahora sí funciona
            </p>
            <p className="mt-1" style={{ color: "var(--ap-muted)" }}>
              Cambias de theme → se carga su config desde BD. <br />
              Editas → Guardar → se guarda en themes.config.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}
