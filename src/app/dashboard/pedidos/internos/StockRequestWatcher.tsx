"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { MessageCircle, PackagePlus, X } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { OPEN_REQUEST_EVENT } from "./types";

type Inbox = {
  incoming: Array<{ id: string; number: number; from_name: string; to_name: string; priority: string; items: number }>;
  arriving: number;
  unread: Array<{ id: string; number: number; from_name: string; to_name: string; count: number; last: string | null; last_user: string | null }>;
};
type Toast = { key: string; id: string; kind: "request" | "message"; title: string; body: string; urgent?: boolean };

/**
 * Avisos al instante de pedidos internos: un pedido nuevo por atender (se queda hasta que lo veas)
 * y mensajes nuevos del chat (se ocultan solos). Funciona en todo el panel.
 */
export function StockRequestWatcher({ storeId }: { storeId: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seenKey = `remhub:sr-seen:${storeId}`;
  const msgBase = useRef<Map<string, number> | null>(null);

  const open = useCallback((id: string) => {
    setToasts((cur) => cur.filter((t) => t.id !== id));
    const target = `/dashboard/pedidos?tab=internos&pedido=${id}`;
    const onInternal = pathname?.startsWith("/dashboard/pedidos") && new URL(window.location.href).searchParams.get("tab") === "internos";
    if (onInternal) window.dispatchEvent(new CustomEvent(OPEN_REQUEST_EVENT, { detail: id }));
    else if (pathname?.startsWith("/dashboard/pedidos")) window.location.assign(target);
    else router.push(target);
  }, [pathname, router]);

  const check = useCallback(async () => {
    const { data, error } = await supabaseBrowser().rpc("erp_stock_inbox", { p_store: storeId });
    if (error || !data) return;
    const inbox = data as Inbox;
    let seen: string[] = [];
    try { seen = JSON.parse(window.localStorage.getItem(seenKey) ?? "[]"); } catch { /* sin almacenamiento */ }
    const fresh = inbox.incoming.filter((r) => !seen.includes(r.id));
    const next: Toast[] = fresh.map((r) => ({
      key: `req-${r.id}`,
      id: r.id,
      kind: "request",
      urgent: r.priority === "urgent",
      title: `${r.priority === "urgent" ? "⚡ Pedido URGENTE" : "📦 Nuevo pedido interno"} #${r.number}`,
      body: `${r.from_name} le pide ${r.items} producto${r.items === 1 ? "" : "s"} a ${r.to_name}. Revisa existencias y prepáralo.`,
    }));
    if (fresh.length) {
      try { window.localStorage.setItem(seenKey, JSON.stringify([...seen, ...fresh.map((r) => r.id)].slice(-300))); } catch { /* sin almacenamiento */ }
      try { navigator.vibrate?.(180); } catch { /* sin vibración */ }
    }
    // Mensajes: solo los que llegan después de abrir el panel (sin avalancha al entrar).
    const current = new Map(inbox.unread.map((u) => [u.id, u.count]));
    const openRoom = (window as Window & { __remhubOpenRequest?: string | null }).__remhubOpenRequest;
    if (msgBase.current) {
      inbox.unread.forEach((u) => {
        const before = msgBase.current?.get(u.id) ?? 0;
        if (u.count > before && u.id !== openRoom) {
          next.push({ key: `msg-${u.id}-${u.count}`, id: u.id, kind: "message", title: `💬 Pedido #${u.number}`, body: `${u.last_user ?? "Alguien"}: ${u.last ?? "Nuevo mensaje"}` });
        }
      });
    }
    msgBase.current = current;
    if (next.length) setToasts((cur) => [...next.filter((n) => !cur.some((c) => c.key === n.key)), ...cur.filter((c) => !(c.kind === "message" && next.some((n) => n.id === c.id && n.kind === "message")))].slice(0, 4));
  }, [storeId, seenKey]);

  useEffect(() => {
    const sb = supabaseBrowser();
    const first = window.setTimeout(() => void check(), 1500);
    const channel = sb
      .channel(`sr-watch-${storeId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "erp_stock_requests", filter: `store_id=eq.${storeId}` }, () => void check())
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "erp_stock_request_messages", filter: `store_id=eq.${storeId}` }, () => void check())
      .subscribe();
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void check(); }, 20000);
    const onFocus = () => void check();
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      void sb.removeChannel(channel);
    };
  }, [storeId, check]);

  // Los mensajes se ocultan solos; los pedidos nuevos se quedan hasta que los veas.
  useEffect(() => {
    if (!toasts.some((t) => t.kind === "message")) return;
    const timer = window.setTimeout(() => setToasts((cur) => cur.filter((t) => t.kind !== "message")), 9000);
    return () => window.clearTimeout(timer);
  }, [toasts]);

  return (
    <div className="pointer-events-none fixed right-3 top-3 z-130 flex w-[min(380px,calc(100vw-1.5rem))] flex-col gap-2 sm:right-5 sm:top-5" aria-live="polite">
      <AnimatePresence initial={false}>
        {toasts.map((t) => {
          const color = t.kind === "message" ? "#8b5cf6" : t.urgent ? "#ef4444" : "#f59e0b";
          return (
            <motion.div
              key={t.key}
              layout
              initial={{ opacity: 0, x: 40, scale: 0.96 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 40, scale: 0.96 }}
              transition={{ type: "spring", stiffness: 420, damping: 32 }}
              className="pointer-events-auto overflow-hidden rounded-2xl border shadow-[0_18px_50px_rgba(0,0,0,0.4)] backdrop-blur-xl"
              style={{ borderColor: `color-mix(in oklab, ${color} 45%, var(--t-card-border))`, background: "color-mix(in oklab, var(--t-bg-base) 92%, transparent)", color: "var(--t-text)" }}
              role="alert"
            >
              <div className="flex gap-3 p-3.5">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl" style={{ background: `color-mix(in oklab, ${color} 18%, transparent)`, color }}>
                  {t.kind === "message" ? <MessageCircle size={19} /> : <PackagePlus size={19} />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-black">{t.title}</p>
                  <p className="mt-0.5 line-clamp-2 text-xs" style={{ color: "var(--t-muted)" }}>{t.body}</p>
                  <div className="mt-2 flex gap-2">
                    <button type="button" onClick={() => open(t.id)} className="rounded-lg px-3 py-1.5 text-xs font-bold text-white" style={{ background: color }}>
                      {t.kind === "message" ? "Responder" : "Ver pedido"}
                    </button>
                    <button type="button" onClick={() => setToasts((cur) => cur.filter((x) => x.key !== t.key))} className="rounded-lg border px-3 py-1.5 text-xs font-semibold" style={{ borderColor: "var(--t-card-border)" }}>
                      Después
                    </button>
                  </div>
                </div>
                <button type="button" onClick={() => setToasts((cur) => cur.filter((x) => x.key !== t.key))} className="grid h-7 w-7 shrink-0 place-items-center rounded-full opacity-60 transition hover:opacity-100" aria-label="Cerrar aviso">
                  <X size={14} />
                </button>
              </div>
              {t.kind === "request" ? <motion.div className="h-1" style={{ background: color }} initial={{ scaleX: 0, originX: 0 }} animate={{ scaleX: 1 }} transition={{ duration: 0.8 }} /> : null}
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
