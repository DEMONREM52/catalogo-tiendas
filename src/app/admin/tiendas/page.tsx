"use client";

import { useEffect, useMemo, useState } from "react";
import Swal from "sweetalert2";
import { supabaseBrowser } from "@/lib/supabase/client";

type Store = {
  id: string;
  name: string;
  slug: string;
  whatsapp: string;
  owner_id: string;

  active: boolean;
  active_until: string | null; // ✅ NUEVO

  catalog_retail: boolean;
  catalog_wholesale: boolean;

  wholesale_key: string | null;
  created_at: string;
};

/* =========================================================
   Theme tokens (auto light/dark)
========================================================= */
function swalTheme() {
  return {
    background: "var(--ap-bg-base)",
    color: "var(--ap-text)",
  } as const;
}

function inputBase() {
  return "ap-input rounded-2xl p-3 text-sm outline-none backdrop-blur-xl";
}

function buttonGhost() {
  return "ap-btn-ghost rounded-2xl px-4 py-2 text-sm font-semibold backdrop-blur-xl transition hover:opacity-95 disabled:opacity-60";
}

function buttonPrimary() {
  return "ap-btn-primary rounded-2xl px-4 py-2 text-sm font-semibold backdrop-blur-xl transition hover:opacity-95 disabled:opacity-60";
}

function buttonWarn() {
  return "ap-btn-warn rounded-2xl px-4 py-2 text-sm font-semibold backdrop-blur-xl transition hover:opacity-95 disabled:opacity-60";
}

function buttonDanger() {
  return "ap-btn-danger rounded-2xl px-4 py-2 text-sm font-semibold backdrop-blur-xl transition hover:opacity-95 disabled:opacity-60";
}

function pill(on: boolean) {
  return on ? "ap-pill-on" : "ap-pill-off";
}

