"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import Swal from "sweetalert2";
import { supabaseBrowser } from "@/lib/supabase/client";
import { soundFor } from "@/lib/sounds/notify";

/**
 * Mensajes del equipo en todo el panel: cuenta los sin leer (para el menú) y, si llega uno nuevo mientras
 * estás en otra parte, suena (en una sola pestaña) y muestra un aviso que abre el chat.
 */
export function DmWatcher({ storeId, onUnread }: { storeId: string; onUnread: (n: number) => void }) {
  const me = useRef<string | null>(null);
  const report = useRef(onUnread);
  const router = useRouter();
  const go = useRef(router.push);
  useEffect(() => { report.current = onUnread; go.current = router.push; }, [onUnread, router]);

  useEffect(() => {
    let alive = true;
    let t = 0;
    const count = async () => {
      const { data, error } = await supabaseBrowser().rpc("erp_dm_list", { p_store: storeId });
      if (!alive || error) return;
      report.current(((data ?? []) as Array<{ unread?: number }>).reduce((s, x) => s + Number(x.unread || 0), 0));
    };
    void supabaseBrowser().auth.getUser().then(({ data }) => { me.current = data.user?.id ?? null; });
    void count();
    const ch = supabaseBrowser()
      .channel(`dm-watch-${storeId}-${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "erp_dm_messages", filter: `store_id=eq.${storeId}` }, (msg) => {
        const m = msg.new as { id: string; thread_id: string; user_id: string | null; user_name: string | null; body: string; kind: string };
        window.clearTimeout(t);
        t = window.setTimeout(() => void count(), 400);
        if (m.kind !== "message" || !m.user_id || m.user_id === me.current) return;
        if ((window as Window & { __remhubOpenChat?: string | null }).__remhubOpenChat === m.thread_id && document.visibilityState === "visible") return;
        void (async () => {
          // Chat silenciado (20261273): no suena, salvo que me mencionen con @.
          const sb = supabaseBrowser();
          const [{ data: mutes }, { data: row }] = await Promise.all([
            sb.rpc("erp_chat_my_mutes", { p_scope: "dm" }),
            sb.from("erp_dm_messages").select("mentions").eq("id", m.id).maybeSingle(),
          ]);
          const mentioned = Array.isArray((row as { mentions?: string[] | null } | null)?.mentions) && (row as { mentions: string[] }).mentions.includes(me.current ?? "");
          if (Array.isArray(mutes) && (mutes as string[]).includes(m.thread_id) && !mentioned) return;
          const played = await soundFor(storeId, "message", "dm");
          // Solo la pestaña que sonó muestra el aviso (con varias abiertas no se repite).
          if (!played || document.visibilityState !== "visible") return;
          void Swal.fire({
            toast: true, position: "top-end", timer: 5000, showConfirmButton: true, confirmButtonText: "Abrir", showCloseButton: true,
            background: "var(--t-bg-base)", color: "var(--t-text)", confirmButtonColor: "#8b5cf6",
            title: mentioned ? `📣 ${m.user_name ?? "Alguien"} te mencionó` : `💬 ${m.user_name ?? "Mensaje del equipo"}`, text: m.body.slice(0, 120),
          }).then((r) => { if (r.isConfirmed) go.current(`/dashboard/mensajes?chat=${m.thread_id}`); });
        })();
      })
      .subscribe();
    const onFocus = () => void count();
    window.addEventListener("focus", onFocus);
    const every = window.setInterval(() => void count(), 60000);
    return () => { alive = false; window.clearTimeout(t); window.clearInterval(every); window.removeEventListener("focus", onFocus); void supabaseBrowser().removeChannel(ch); };
  }, [storeId]);
  return null;
}
