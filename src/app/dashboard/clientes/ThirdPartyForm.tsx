"use client";

import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Building2, Check, CreditCard, Landmark, Lock, MapPin, Phone, StickyNote, Tag, User, X } from "lucide-react";
import Swal from "sweetalert2";
import { supabaseBrowser } from "@/lib/supabase/client";
import { MoneyInput } from "../MoneyInput";
import { WithDv } from "../nit";
import { CreditMeter } from "./CreditMeter";
import { DOC_TYPES, KINDS, TAX_REGIMES, errorText, normalizeThird, FULL_COLUMNS, type Balance, type ThirdKind, type ThirdParty } from "./terceros";

type Draft = Omit<ThirdParty, "id" | "store_id" | "created_at" | "credit_updated_at" | "credit_updated_by_name"> & { id?: string };
type Seller = { user_id: string; name: string };

const emptyDraft = (kinds: ThirdKind[] = ["customer"]): Draft => ({
  name: "", trade_name: null, kinds, person_type: "natural", document_type: "CC", document_number: null, email: null, mobile: null,
  phone: null, contact_name: null, address: null, city: null, department: null, country: "Colombia", birthday: null, tax_regime: null,
  price_list: 3, seller_user_id: null, user_id: null, job_title: null, commission_pct: 0, bank_name: null, bank_account_type: null,
  bank_account_number: null, supplier_payment_days: 0, tags: [], notes: null, active: true, credit_enabled: false, credit_limit: 0,
  credit_days: 30, credit_blocked: false, credit_blocked_reason: null,
});

const field = "w-full rounded-xl border px-3 py-2.5 text-sm outline-none transition focus:ring-2 focus:ring-fuchsia-500/25";
const fieldStyle = { borderColor: "var(--t-card-border)", background: "color-mix(in oklab, var(--t-card-bg) 92%, transparent)", color: "var(--t-text)" };

function Section({ icon, title, children, hint }: { icon: ReactNode; title: string; children: ReactNode; hint?: string }) {
  return (
    <section className="rounded-2xl border p-4" style={{ borderColor: "var(--t-card-border)", background: "color-mix(in oklab, var(--t-card-bg) 60%, transparent)" }}>
      <h4 className="flex items-center gap-2 text-sm font-bold">{icon} {title}</h4>
      {hint ? <p className="mt-0.5 text-xs" style={{ color: "var(--t-muted)" }}>{hint}</p> : null}
      <div className="mt-3 grid gap-3 sm:grid-cols-2">{children}</div>
    </section>
  );
}

function F({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <label className={`block min-w-0 text-xs font-semibold ${wide ? "sm:col-span-2" : ""}`} style={{ color: "var(--t-muted)" }}>
      {label}
      <div className="mt-1" style={{ color: "var(--t-text)" }}>{children}</div>
    </label>
  );
}

const txt = (v: string | null | undefined) => v ?? "";
const orNull = (v: string) => (v.trim() ? v.trim() : null);

/**
 * Crear o editar un tercero. Se abre como panel lateral (en celular ocupa la pantalla).
 * La sección de crédito solo se edita con el permiso "Créditos".
 */