function slugifyHint(v: string) {
  return (v || "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
}

/* =========================================================
   ✅ Helpers: Active until / countdown
========================================================= */
function isStoreActiveNow(s: { active: boolean; active_until?: string | null }) {
  if (!s.active) return false;
  if (!s.active_until) return true;
  return new Date(s.active_until).getTime() > Date.now();
}

function isExpired(active_until: string | null) {
  if (!active_until) return false;
  return new Date(active_until).getTime() <= Date.now();
}

function toLocalInputValue(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

function fromLocalInputValue(v: string) {
  const d = new Date(v); // local
  return isNaN(d.getTime()) ? null : d.toISOString();
}

function addDaysISO(days: number) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

function formatCountdown(iso: string | null) {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "Expirada";
  const totalMin = Math.floor(ms / 60000);
  const days = Math.floor(totalMin / (60 * 24));
  const hours = Math.floor((totalMin % (60 * 24)) / 60);
  const mins = totalMin % 60;
  if (days > 0) return `Faltan ${days}d ${hours}h`;
  if (hours > 0) return `Faltan ${hours}h ${mins}m`;
  return `Faltan ${mins}m`;
}

/** ✅ Regla: si la tienda NO está activa "en vivo", los catálogos deben quedar apagados */
function applyCatalogAutoOff(s: Store): Store {
  const liveActive = isStoreActiveNow(s);
  if (liveActive) return s;
  // Si está inactiva/expirada: forzamos catálogos a false (en UI y al guardar)
  if (s.catalog_retail || s.catalog_wholesale) {
    return { ...s, catalog_retail: false, catalog_wholesale: false };
  }
  return s;
}

export default function AdminTiendasPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [q, setQ] = useState("");
  const [stores, setStores] = useState<Store[]>([]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return stores;
    return stores.filter((x) =>
      `${x.name} ${x.slug} ${x.whatsapp} ${x.owner_id}`.toLowerCase().includes(s)
    );
  }, [q, stores]);

  async function load() {
    setLoading(true);
    try {
      const sb = supabaseBrowser();

      const { data, error } = await sb
        .from("stores")
        .select(
          "id,name,slug,whatsapp,owner_id,active,active_until,catalog_retail,catalog_wholesale,wholesale_key,created_at"
        )
        .order("created_at", { ascending: false });

      if (error) throw error;

      // ✅ Aplicamos auto-off de catálogos en el estado (si está expirada/inactiva)
      const normalized = ((data as Store[]) ?? []).map(applyCatalogAutoOff);
      setStores(normalized);
    } catch (e: any) {
      await Swal.fire({
        icon: "error",
        title: "Error cargando tiendas",
        text: e?.message ?? "Error",
        ...swalTheme(),
      });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  function patch(id: string, p: Partial<Store>) {
    setStores((prev) =>
      prev.map((s) => {
        if (s.id !== id) return s;

        let next: Store = { ...s, ...p };

        // ✅ Si se apaga manualmente, apagamos catálogos también
        if (p.active === false) {
          next = { ...next, catalog_retail: false, catalog_wholesale: false };
        }

        // ✅ Si cambias la fecha y queda expirada, también apagamos catálogos
        if ("active_until" in p) {
          const exp = isExpired(next.active_until);
          if (exp) {
            next = { ...next, catalog_retail: false, catalog_wholesale: false };
          }
        }

        // ✅ Si por cualquier razón quedó inactiva "en vivo", auto-off catálogos
        next = applyCatalogAutoOff(next);

        return next;
      })
    );
  }

  async function saveStore(s: Store) {
    setSaving(true);
    try {
      const sb = supabaseBrowser();

      // ✅ En el guardado forzamos la regla: si NO está activa en vivo => catálogos false
      const liveActive = isStoreActiveNow(s);
      const payload = {
        name: s.name,
        slug: s.slug,
        whatsapp: s.whatsapp,
        active: s.active,
        active_until: s.active_until,
        catalog_retail: liveActive ? s.catalog_retail : false,
        catalog_wholesale: liveActive ? s.catalog_wholesale : false,
        wholesale_key: s.wholesale_key,
      };

      const { error } = await sb.from("stores").update(payload).eq("id", s.id);
      if (error) throw error;

      // ✅ Refrescamos el state local con lo que se guardó
      patch(s.id, {
        catalog_retail: payload.catalog_retail,
        catalog_wholesale: payload.catalog_wholesale,
      });

      await Swal.fire({
        icon: "success",
        title: "Guardado",
        text: "Tienda actualizada.",
        timer: 1100,
        showConfirmButton: false,
        ...swalTheme(),
      });
    } catch (e: any) {
      await Swal.fire({
        icon: "error",
        title: "No se pudo guardar",
        text: e?.message ?? "Error",
        confirmButtonColor: "var(--ap-danger)",
        ...swalTheme(),
      });
    } finally {
      setSaving(false);
    }
  }

  async function changeOwner(s: Store) {
    const res = await Swal.fire({
      icon: "warning",
      title: "Cambiar dueño (owner_id)",
      html: `
        <div style="text-align:left; opacity:.9">
          <div style="margin-bottom:10px">
            Tienda: <b>${s.name}</b><br/>
            <span style="opacity:.7; font-size:12px">Pega aquí el UUID del nuevo usuario.</span>
          </div>
          <input id="newOwner" class="swal2-input" placeholder="Nuevo owner_id (uuid)" value="${s.owner_id}">
        </div>
      `,
      showCancelButton: true,
      confirmButtonText: "Transferir",
      cancelButtonText: "Cancelar",
      confirmButtonColor: "var(--ap-warn)",
      ...swalTheme(),
      preConfirm: () => {
        const v = (document.getElementById("newOwner") as HTMLInputElement).value.trim();
        if (!v) {
          Swal.showValidationMessage("Escribe un uuid válido.");
          return;
        }
        return v;
      },
    });

    if (!res.isConfirmed) return;

    setSaving(true);
    try {
      const sb = supabaseBrowser();

      const { error } = await sb.from("stores").update({ owner_id: res.value }).eq("id", s.id);
      if (error) throw error;

      patch(s.id, { owner_id: res.value });

      await Swal.fire({
        icon: "success",
        title: "Transferida",
        text: "Owner actualizado.",
        timer: 1100,
        showConfirmButton: false,
        ...swalTheme(),
      });
    } catch (e: any) {
      await Swal.fire({
        icon: "error",
        title: "No se pudo transferir",
        text: e?.message ?? "Error",
        confirmButtonColor: "var(--ap-danger)",
        ...swalTheme(),
      });
    } finally {
      setSaving(false);
    }
  }

  async function deleteStore(s: Store) {
    const res = await Swal.fire({
      icon: "warning",
      title: "Eliminar tienda",
      text: `Se eliminará "${s.name}". Esto puede afectar pedidos/productos.`,
      showCancelButton: true,
      confirmButtonText: "Sí, eliminar",
      cancelButtonText: "Cancelar",
      confirmButtonColor: "var(--ap-danger)",
      ...swalTheme(),
    });
    if (!res.isConfirmed) return;

    setSaving(true);
    try {
      const sb = supabaseBrowser();

      const { error } = await sb.from("stores").delete().eq("id", s.id);
      if (error) throw error;

      setStores((prev) => prev.filter((x) => x.id !== s.id));

      await Swal.fire({
        icon: "success",
        title: "Eliminada",
        timer: 900,
        showConfirmButton: false,
        ...swalTheme(),
      });
    } catch (e: any) {
      await Swal.fire({
        icon: "error",
        title: "No se pudo eliminar",
        text: e?.message ?? "Error",
        ...swalTheme(),
      });
    } finally {
      setSaving(false);
    }
  }

  async function createStore() {
    const res = await Swal.fire({
      title: "Crear tienda",
      html: `
        <div style="text-align:left; opacity:.9">
          <div style="opacity:.75; font-size:12px; margin-bottom:8px">
            Consejo: el <b>slug</b> es el link público. Ej: <code>mi-tienda</code>
          </div>

          <input id="name" class="swal2-input" placeholder="Nombre">
          <input id="slug" class="swal2-input" placeholder="Slug (ej: mi-tienda)">
          <input id="wa" class="swal2-input" placeholder="WhatsApp (57300...)">
          <input id="owner" class="swal2-input" placeholder="Owner ID (uuid del usuario)">
        </div>
      `,
      focusConfirm: false,
      showCancelButton: true,
      confirmButtonText: "Crear",
      cancelButtonText: "Cancelar",
      ...swalTheme(),
      preConfirm: () => {
        const name = (document.getElementById("name") as HTMLInputElement).value.trim();
        const slug = (document.getElementById("slug") as HTMLInputElement).value.trim();
        const whatsapp = (document.getElementById("wa") as HTMLInputElement).value.trim();
        const owner_id = (document.getElementById("owner") as HTMLInputElement).value.trim();

        if (!name || !slug || !whatsapp || !owner_id) {
          Swal.showValidationMessage("Completa todos los campos.");
          return;
        }
        return { name, slug, whatsapp, owner_id };
      },
    });

    if (!res.isConfirmed) return;

    setSaving(true);
    try {
      const sb = supabaseBrowser();

      const { data, error } = await sb
        .from("stores")
        .insert({
          name: res.value.name,
          slug: res.value.slug,
          whatsapp: res.value.whatsapp,
          owner_id: res.value.owner_id,
          active: true,
          active_until: null,
          catalog_retail: true,
          catalog_wholesale: true,
          theme: "oceano-profundo",
          ui_radius: 12,
        })
        .select(
          "id,name,slug,whatsapp,owner_id,active,active_until,catalog_retail,catalog_wholesale,wholesale_key,created_at"
        )
        .single();

      if (error) throw error;

      setStores((prev) => [applyCatalogAutoOff(data as Store), ...prev]);

      await Swal.fire({
        icon: "success",
        title: "Tienda creada",
        timer: 1000,
        showConfirmButton: false,
        ...swalTheme(),
      });
    } catch (e: any) {
      await Swal.fire({
        icon: "error",
        title: "No se pudo crear",
        text: e?.message ?? "Error",
        ...swalTheme(),
      });
    } finally {
      setSaving(false);
    }
  }

  function openRetail(s: Store) {
    const liveActive = isStoreActiveNow(s);
    const effectiveRetail = liveActive && s.catalog_retail;
    if (!effectiveRetail) {
      Swal.fire({
        icon: "info",
        title: "Catálogo detall desactivado",
        text: liveActive ? "Está desactivado manualmente." : "La tienda está inactiva o expirada.",
        ...swalTheme(),
      });
      return;
    }
    window.open(`/${s.slug}/detal`, "_blank");
  }

  async function openWholesale(s: Store) {
    const liveActive = isStoreActiveNow(s);
    const effectiveWholesale = liveActive && s.catalog_wholesale;

    if (!effectiveWholesale) {
      await Swal.fire({
        icon: "info",
        title: "Catálogo mayorista desactivado",
        text: liveActive ? "Está desactivado manualmente." : "La tienda está inactiva o expirada.",
        ...swalTheme(),
      });
      return;
    }

    if (!s.wholesale_key) {
      await Swal.fire({
        icon: "info",
        title: "Falta clave mayorista",
        text: "Esta tienda no tiene wholesale_key configurada.",
        ...swalTheme(),
      });
      return;
    }

    const url = `/${s.slug}/mayor?key=${encodeURIComponent(s.wholesale_key)}`;
    window.open(url, "_blank");
  }

  return (
    <div className="space-y-4 text-[color:var(--ap-text)]">
      {/* Theme tokens + local UI helpers */}
      <style jsx global>{`
        :root {
          --ap-text: rgba(255, 255, 255, 0.92);
          --ap-muted: rgba(255, 255, 255, 0.7);
          --ap-border: rgba(255, 255, 255, 0.12);
          --ap-card: rgba(255, 255, 255, 0.06);

          --ap-bg-base: #0b0b0b;

          --ap-cta: #a855f7;
          --ap-warn: #f59e0b;
          --ap-danger: #ef4444;
          --ap-success: #22c55e;
        }

        @media (prefers-color-scheme: light) {
          :root {
            --ap-text: rgba(17, 24, 39, 0.92);
            --ap-muted: rgba(17, 24, 39, 0.65);
            --ap-border: rgba(17, 24, 39, 0.14);
            --ap-card: rgba(255, 255, 255, 0.85);

            --ap-bg-base: #f7f7fb;

            --ap-cta: #7c3aed;
            --ap-warn: #d97706;
            --ap-danger: #dc2626;
            --ap-success: #16a34a;
          }
        }

        .ap-card {
          border: 1px solid var(--ap-border);
          background: var(--ap-card);
          backdrop-filter: blur(16px);
          -webkit-backdrop-filter: blur(16px);
        }

        .ap-input {
          border: 1px solid var(--ap-border);
          background: color-mix(in oklab, var(--ap-card) 72%, transparent);
          color: var(--ap-text);
        }
        .ap-input::placeholder {
          color: color-mix(in oklab, var(--ap-text) 38%, transparent);
        }
        select.ap-input option {
          color: #111827; /* opciones legibles en dropdown nativo */
        }

        .ap-btn-ghost {
          border: 1px solid var(--ap-border);
          background: color-mix(in oklab, var(--ap-card) 72%, transparent);
          color: var(--ap-text);
        }

        .ap-btn-primary {
          border: 1px solid color-mix(in oklab, var(--ap-cta) 35%, var(--ap-border));
          background: color-mix(in oklab, var(--ap-cta) 18%, transparent);
          color: var(--ap-text);
          box-shadow: 0 0 22px color-mix(in oklab, var(--ap-cta) 14%, transparent);
        }

        .ap-btn-warn {
          border: 1px solid color-mix(in oklab, var(--ap-warn) 35%, var(--ap-border));
          background: color-mix(in oklab, var(--ap-warn) 14%, transparent);
          color: var(--ap-text);
        }

        .ap-btn-danger {
          border: 1px solid color-mix(in oklab, var(--ap-danger) 35%, var(--ap-border));
          background: color-mix(in oklab, var(--ap-danger) 12%, transparent);
          color: var(--ap-text);
        }

        .ap-pill-on {
          border: 1px solid color-mix(in oklab, var(--ap-success) 35%, var(--ap-border));
          background: color-mix(in oklab, var(--ap-success) 14%, transparent);
          color: var(--ap-text);
        }

        .ap-pill-off {
          border: 1px solid var(--ap-border);
          background: color-mix(in oklab, var(--ap-card) 72%, transparent);
          color: var(--ap-muted);
        }
      `}</style>

      {/* Header */}
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-2xl font-semibold">🏪 Tiendas</h2>
          <p className="text-sm" style={{ color: "var(--ap-muted)" }}>
            Crear · editar · activar/inactivar · catálogos · transferir owner · temporizador.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button className={buttonGhost()} onClick={load} disabled={saving}>
            Recargar
          </button>

          <button className={buttonPrimary()} onClick={createStore} disabled={saving}>
            + Nueva
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="ap-card rounded-[28px] p-3">
        <input
          className="w-full bg-transparent outline-none"
          style={{ color: "var(--ap-text)" }}
          placeholder="Buscar por nombre, slug, whatsapp, owner..."
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        {q ? (
          <div className="mt-2 text-xs" style={{ color: "var(--ap-muted)" }}>
            Tip: si escribes el nombre, te sugiero slug:{" "}
            <span style={{ color: "color-mix(in oklab, var(--ap-cta) 60%, var(--ap-text))" }} className="font-semibold">
              {slugifyHint(q)}
            </span>
          </div>
        ) : null}
      </div>

      {/* Content */}
      {loading ? (
        <div className="ap-card rounded-[28px] p-6 text-sm" style={{ color: "var(--ap-muted)" }}>
          Cargando...
        </div>
      ) : filtered.length === 0 ? (
        <div className="ap-card rounded-[28px] p-6">
          <p className="font-semibold">No hay tiendas</p>
          <p className="mt-1 text-sm" style={{ color: "var(--ap-muted)" }}>
            Crea una con “+ Nueva”.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((s) => {
            const liveActive = isStoreActiveNow(s);
            const expired = isExpired(s.active_until);

            const effectiveRetail = liveActive && s.catalog_retail;
            const effectiveWholesale = liveActive && s.catalog_wholesale;

            return (
              <div key={s.id} className="ap-card rounded-[28px] p-4">
                {/* Top row */}
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-lg font-semibold">{s.name}</p>

                      <span className="rounded-full border px-3 py-1 text-xs"
                        style={{
                          borderColor: "var(--ap-border)",
                          background: "color-mix(in oklab, var(--ap-card) 72%, transparent)",
                          color: "var(--ap-text)",
                        }}
                      >
                        /{s.slug}
                      </span>

                      <span
                        className={`rounded-full border px-3 py-1 text-xs font-semibold ${pill(liveActive)}`}
                        title={
                          s.active_until
                            ? expired
                              ? "Expirada por fecha (catálogos apagados)"
                              : "Activa (con expiración)"
                            : "Activa (sin expiración)"
                        }
                      >
                        {liveActive ? "Activa" : "Inactiva"}
                      </span>

                      {s.active_until ? (
                        <span
                          className="rounded-full border px-3 py-1 text-xs"
                          style={{
                            borderColor: expired
                              ? "color-mix(in oklab, var(--ap-danger) 40%, var(--ap-border))"
                              : "var(--ap-border)",
                            background: expired
                              ? "color-mix(in oklab, var(--ap-danger) 12%, transparent)"
                              : "color-mix(in oklab, var(--ap-card) 72%, transparent)",
                            color: expired ? "var(--ap-text)" : "var(--ap-muted)",
                          }}
                        >
                          {formatCountdown(s.active_until)}
                        </span>
                      ) : null}

                      {!liveActive ? (
                        <span
                          className="rounded-full border px-3 py-1 text-xs"
                          style={{
                            borderColor: "var(--ap-border)",
                            background: "color-mix(in oklab, var(--ap-card) 72%, transparent)",
                            color: "var(--ap-muted)",
                          }}
                        >
                          Catálogos desactivados automáticamente
                        </span>
                      ) : null}
                    </div>

                    <p className="mt-1 text-sm" style={{ color: "var(--ap-muted)" }}>
                      WhatsApp: <b style={{ color: "var(--ap-text)" }}>{s.whatsapp}</b>
                    </p>

                    <p className="mt-1 text-xs" style={{ color: "color-mix(in oklab, var(--ap-text) 55%, transparent)" }}>
                      Owner: {s.owner_id} · Creada: {new Date(s.created_at).toLocaleString("es-CO")}
                    </p>
                  </div>

                  {/* Quick actions */}
                  <div className="flex flex-wrap gap-2">
                    <button className={buttonGhost()} onClick={() => openRetail(s)}>
                      Abrir Detal
                    </button>

                    <button
                      className={buttonGhost()}
                      onClick={() => openWholesale(s)}
                      title={!effectiveWholesale ? "Mayor desactivado" : ""}
                    >
                      Abrir Mayor
                    </button>

                    <button className={buttonPrimary()} onClick={() => saveStore(s)} disabled={saving}>
                      Guardar
                    </button>
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
                  <div>
                    <label className="text-xs" style={{ color: "var(--ap-muted)" }}>
                      Nombre
                    </label>
                    <input
                      className={inputBase() + " mt-1 w-full"}
                      value={s.name}
                      onChange={(e) => patch(s.id, { name: e.target.value })}
                    />
                  </div>

                  <div>
                    <label className="text-xs" style={{ color: "var(--ap-muted)" }}>
                      Slug
                    </label>
                    <input
                      className={inputBase() + " mt-1 w-full"}
                      value={s.slug}
                      onChange={(e) => patch(s.id, { slug: e.target.value })}
                    />
                    <p className="mt-1 text-xs" style={{ color: "var(--ap-muted)" }}>
                      Link: <span style={{ color: "color-mix(in oklab, var(--ap-cta) 60%, var(--ap-text))" }}>/{s.slug}</span>
                    </p>
                  </div>

                  <div>
                    <label className="text-xs" style={{ color: "var(--ap-muted)" }}>
                      WhatsApp
                    </label>
                    <input
                      className={inputBase() + " mt-1 w-full"}
                      value={s.whatsapp}
                      onChange={(e) => patch(s.id, { whatsapp: e.target.value })}
                    />
                  </div>

                  <div>
                    <label className="text-xs" style={{ color: "var(--ap-muted)" }}>
                      Wholesale key (opcional)
                    </label>
                    <input
                      className={inputBase() + " mt-1 w-full"}
                      value={s.wholesale_key ?? ""}
                      onChange={(e) => patch(s.id, { wholesale_key: e.target.value || null })}
                      placeholder="Ej: CLAVE-123"
                    />
                  </div>

                  {/* ✅ TEMPORIZADOR */}
                  <div className="md:col-span-2">
                    <label className="text-xs" style={{ color: "var(--ap-muted)" }}>
                      Temporizador (activa hasta)
                    </label>

                    <div className="mt-1 flex flex-col gap-2 md:flex-row md:items-center">
                      <input
                        type="datetime-local"
                        className={inputBase() + " w-full md:w-[340px]"}
                        value={toLocalInputValue(s.active_until)}
                        onChange={(e) => {
                          const iso = e.target.value ? fromLocalInputValue(e.target.value) : null;
                          patch(s.id, { active_until: iso });
                        }}
                      />

                      <div className="flex flex-wrap gap-2">
                        <button
                          className={buttonGhost()}
                          type="button"
                          onClick={() => patch(s.id, { active_until: addDaysISO(1), active: true })}
                        >
                          +1 día
                        </button>

                        <button
                          className={buttonGhost()}
                          type="button"
                          onClick={() => patch(s.id, { active_until: addDaysISO(7), active: true })}
                        >
                          +7 días
                        </button>

                        <button
                          className={buttonGhost()}
                          type="button"
                          onClick={() => patch(s.id, { active_until: addDaysISO(30), active: true })}
                        >
                          +30 días
                        </button>

                        <button
                          className={buttonWarn()}
                          type="button"
                          onClick={() => patch(s.id, { active_until: null })}
                          title="Deja la tienda sin fecha de expiración"
                        >
                          Quitar límite
                        </button>
                      </div>
                    </div>

                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                      {s.active_until ? (
                        <>
                          <span
                            className="rounded-full border px-3 py-1"
                            style={{
                              borderColor: "var(--ap-border)",
                              background: "color-mix(in oklab, var(--ap-card) 72%, transparent)",
                              color: "var(--ap-text)",
                            }}
                          >
                            Expira: {new Date(s.active_until).toLocaleString("es-CO")}
                          </span>

                          <span
                            className="rounded-full border px-3 py-1"
                            style={{
                              borderColor: expired
                                ? "color-mix(in oklab, var(--ap-danger) 40%, var(--ap-border))"
                                : "color-mix(in oklab, var(--ap-success) 40%, var(--ap-border))",
                              background: expired
                                ? "color-mix(in oklab, var(--ap-danger) 12%, transparent)"
                                : "color-mix(in oklab, var(--ap-success) 12%, transparent)",
                              color: "var(--ap-text)",
                            }}
                          >
                            {formatCountdown(s.active_until)}
                          </span>
                        </>
                      ) : (
                        <span
                          className="rounded-full border px-3 py-1"
                          style={{
                            borderColor: "var(--ap-border)",
                            background: "color-mix(in oklab, var(--ap-card) 72%, transparent)",
                            color: "var(--ap-muted)",
                          }}
                        >
                          Sin expiración
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Switches */}
                <div className="mt-4 flex flex-wrap gap-2">
                  <label
                    className={`inline-flex items-center gap-2 rounded-full border px-3 py-2 text-xs ${pill(s.active)}`}
                    title="Si apagas la tienda, los catálogos se apagan automáticamente."
                  >
                    <input
                      type="checkbox"
                      checked={s.active}
                      onChange={(e) => patch(s.id, { active: e.target.checked })}
                    />
                    Activa (manual)
                  </label>

                  <label
                    className={`inline-flex items-center gap-2 rounded-full border px-3 py-2 text-xs ${pill(
                      effectiveRetail
                    )}`}
                    title={!liveActive ? "Tienda inactiva/expirada: catálogo apagado" : ""}
                  >
                    <input
                      type="checkbox"
                      checked={s.catalog_retail}
                      disabled={!liveActive}
                      onChange={(e) => patch(s.id, { catalog_retail: e.target.checked })}
                    />
                    Catálogo Detal
                  </label>

                  <label
                    className={`inline-flex items-center gap-2 rounded-full border px-3 py-2 text-xs ${pill(
                      effectiveWholesale
                    )}`}
                    title={!liveActive ? "Tienda inactiva/expirada: catálogo apagado" : ""}
                  >
                    <input
                      type="checkbox"
                      checked={s.catalog_wholesale}
                      disabled={!liveActive}
                      onChange={(e) => patch(s.id, { catalog_wholesale: e.target.checked })}
                    />
                    Catálogo Mayor
                  </label>
                </div>

                {/* Danger zone */}
                <div className="mt-4 flex flex-wrap gap-2">
                  <button className={buttonWarn()} onClick={() => changeOwner(s)} disabled={saving}>
                    Cambiar owner
                  </button>

                  <button className={buttonDanger()} onClick={() => deleteStore(s)} disabled={saving}>
                    Eliminar
                  </button>
                </div>
              </div>
            );
          })}

          <p className="text-xs" style={{ color: "var(--ap-muted)" }}>
            Mostrando {filtered.length} tienda(s).
          </p>
        </div>
      )}
    </div>
  );
}
