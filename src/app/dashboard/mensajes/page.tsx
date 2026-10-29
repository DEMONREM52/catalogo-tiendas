"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { MessageCirclePlus, Search, Users, X } from "lucide-react";
import Swal from "sweetalert2";
import { supabaseBrowser } from "@/lib/supabase/client";
import { getDashboardStore } from "@/lib/store-utils";
import { Chat, initials, threadName, type Thread } from "./Chat";

/**
 * Mensajes del equipo (20261271): chats de dos y grupos, sin necesidad de un pedido. Fotos, videos, audios,
 * notas de voz, llamadas y videollamadas. Cada persona solo ve sus chats.
 */

type Person = { user_id: string; name: string; point: string | null; owner: boolean };
const swal = { background: "var(--t-bg-base)", color: "var(--t-text)", confirmButtonColor: "#8b5cf6" };
const when = (iso: string) => {
  const d = new Date(iso);
  return d.toDateString() === new Date().toDateString() ? d.toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" }) : d.toLocaleDateString("es-CO", { day: "2-digit", month: "2-digit" });
};

export default function MessagesPage() {
  const [storeId, setStoreId] = useState<string | null>(null);
  const [me, setMe] = useState<string | null>(null);
  const [threads, setThreads] = useState<Thread[] | null>(null);
  const [missing, setMissing] = useState(false);
  const [active, setActive] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [newOpen, setNewOpen] = useState(false);

  const loadList = useCallback(async (store: string) => {
    const { data, error } = await supabaseBrowser().rpc("erp_dm_list", { p_store: store });
    if (error) { setMissing(/Could not find the function|schema cache/i.test(error.message)); setThreads([]); return; }
    setThreads((data ?? []) as Thread[]);
  }, []);

  useEffect(() => {
    void (async () => {
      const access = await getDashboardStore().catch(() => null);
      const { data } = await supabaseBrowser().auth.getUser();
      setMe(data.user?.id ?? null);
      if (!access?.store) return;
      setStoreId(access.store.id);
      await loadList(access.store.id);
      const params = new URLSearchParams(window.location.search);
      const chat = params.get("chat");
      if (chat) setActive(chat);
      // Desde pedidos internos («Nuevo chat»): abre de una vez el escoger con quién.
      else if (params.has("nuevo")) setNewOpen(true);
    })();
  }, [loadList]);

  // En vivo: un mensaje nuevo en cualquiera de mis chats actualiza la lista.
  useEffect(() => {
    if (!storeId) return;
    let t = 0;
    const ch = supabaseBrowser()
      .channel(`dm-list-${storeId}-${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "erp_dm_messages", filter: `store_id=eq.${storeId}` }, () => {
        window.clearTimeout(t);
        t = window.setTimeout(() => void loadList(storeId), 300);
      })
      .subscribe();
    return () => { window.clearTimeout(t); void supabaseBrowser().removeChannel(ch); };
  }, [storeId, loadList]);

  const shown = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (threads ?? []).filter((t) => !term || threadName(t).toLowerCase().includes(term) || (t.members ?? []).some((m) => m.name.toLowerCase().includes(term)));
  }, [threads, q]);
  const current = threads?.find((t) => t.id === active) ?? null;
  const refresh = useCallback(() => { if (storeId) void loadList(storeId); }, [storeId, loadList]);

  function open(id: string) {
    setActive(id);
    const u = new URL(window.location.href);
    u.searchParams.set("chat", id);
    window.history.replaceState(null, "", u.toString());
  }

  return (
    <main className="flex h-[calc(100dvh-7rem)] min-h-[480px] overflow-hidden rounded-[28px] border" style={{ borderColor: "var(--t-card-border)", background: "var(--t-card-bg)", color: "var(--t-text)" }}>
      {/* lista de chats */}
      <aside className={`${current ? "hidden md:flex" : "flex"} w-full min-w-0 flex-col border-r md:w-80 md:shrink-0`} style={{ borderColor: "var(--t-card-border)" }}>
        <div className="flex items-center gap-2 px-4 pb-2 pt-4">
          <h1 className="flex-1 text-xl font-black">💬 Mensajes</h1>
          <button type="button" disabled={!storeId || missing} onClick={() => setNewOpen(true)} className="inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-xs font-bold text-white disabled:opacity-40" style={{ background: "var(--t-cta)" }}><MessageCirclePlus size={15} /> Nuevo</button>
        </div>
        <label className="mx-3 mb-2 flex items-center gap-2 rounded-2xl border px-3 py-2" style={{ borderColor: "var(--t-card-border)" }}>
          <Search size={15} style={{ color: "var(--t-muted)" }} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar chat o persona" className="min-w-0 flex-1 bg-transparent text-sm outline-none" style={{ padding: 0, border: 0 }} />
        </label>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
          {missing ? <p className="m-2 rounded-2xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm">Falta ejecutar en Supabase la migración <b>20261271_mensajes_directos.sql</b>.</p> : null}
          {threads === null ? <p className="p-4 text-sm" style={{ color: "var(--t-muted)" }}>Cargando…</p> : null}
          {threads && !threads.length && !missing ? (
            <div className="p-6 text-center text-sm" style={{ color: "var(--t-muted)" }}>
              <p className="text-3xl">💬</p>
              <p className="mt-2">Escríbele a alguien del equipo sin necesidad de un pedido.</p>
              <button type="button" onClick={() => setNewOpen(true)} className="mt-3 rounded-full px-4 py-2 text-xs font-bold text-white" style={{ background: "var(--t-cta)" }}>Empezar un chat</button>
            </div>
          ) : null}
          {shown.map((t) => {
            const name = threadName(t);
            return (
              <button key={t.id} type="button" onClick={() => open(t.id)} className="flex w-full items-center gap-3 rounded-2xl px-2.5 py-2.5 text-left transition hover:bg-[color:var(--t-card-bg-soft)]" style={t.id === active ? { background: "color-mix(in oklab, var(--t-accent) 14%, transparent)" } : undefined}>
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-sm font-black text-white" style={{ background: t.kind === "group" ? "linear-gradient(135deg,#0ea5e9,#8b5cf6)" : "linear-gradient(135deg,#8b5cf6,#ec4899)" }}>
                  {t.kind === "group" ? <Users size={18} /> : initials(name)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <b className="min-w-0 flex-1 truncate text-sm">{name}</b>
                    {t.last ? <span className="shrink-0 text-[10px]" style={{ color: t.unread ? "#10b981" : "var(--t-muted)" }}>{when(t.last.created_at)}</span> : null}
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-xs" style={{ color: "var(--t-muted)" }}>
                      {t.last ? `${t.last.mine ? "Tú: " : t.kind === "group" && t.last.user_name ? `${t.last.user_name}: ` : ""}${t.last.body}` : "Sin mensajes todavía"}
                    </span>
                    {t.unread ? <span className="grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-emerald-500 px-1.5 text-[10px] font-black text-white">{t.unread > 99 ? "99+" : t.unread}</span> : null}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </aside>

      {/* conversación */}
      <section className={`${current ? "flex" : "hidden md:flex"} min-w-0 flex-1 flex-col`}>
        {current && storeId ? (
          <Chat key={current.id} storeId={storeId} thread={current} me={me} onBack={() => setActive(null)} onActivity={refresh} />
        ) : (
          <div className="grid flex-1 place-items-center p-6 text-center" style={{ color: "var(--t-muted)" }}>
            <div>
              <p className="text-5xl">💬</p>
              <p className="mt-3 font-bold" style={{ color: "var(--t-text)" }}>Chatea y llama a tu equipo</p>
              <p className="mt-1 max-w-sm text-sm">Mensajes, fotos, videos, notas de voz, llamadas y videollamadas, sin necesidad de hacer un pedido. Te llegan aunque tengas RemHub cerrada.</p>
            </div>
          </div>
        )}
      </section>

      {storeId ? <NewChat open={newOpen} storeId={storeId} onClose={() => setNewOpen(false)} onOpened={async (id) => { setNewOpen(false); await loadList(storeId); open(id); }} /> : null}
    </main>
  );
}

/** Nuevo chat: una persona (chat de dos) o varias con nombre (grupo). */
function NewChat({ open, storeId, onClose, onOpened }: { open: boolean; storeId: string; onClose: () => void; onOpened: (id: string) => void }) {
  const [people, setPeople] = useState<Person[] | null>(null);
  const [q, setQ] = useState("");
  const [group, setGroup] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    void supabaseBrowser().rpc("erp_dm_people", { p_store: storeId }).then(({ data }) => { if (alive) setPeople((data ?? []) as Person[]); });
    return () => { alive = false; setGroup(false); setPicked(new Set()); setTitle(""); setQ(""); };
  }, [open, storeId]);

  const list = (people ?? []).filter((p) => !q.trim() || `${p.name} ${p.point ?? ""}`.toLowerCase().includes(q.trim().toLowerCase()));

  async function direct(p: Person) {
    setBusy(true);
    const { data, error } = await supabaseBrowser().rpc("erp_dm_open", { p_store: storeId, p_user: p.user_id });
    setBusy(false);
    if (error) return void Swal.fire({ ...swal, icon: "error", title: "No se abrió", text: error.message });
    onOpened((data as { id: string }).id);
  }
  async function createGroup() {
    setBusy(true);
    const { data, error } = await supabaseBrowser().rpc("erp_dm_group_create", { p_store: storeId, p_title: title, p_users: [...picked] });
    setBusy(false);
    if (error) return void Swal.fire({ ...swal, icon: "error", title: "No se creó el grupo", text: error.message });
    onOpened((data as { id: string }).id);
  }

  return (
    <AnimatePresence>
      {open ? (
        <motion.div key="new" className="fixed inset-0 z-[300] grid place-items-end bg-black/55 p-3 backdrop-blur-[2px] sm:place-items-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
          <motion.div initial={{ y: 30, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 30, opacity: 0 }} onClick={(e) => e.stopPropagation()}
            className="flex max-h-[85dvh] w-full max-w-md flex-col overflow-hidden rounded-3xl border shadow-2xl" style={{ borderColor: "var(--t-card-border)", background: "var(--t-bg-base)", color: "var(--t-text)" }}>
            <div className="flex items-center gap-2 border-b px-4 py-3" style={{ borderColor: "var(--t-card-border)" }}>
              <p className="flex-1 font-black">{group ? "Nuevo grupo" : "Nuevo chat"}</p>
              <button type="button" onClick={onClose} className="grid h-8 w-8 place-items-center rounded-full border" style={{ borderColor: "var(--t-card-border)" }} aria-label="Cerrar"><X size={15} /></button>
            </div>
            <div className="space-y-2 p-3">
              <div className="flex gap-1.5 rounded-full p-1" style={{ background: "var(--t-card-bg)" }}>
                {[[false, "Una persona"], [true, "Grupo"]].map(([g, l]) => (
                  <button key={String(g)} type="button" onClick={() => setGroup(Boolean(g))} className="flex-1 rounded-full py-1.5 text-xs font-bold" style={group === g ? { background: "var(--t-accent)", color: "#fff" } : { color: "var(--t-muted)" }}>{l as string}</button>
                ))}
              </div>
              {group ? <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Nombre del grupo (ej. Bodega y Zamora)" maxLength={60} className="w-full rounded-2xl border px-3 py-2.5 text-sm outline-none" style={{ borderColor: "var(--t-card-border)", background: "var(--t-card-bg)" }} /> : null}
              <label className="flex items-center gap-2 rounded-2xl border px-3 py-2" style={{ borderColor: "var(--t-card-border)" }}>
                <Search size={15} style={{ color: "var(--t-muted)" }} />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar persona o punto" className="min-w-0 flex-1 bg-transparent text-sm outline-none" style={{ padding: 0, border: 0 }} />
              </label>
            </div>
            <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pb-2">
              {people === null ? <p className="p-4 text-center text-sm" style={{ color: "var(--t-muted)" }}>Cargando equipo…</p> : null}
              {list.map((p) => (
                <button key={p.user_id} type="button" disabled={busy} onClick={() => (group ? setPicked((cur) => { const n = new Set(cur); if (n.has(p.user_id)) n.delete(p.user_id); else n.add(p.user_id); return n; }) : void direct(p))}
                  className="flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition hover:bg-[color:var(--t-card-bg)] disabled:opacity-50">
                  {group ? <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-md border-2 text-[11px] font-black ${picked.has(p.user_id) ? "border-fuchsia-500 bg-fuchsia-500 text-white" : ""}`} style={picked.has(p.user_id) ? undefined : { borderColor: "var(--t-card-border)" }}>{picked.has(p.user_id) ? "✓" : ""}</span> : null}
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-sm font-black text-white" style={{ background: "linear-gradient(135deg,#8b5cf6,#ec4899)" }}>{initials(p.name)}</span>
                  <span className="min-w-0 flex-1"><b className="block truncate text-sm">{p.name}</b><span className="text-xs" style={{ color: "var(--t-muted)" }}>{p.owner ? "Dueño" : p.point ?? "Todos los puntos"}</span></span>
                </button>
              ))}
            </div>
            {group ? (
              <div className="border-t p-3" style={{ borderColor: "var(--t-card-border)" }}>
                <button type="button" disabled={busy || picked.size < 2 || !title.trim()} onClick={() => void createGroup()} className="w-full rounded-2xl py-3 text-sm font-black text-white disabled:opacity-40" style={{ background: "var(--t-cta)" }}>
                  {picked.size < 2 ? "Escoge al menos dos personas" : !title.trim() ? "Ponle un nombre al grupo" : `Crear grupo con ${picked.size} personas`}
                </button>
              </div>
            ) : null}
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