export function ThirdPartyForm({
  open,
  onClose,
  storeId,
  initial,
  defaultKinds,
  canCredit,
  balance,
  existing,
  onSaved,
  prefill,
}: {
  open: boolean;
  onClose: () => void;
  storeId: string;
  initial: ThirdParty | null;
  defaultKinds?: ThirdKind[];
  canCredit: boolean;
  balance?: Balance | null;
  existing: ThirdParty[];
  onSaved: (row: ThirdParty) => void;
  /** Datos iniciales para un tercero nuevo (ej. lo que se escribió en el buscador del POS). */
  prefill?: Partial<Pick<ThirdParty, "name" | "document_number" | "mobile" | "email" | "person_type" | "document_type">>;
}) {
  const mounted = useSyncExternalStore(() => () => {}, () => true, () => false);
  // El panel se monta de nuevo (key) cada vez que se abre, así arranca con los datos correctos.
  const [draft, setDraft] = useState<Draft>(() => (initial ? { ...initial } : { ...emptyDraft(defaultKinds), ...(prefill ?? {}) }));
  const [saving, setSaving] = useState(false);
  const [sellers, setSellers] = useState<Seller[]>([]);
  const [tagText, setTagText] = useState("");

  useEffect(() => {
    if (!open || sellers.length) return;
    void supabaseBrowser().rpc("erp_sellers", { p_store: storeId }).then(({ data }) => setSellers((data ?? []) as Seller[]));
  }, [open, storeId, sellers.length]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  const has = (k: ThirdKind) => draft.kinds.includes(k);
  const patch = (change: Partial<Draft>) => setDraft((cur) => ({ ...cur, ...change }));
  const juridica = draft.person_type === "juridica";
  const duplicate = useMemo(() => {
    const doc = (draft.document_number ?? "").replace(/\D/g, "");
    if (doc.length < 4) return null;
    return existing.find((t) => t.id !== draft.id && (t.document_number ?? "").replace(/\D/g, "") === doc) ?? null;
  }, [draft.document_number, draft.id, existing]);

  function toggleKind(k: ThirdKind) {
    const next = has(k) ? draft.kinds.filter((x) => x !== k) : [...draft.kinds, k];
    patch({ kinds: next.length ? next : [k] });
  }

  function addTag() {
    const t = tagText.trim();
    if (!t) return;
    if (!draft.tags.includes(t)) patch({ tags: [...draft.tags, t].slice(0, 12) });
    setTagText("");
  }

  async function save() {
    if (saving) return;
    const warn = (title: string, text?: string) => Swal.fire({ icon: "warning", title, text, background: "var(--t-bg-base)", color: "var(--t-text)", confirmButtonColor: "#8b5cf6" });
    const docDigits = (draft.document_number ?? "").replace(/\D/g, "");
    // Lo importante según el tipo de persona.
    if (juridica) {
      if (draft.name.trim().length < 3) return void warn("Escribe la razón social", "Ej: DISTRIBUIDORA LA ESPERANZA S.A.S.");
      if (!["NIT", "NIT_EXT"].includes(draft.document_type)) return void warn("Una empresa se identifica con NIT", "Cambia el tipo de documento a NIT.");
      if (docDigits.length < 6) return void warn("Escribe el NIT de la empresa", "Sin el dígito de verificación: se calcula solo.");
    } else {
      if (draft.name.trim().length < 3) return void warn("Escribe el nombre completo", "Nombres y apellidos.");
      if (draft.document_type === "NIT") return void warn("Una persona natural no usa NIT aquí", "Elige cédula u otro documento, o cambia a Empresa (jurídica).");
      if (draft.document_type !== "OTRO" && docDigits.length < 5) return void warn("Escribe el número de documento", "Es necesario para facturar a su nombre.");
    }
    if (draft.mobile && draft.mobile.replace(/\D/g, "").length < 7) return void warn("Revisa el celular", "Debe tener al menos 7 dígitos.");
    if (draft.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.email.trim())) {
      return void Swal.fire({ icon: "warning", title: "Revisa el correo", background: "var(--t-bg-base)", color: "var(--t-text)" });
    }
    // También se revisa en la base de datos por si el tercero no está en la lista cargada.
    let dup = duplicate;
    if (!dup && docDigits.length >= 5) {
      const { data: found } = await supabaseBrowser().from("billing_customers").select("id,name,document_number").eq("store_id", storeId).eq("document_number", draft.document_number?.trim() ?? "").limit(1);
      const hit = (found ?? []).find((x: { id: string }) => x.id !== draft.id) as { name: string; document_number: string } | undefined;
      if (hit) dup = { ...(existing[0] ?? {}), name: hit.name, document_number: hit.document_number } as ThirdParty;
    }
    if (dup) {
      const go = await Swal.fire({
        icon: "question",
        title: "Documento repetido",
        text: `${dup.name} ya tiene el documento ${dup.document_number}. ¿Guardar de todas formas?`,
        showCancelButton: true,
        confirmButtonText: "Guardar",
        cancelButtonText: "Revisar",
        background: "var(--t-bg-base)",
        color: "var(--t-text)",
        confirmButtonColor: "#8b5cf6",
      });
      if (!go.isConfirmed) return;
    }
    if (draft.credit_blocked && !orNull(txt(draft.credit_blocked_reason))) {
      return void Swal.fire({ icon: "warning", title: "Escribe el motivo del bloqueo", background: "var(--t-bg-base)", color: "var(--t-text)" });
    }
    setSaving(true);
    const payload: Record<string, unknown> = {
      store_id: storeId,
      name: draft.name.trim(),
      trade_name: orNull(txt(draft.trade_name)),
      kinds: draft.kinds,
      person_type: draft.person_type,
      document_type: draft.document_type,
      document_number: orNull(txt(draft.document_number)),
      email: orNull(txt(draft.email))?.toLowerCase() ?? null,
      mobile: orNull(txt(draft.mobile)),
      phone: orNull(txt(draft.phone)),
      contact_name: orNull(txt(draft.contact_name)),
      address: orNull(txt(draft.address)),
      city: orNull(txt(draft.city)),
      department: orNull(txt(draft.department)),
      country: orNull(txt(draft.country)) ?? "Colombia",
      birthday: draft.birthday || null,
      tax_regime: draft.tax_regime || null,
      price_list: draft.price_list,
      seller_user_id: draft.seller_user_id || null,
      user_id: draft.user_id || null,
      job_title: orNull(txt(draft.job_title)),
      commission_pct: Math.min(100, Math.max(0, Number(draft.commission_pct) || 0)),
      bank_name: orNull(txt(draft.bank_name)),
      bank_account_type: draft.bank_account_type || null,
      bank_account_number: orNull(txt(draft.bank_account_number)),
      supplier_payment_days: Math.min(720, Math.max(0, Math.floor(Number(draft.supplier_payment_days) || 0))),
      tags: draft.tags,
      notes: orNull(txt(draft.notes)),
      active: draft.active,
    };
    // El crédito solo lo envía quien tiene el permiso (la base de datos también lo exige).
    if (canCredit) {
      Object.assign(payload, {
        credit_enabled: draft.credit_enabled,
        credit_limit: Math.max(0, Number(draft.credit_limit) || 0),
        credit_days: Math.min(720, Math.max(0, Math.floor(Number(draft.credit_days) || 0))),
        credit_blocked: draft.credit_blocked,
        credit_blocked_reason: draft.credit_blocked ? orNull(txt(draft.credit_blocked_reason)) : null,
      });
    }
    const sb = supabaseBrowser();
    const result = draft.id
      ? await sb.from("billing_customers").update(payload).eq("id", draft.id).select(FULL_COLUMNS).single()
      : await sb.from("billing_customers").insert(payload).select(FULL_COLUMNS).single();
    setSaving(false);
    if (result.error) {
      return void Swal.fire({ icon: "error", title: "No se pudo guardar", text: errorText(result.error), background: "var(--t-bg-base)", color: "var(--t-text)" });
    }
    onSaved(normalizeThird(result.data as unknown as Record<string, unknown>));
    void Swal.fire({ icon: "success", title: draft.id ? "Tercero actualizado" : "Tercero creado", timer: 1100, showConfirmButton: false, background: "var(--t-bg-base)", color: "var(--t-text)" });
    onClose();
  }

  if (!mounted) return null;
  return createPortal(
    <AnimatePresence>
      {open ? (
        <motion.div key="third-form" className="fixed inset-0 z-120 flex justify-end" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <button type="button" aria-label="Cerrar" className="absolute inset-0 cursor-default bg-black/55 backdrop-blur-[3px]" onClick={onClose} />
          <motion.aside
            role="dialog"
            aria-modal="true"
            aria-label={draft.id ? "Editar tercero" : "Nuevo tercero"}
            className="relative flex h-dvh w-full max-w-2xl flex-col border-l shadow-[0_0_80px_rgba(0,0,0,0.45)]"
            style={{ borderColor: "var(--t-card-border)", background: "var(--t-bg-base)", color: "var(--t-text)" }}
            initial={{ x: 60, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 60, opacity: 0 }}
            transition={{ type: "spring", stiffness: 360, damping: 34 }}
          >
            <header className="flex items-start justify-between gap-3 border-b px-5 py-4" style={{ borderColor: "var(--t-card-border)" }}>
              <div>
                <p className="text-xs font-bold uppercase tracking-widest" style={{ color: "var(--t-accent)" }}>{draft.id ? "Editar tercero" : "Nuevo tercero"}</p>
                <h3 className="mt-0.5 text-lg font-black">{draft.name.trim() || "Sin nombre"}</h3>
              </div>
              <button type="button" onClick={onClose} className="grid h-9 w-9 place-items-center rounded-full border transition hover:rotate-90" style={{ borderColor: "var(--t-card-border)" }} aria-label="Cerrar">
                <X size={16} />
              </button>
            </header>

            <div className="flex-1 space-y-4 overflow-y-auto overscroll-contain px-5 py-4">
              <div>
                <p className="text-xs font-semibold" style={{ color: "var(--t-muted)" }}>¿Qué es para tu negocio? (puede ser varias cosas)</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {KINDS.map((k) => {
                    const on = has(k.value);
                    return (
                      <motion.button
                        key={k.value}
                        type="button"
                        whileTap={{ scale: 0.95 }}
                        onClick={() => toggleKind(k.value)}
                        aria-pressed={on}
                        className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-semibold transition"
                        style={on
                          ? { borderColor: "transparent", background: k.color, color: "#fff", boxShadow: `0 6px 16px color-mix(in oklab, ${k.color} 35%, transparent)` }
                          : { borderColor: "var(--t-card-border)", color: "var(--t-text)" }}
                      >
                        {on ? <Check size={14} strokeWidth={3} /> : <span>{k.icon}</span>} {k.label}
                      </motion.button>
                    );
                  })}
                </div>
              </div>

              <Section icon={<User size={15} />} title="Identificación">
                <div className="sm:col-span-2">
                  <div className="inline-flex rounded-full border p-1" style={{ borderColor: "var(--t-card-border)" }}>
                    {(["natural", "juridica"] as const).map((pt) => (
                      <button
                        key={pt}
                        type="button"
                        onClick={() => patch({ person_type: pt, document_type: pt === "juridica" ? "NIT" : draft.document_type === "NIT" ? "CC" : draft.document_type })}
                        className="rounded-full px-4 py-1.5 text-xs font-bold transition"
                        style={draft.person_type === pt ? { background: "var(--t-accent)", color: "#fff" } : { color: "var(--t-muted)" }}
                      >
                        {pt === "natural" ? "👤 Persona natural" : "🏢 Empresa (jurídica)"}
                      </button>
                    ))}
                  </div>
                </div>
                <F label="Tipo de documento">
                  <select className={field} style={fieldStyle} value={draft.document_type} onChange={(e) => patch({ document_type: e.target.value })}>
                    {DOC_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </F>
                <F label="Número de documento">
                  <WithDv value={draft.document_type === "NIT" ? draft.document_number : null}>
                    <input className={field} style={fieldStyle} inputMode="numeric" value={txt(draft.document_number)} onChange={(e) => patch({ document_number: e.target.value })} placeholder="Sin puntos ni guiones" />
                  </WithDv>
                  {duplicate ? <span className="mt-1 block text-[11px] text-amber-500">⚠️ Ya existe: {duplicate.name}</span> : null}
                </F>
                <F label={juridica ? "Razón social *" : "Nombre completo *"} wide>
                  <input className={field} style={fieldStyle} value={draft.name} onChange={(e) => patch({ name: e.target.value })} placeholder={juridica ? "Ej: Distribuidora La Esperanza S.A.S." : "Nombres y apellidos"} autoFocus={!draft.id} />
                </F>
                <F label="Nombre comercial">
                  <input className={field} style={fieldStyle} value={txt(draft.trade_name)} onChange={(e) => patch({ trade_name: e.target.value })} placeholder="Como lo conocen" />
                </F>
                {juridica ? (
                  <F label="Persona de contacto">
                    <input className={field} style={fieldStyle} value={txt(draft.contact_name)} onChange={(e) => patch({ contact_name: e.target.value })} />
                  </F>
                ) : (
                  <F label="Cumpleaños">
                    <input type="date" className={field} style={fieldStyle} value={txt(draft.birthday)} onChange={(e) => patch({ birthday: e.target.value || null })} />
                  </F>
                )}
              </Section>

              <Section icon={<Phone size={15} />} title="Contacto">
                <F label="WhatsApp / celular">
                  <input className={field} style={fieldStyle} inputMode="tel" value={txt(draft.mobile)} onChange={(e) => patch({ mobile: e.target.value })} placeholder="3001234567" />
                </F>
                <F label="Teléfono fijo">
                  <input className={field} style={fieldStyle} inputMode="tel" value={txt(draft.phone)} onChange={(e) => patch({ phone: e.target.value })} />
                </F>
                <F label="Correo (para facturas)" wide>
                  <input type="email" className={field} style={fieldStyle} value={txt(draft.email)} onChange={(e) => patch({ email: e.target.value })} placeholder="correo@empresa.com" />
                </F>
              </Section>

              <Section icon={<MapPin size={15} />} title="Ubicación">
                <F label="Dirección" wide>
                  <input className={field} style={fieldStyle} value={txt(draft.address)} onChange={(e) => patch({ address: e.target.value })} placeholder="Calle, número, barrio" />
                </F>
                <F label="Ciudad / municipio">
                  <input className={field} style={fieldStyle} value={txt(draft.city)} onChange={(e) => patch({ city: e.target.value })} />
                </F>
                <F label="Departamento">
                  <input className={field} style={fieldStyle} value={txt(draft.department)} onChange={(e) => patch({ department: e.target.value })} />
                </F>
              </Section>

              <Section icon={<Building2 size={15} />} title="Comercial y tributario">
                {has("customer") ? (
                  <F label="Lista de precio">
                    <select className={field} style={fieldStyle} value={draft.price_list} onChange={(e) => patch({ price_list: Number(e.target.value) })}>
                      {[1, 2, 3, 4, 5].map((v) => <option key={v} value={v}>Precio {v}</option>)}
                    </select>
                  </F>
                ) : null}
                <F label="Régimen tributario">
                  <select className={field} style={fieldStyle} value={txt(draft.tax_regime)} onChange={(e) => patch({ tax_regime: e.target.value || null })}>
                    {TAX_REGIMES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </F>
                {has("customer") ? (
                  <F label="Vendedor asignado">
                    <select className={field} style={fieldStyle} value={txt(draft.seller_user_id)} onChange={(e) => patch({ seller_user_id: e.target.value || null })}>
                      <option value="">Sin asignar</option>
                      {sellers.map((s) => <option key={s.user_id} value={s.user_id}>{s.name}</option>)}
                    </select>
                  </F>
                ) : null}
                {has("supplier") ? (
                  <F label="Días de pago al proveedor">
                    <input type="number" min={0} max={720} className={field} style={fieldStyle} value={draft.supplier_payment_days} onChange={(e) => patch({ supplier_payment_days: Number(e.target.value) })} />
                  </F>
                ) : null}
              </Section>

              {has("employee") || has("seller") || has("partner") ? (
                <Section icon={<User size={15} />} title="Equipo de trabajo" hint="Para trabajadores, vendedores y asociados.">
                  <F label="Cargo / rol">
                    <input className={field} style={fieldStyle} value={txt(draft.job_title)} onChange={(e) => patch({ job_title: e.target.value })} placeholder="Ej: Asesor comercial" />
                  </F>
                  <F label="Comisión (%)">
                    <input type="number" min={0} max={100} step={0.5} className={field} style={fieldStyle} value={draft.commission_pct} onChange={(e) => patch({ commission_pct: Number(e.target.value) })} />
                  </F>
                  <F label="Usuario del sistema vinculado" wide>
                    <select className={field} style={fieldStyle} value={txt(draft.user_id)} onChange={(e) => patch({ user_id: e.target.value || null })}>
                      <option value="">Ninguno</option>
                      {sellers.map((s) => <option key={s.user_id} value={s.user_id}>{s.name}</option>)}
                    </select>
                  </F>
                </Section>
              ) : null}

              {has("supplier") || has("employee") || has("seller") || has("partner") || has("carrier") ? (
                <Section icon={<Landmark size={15} />} title="Datos bancarios" hint="Para pagarle por transferencia.">
                  <F label="Banco">
                    <input className={field} style={fieldStyle} value={txt(draft.bank_name)} onChange={(e) => patch({ bank_name: e.target.value })} placeholder="Ej: Bancolombia" />
                  </F>
                  <F label="Tipo de cuenta">
                    <select className={field} style={fieldStyle} value={txt(draft.bank_account_type)} onChange={(e) => patch({ bank_account_type: e.target.value || null })}>
                      <option value="">—</option>
                      <option value="ahorros">Ahorros</option>
                      <option value="corriente">Corriente</option>
                      <option value="billetera">Billetera digital (Nequi, Daviplata…)</option>
                    </select>
                  </F>
                  <F label="Número de cuenta" wide>
                    <input className={field} style={fieldStyle} value={txt(draft.bank_account_number)} onChange={(e) => patch({ bank_account_number: e.target.value })} />
                  </F>
                </Section>
              ) : null}

              {has("customer") ? (
                <section
                  className="rounded-2xl border p-4"
                  style={{
                    borderColor: draft.credit_enabled ? "color-mix(in oklab, #22c55e 45%, transparent)" : "var(--t-card-border)",
                    background: draft.credit_enabled ? "color-mix(in oklab, #22c55e 7%, transparent)" : "color-mix(in oklab, var(--t-card-bg) 60%, transparent)",
                  }}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h4 className="flex items-center gap-2 text-sm font-bold"><CreditCard size={15} /> Crédito</h4>
                    {canCredit ? (
                      <button
                        type="button"
                        role="switch"
                        aria-checked={draft.credit_enabled}
                        onClick={() => patch({ credit_enabled: !draft.credit_enabled })}
                        className="relative h-7 w-12 rounded-full transition"
                        style={{ background: draft.credit_enabled ? "#22c55e" : "var(--t-card-border)" }}
                      >
                        <span className="absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all" style={{ left: draft.credit_enabled ? 26 : 4 }} />
                      </button>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs" style={{ color: "var(--t-muted)" }}><Lock size={12} /> Solo con permiso de Créditos</span>
                    )}
                  </div>
                  {draft.id && (draft.credit_enabled || (balance?.open_balance ?? 0) > 0) ? (
                    <div className="mt-3">
                      <CreditMeter enabled={draft.credit_enabled} blocked={draft.credit_blocked} limit={draft.credit_limit} used={balance?.open_balance ?? 0} overdue={balance?.overdue_balance} overdueCount={balance?.overdue_count} />
                    </div>
                  ) : null}
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <F label="Cupo de crédito">
                      <MoneyInput className={field} style={fieldStyle} value={draft.credit_limit} disabled={!canCredit || !draft.credit_enabled} onValueChange={(v) => patch({ credit_limit: v ?? 0 })} />
                    </F>
                    <F label="Plazo (días)">
                      <div className="flex gap-1.5">
                        <input type="number" min={0} max={720} className={field} style={fieldStyle} value={draft.credit_days} disabled={!canCredit || !draft.credit_enabled} onChange={(e) => patch({ credit_days: Number(e.target.value) })} />
                        {[15, 30, 60].map((d) => (
                          <button key={d} type="button" disabled={!canCredit || !draft.credit_enabled} onClick={() => patch({ credit_days: d })} className="shrink-0 rounded-xl border px-2 text-xs font-semibold disabled:opacity-40" style={{ borderColor: draft.credit_days === d ? "var(--t-accent)" : "var(--t-card-border)" }}>
                            {d}
                          </button>
                        ))}
                      </div>
                    </F>
                    {canCredit && draft.credit_enabled ? (
                      <div className="sm:col-span-2">
                        <label className="flex cursor-pointer items-center gap-2 text-sm font-semibold">
                          <input type="checkbox" className="h-4 w-4 accent-red-500" checked={draft.credit_blocked} onChange={(e) => patch({ credit_blocked: e.target.checked })} />
                          Bloquear crédito temporalmente
                        </label>
                        {draft.credit_blocked ? (
                          <input className={`${field} mt-2`} style={fieldStyle} value={txt(draft.credit_blocked_reason)} onChange={(e) => patch({ credit_blocked_reason: e.target.value })} placeholder="Motivo del bloqueo (ej: mora de 45 días)" />
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                  {initial?.credit_updated_by_name ? (
                    <p className="mt-2 text-[11px]" style={{ color: "var(--t-muted)" }}>Último cambio de crédito: {initial.credit_updated_by_name}</p>
                  ) : null}
                </section>
              ) : null}

              <Section icon={<Tag size={15} />} title="Etiquetas y notas">
                <div className="sm:col-span-2">
                  <div className="flex flex-wrap gap-1.5">
                    {draft.tags.map((t) => (
                      <button key={t} type="button" onClick={() => patch({ tags: draft.tags.filter((x) => x !== t) })} className="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold" style={{ borderColor: "var(--t-card-border)" }}>
                        #{t} <X size={11} />
                      </button>
                    ))}
                    <input
                      className="min-w-32 flex-1 rounded-full border px-3 py-1 text-xs outline-none"
                      style={fieldStyle}
                      value={tagText}
                      onChange={(e) => setTagText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === ",") {
                          e.preventDefault();
                          addTag();
                        }
                      }}
                      onBlur={addTag}
                      placeholder="Agregar etiqueta (Enter): mayorista, VIP…"
                    />
                  </div>
                </div>
                <F label="Notas internas" wide>
                  <textarea className={`${field} min-h-20`} style={fieldStyle} value={txt(draft.notes)} onChange={(e) => patch({ notes: e.target.value })} placeholder="Horarios, preferencias, acuerdos…" />
                </F>
              </Section>

              <label className="flex cursor-pointer items-center justify-between gap-3 rounded-2xl border px-4 py-3" style={{ borderColor: "var(--t-card-border)" }}>
                <span>
                  <b className="flex items-center gap-2 text-sm"><StickyNote size={15} /> Tercero activo</b>
                  <span className="text-xs" style={{ color: "var(--t-muted)" }}>Los inactivos no aparecen para vender ni comprar, pero conservan su historial.</span>
                </span>
                <input type="checkbox" className="h-5 w-5 accent-fuchsia-600" checked={draft.active} onChange={(e) => patch({ active: e.target.checked })} />
              </label>
            </div>

            <footer className="flex items-center justify-end gap-2 border-t px-5 py-3" style={{ borderColor: "var(--t-card-border)" }}>
              <button type="button" onClick={onClose} className="rounded-xl border px-4 py-2.5 text-sm font-semibold" style={{ borderColor: "var(--t-card-border)" }}>
                Cancelar
              </button>
              <button type="button" onClick={() => void save()} disabled={saving} className="rounded-xl px-5 py-2.5 text-sm font-bold text-white disabled:opacity-60" style={{ background: "linear-gradient(135deg, var(--t-accent), var(--t-accent2, var(--t-accent)))" }}>
                {saving ? "Guardando…" : draft.id ? "💾 Guardar cambios" : "➕ Crear tercero"}
              </button>
            </footer>
          </motion.aside>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}
