"use client";

import { useEffect, useMemo, useState } from "react";
import Swal from "sweetalert2";

type Noti = {
  id: string;
  kind: "d10" | "d5" | "d3" | "d0" | "expired";
  title: string;
  body: string;
  expires_at: string | null;
  is_read: boolean;
  created_at: string;
};

function cx(...s: Array<string | false | null | undefined>) {
  return s.filter(Boolean).join(" ");
}

function kindColor(kind: Noti["kind"]) {
  if (kind === "expired") return "border-red-500/40 bg-red-500/15 text-red-100";
  if (kind === "d3") return "border-red-500/30 bg-red-500/10 text-red-100";
  if (kind === "d5") return "border-rose-400/30 bg-rose-400/10 text-rose-100";
  if (kind === "d0") return "border-amber-400/30 bg-amber-400/10 text-amber-100";
  return "border-amber-400/30 bg-amber-400/10 text-amber-100";
}

export default function AdminBell() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Noti[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(false);

  async function refresh() {
    setLoading(true);
    try {
      // 1) generar
      const gen = await fetch("/api/admin/notifications/generate", { method: "POST" });
      const genText = await gen.text();

      if (!gen.ok) {
        await Swal.fire({
          icon: "error",
          title: "Error generando notificaciones",
          text: genText.slice(0, 180),
          background: "#0b0b0b",
          color: "#fff",
        });
        return;
      }

      // 2) listar
      const res = await fetch("/api/admin/notifications/list");
      const listText = await res.text();

      if (!res.ok) {
        await Swal.fire({
          icon: "error",
          title: "Error listando notificaciones",
          text: listText.slice(0, 180),
          background: "#0b0b0b",
          color: "#fff",
        });
        return;
      }

      const data = JSON.parse(listText);
      if (data?.ok) {
        setItems(data.items ?? []);
        setUnread(data.unread ?? 0);
      }
    } catch (e: any) {
      await Swal.fire({
        icon: "error",
        title: "Error inesperado",
        text: e?.message ?? "Error",
        background: "#0b0b0b",
        color: "#fff",
      });
    } finally {
      setLoading(false);
    }
  }

  // auto refresh
  useEffect(() => {
    refresh();
    const t = window.setInterval(refresh, 60_000);
    return () => window.clearInterval(t);
  }, []);

  const unreadIds = useMemo(() => items.filter((x) => !x.is_read).map((x) => x.id), [items]);

  async function markAllRead() {
    if (unreadIds.length === 0) return;
    await fetch("/api/admin/notifications/mark-read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: unreadIds }),
    });
    await refresh();
  }

  // ✅ DEBUG: muestra en pantalla lo que devuelve generate/list
  async function debugPing() {
    try {
      const gen = await fetch("/api/admin/notifications/generate", { method: "POST" });
      const genBody = await gen.text();

      const list = await fetch("/api/admin/notifications/list");
      const listBody = await list.text();

      await Swal.fire({
        icon: "info",
        title: "DEBUG API",
        html: `
          <div style="text-align:left; font-size:12px; opacity:.92">
            <div style="margin-bottom:8px"><b>generate</b> (${gen.status})</div>
            <pre style="white-space:pre-wrap; background:#111; padding:10px; border-radius:12px; max-height:140px; overflow:auto;">${(genBody || "").replace(/</g, "&lt;")}</pre>
            <div style="margin:10px 0 8px"><b>list</b> (${list.status})</div>
            <pre style="white-space:pre-wrap; background:#111; padding:10px; border-radius:12px; max-height:140px; overflow:auto;">${(listBody || "").replace(/</g, "&lt;")}</pre>
          </div>
        `,
        background: "#0b0b0b",
        color: "#fff",
        width: 700,
      });
    } catch (e: any) {
      await Swal.fire({
        icon: "error",
        title: "DEBUG falló",
        text: e?.message ?? "Error",
        background: "#0b0b0b",
        color: "#fff",
      });
    }
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cx(
          "relative inline-flex items-center justify-center",
          "h-11 w-11 rounded-2xl border border-white/10 bg-white/5",
          "backdrop-blur-xl transition hover:bg-white/10"
        )}
        title="Notificaciones"
      >
        <span className="text-[18px]">🔔</span>
        {unread > 0 ? (
          <span className="absolute -right-1 -top-1 grid h-5 min-w-[20px] place-items-center rounded-full bg-fuchsia-500 px-1 text-[11px] font-bold text-black">
            {unread > 99 ? "99+" : unread}
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          className={cx(
            "absolute right-0 mt-2 w-[380px] max-w-[90vw]",
            "rounded-[22px] border border-white/10 bg-black/70 p-3",
            "shadow-[0_18px_80px_rgba(0,0,0,0.55)] backdrop-blur-xl z-50"
          )}
        >
          <div className="flex items-center justify-between gap-2 px-1">
            <p className="text-xs font-semibold tracking-[0.25em] text-white/70">NOTIFICACIONES</p>
            <div className="flex items-center gap-2">
              <button
                onClick={refresh}
                className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] text-white/80 hover:bg-white/10"
              >
                {loading ? "..." : "Actualizar"}
              </button>
              <button
                onClick={markAllRead}
                disabled={unreadIds.length === 0}
                className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] text-white/80 hover:bg-white/10 disabled:opacity-40"
              >
                Marcar leídas
              </button>
              <button
                onClick={debugPing}
                className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] text-white/80 hover:bg-white/10"
                title="Ver respuesta de la API"
              >
                Debug
              </button>
            </div>
          </div>

          <div className="mt-2 max-h-[360px] overflow-auto pr-1 space-y-2">
            {items.length === 0 ? (
              <div className="rounded-2xl border border-white/10 bg-white/5 p-3 text-xs text-white/70">
                No hay notificaciones.
              </div>
            ) : (
              items.map((n) => (
                <div
                  key={n.id}
                  className={cx(
                    "rounded-2xl border p-3",
                    n.is_read ? "border-white/10 bg-white/5" : kindColor(n.kind)
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-xs font-semibold">{n.title}</p>
                    {!n.is_read ? <span className="mt-0.5 h-2 w-2 rounded-full bg-white/80" /> : null}
                  </div>
                  <p className="mt-1 text-[11px] opacity-85">{n.body}</p>
                  {n.expires_at ? (
                    <p className="mt-2 text-[10px] opacity-70">
                      Expira: {new Date(n.expires_at).toLocaleString("es-CO")}
                    </p>
                  ) : null}
                </div>
              ))
            )}
          </div>

          <button
            className="mt-3 w-full rounded-2xl border border-white/10 bg-white/5 py-2 text-xs text-white/80 hover:bg-white/10"
            onClick={() => setOpen(false)}
          >
            Cerrar
          </button>
        </div>
      ) : null}
    </div>
  );
}
