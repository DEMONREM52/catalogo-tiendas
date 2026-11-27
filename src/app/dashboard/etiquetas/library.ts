"use client";

import { useCallback, useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { normalizeProfile } from "@/lib/labels/layout";
import { normalizeDesign } from "@/lib/labels/templates";
import type { LabelDesign, LabelTemplate, PrinterProfile } from "@/lib/labels/types";

/** ¿Falta correr la migración 20261347 (las tablas no existen)? */
export const labelsMissing = (e: { code?: string; message?: string } | null | undefined) =>
  Boolean(e && (e.code === "42P01" || e.code === "PGRST205" || /does not exist|Could not find the (table|function)|schema cache/i.test(e.message ?? "")));

export type TemplateVersion = { version: number; name: string; design: LabelDesign; saved_at: string };
export type JobRow = { id: string; created_at: string; user_name: string | null; template_name: string; profile_name: string; total_labels: number; items: Array<{ product_id: string; name: string; qty: number }> };

/** Plantillas e impresoras de la tienda (guardadas en la base, aisladas por tienda). */
export function useLabelLibrary(storeId: string | null) {
  const [templates, setTemplates] = useState<LabelTemplate[]>([]);
  const [profiles, setProfiles] = useState<Array<PrinterProfile & { id: string; is_default: boolean }>>([]);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!storeId) return;
    const sb = supabaseBrowser();
    const [t, p] = await Promise.all([
      sb.from("label_templates").select("id,name,category,design,is_default,favorite,archived_at,updated_at,version").eq("store_id", storeId).order("name"),
      sb.from("label_printer_profiles").select("id,name,profile,is_default").eq("store_id", storeId).order("name"),
    ]);
    setLoading(false);
    if (labelsMissing(t.error) || labelsMissing(p.error)) { setMissing(true); return; }
    if (t.error || p.error) { setError((t.error ?? p.error)!.message); return; }
    setMissing(false);
    setError(null);
    setTemplates((t.data ?? []).map((r) => ({ ...r, design: normalizeDesign(r.design) }) as LabelTemplate));
    setProfiles((p.data ?? []).map((r) => ({ ...normalizeProfile(r.profile), id: r.id as string, name: r.name as string, is_default: Boolean(r.is_default) })));
  }, [storeId]);

  useEffect(() => { const t = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(t); }, [load]);

  const fail = (e: { message: string } | null) => { if (e) throw new Error(labelsMissing(e) ? "Falta correr en Supabase la migración 20261347_etiquetas.sql." : e.message); };

  const api = {
    reload: load,
    async saveTemplate(t: { id?: string | null; name: string; category: string | null; design: LabelDesign }): Promise<string> {
      const sb = supabaseBrowser();
      const row = { name: t.name.trim().slice(0, 80) || "Sin nombre", category: t.category?.trim().slice(0, 40) || null, design: normalizeDesign(t.design) };
      if (t.id && !t.id.startsWith("builtin:")) {
        const { error: e } = await sb.from("label_templates").update(row).eq("id", t.id);
        fail(e);
        await load();
        return t.id;
      }
      const { data, error: e } = await sb.from("label_templates").insert({ ...row, store_id: storeId }).select("id").single();
      fail(e);
      await load();
      return (data as { id: string }).id;
    },
    async patchTemplate(id: string, patch: Partial<{ name: string; favorite: boolean; archived_at: string | null; category: string | null }>) {
      const { error: e } = await supabaseBrowser().from("label_templates").update(patch).eq("id", id);
      fail(e);
      await load();
    },
    async deleteTemplate(id: string) {
      const { error: e } = await supabaseBrowser().from("label_templates").delete().eq("id", id);
      fail(e);
      await load();
    },
    async setDefault(kind: "template" | "profile", id: string) {
      const { error: e } = await supabaseBrowser().rpc("label_set_default", { p_kind: kind, p_id: id });
      fail(e);
      await load();
    },
    async versions(id: string): Promise<TemplateVersion[]> {
      const { data, error: e } = await supabaseBrowser().from("label_template_versions").select("version,name,design,saved_at").eq("template_id", id).order("version", { ascending: false }).limit(30);
      fail(e);
      return (data ?? []).map((v) => ({ ...v, design: normalizeDesign(v.design) }) as TemplateVersion);
    },
    async saveProfile(p: PrinterProfile): Promise<string> {
      const sb = supabaseBrowser();
      const clean = normalizeProfile(p);
      const row = { name: clean.name, profile: { ...clean, id: undefined } };
      if (p.id) {
        const { error: e } = await sb.from("label_printer_profiles").update(row).eq("id", p.id);
        fail(e);
        await load();
        return p.id;
      }
      const { data, error: e } = await sb.from("label_printer_profiles").insert({ ...row, store_id: storeId }).select("id").single();
      fail(e);
      await load();
      return (data as { id: string }).id;
    },
    async deleteProfile(id: string) {
      const { error: e } = await supabaseBrowser().from("label_printer_profiles").delete().eq("id", id);
      fail(e);
      await load();
    },
    /** Historial: lo que se mandó a imprimir (no confirma que salió bien en papel). */
    async logJob(j: { key: string; templateId: string | null; templateName: string; profileName: string; userName: string | null; items: Array<{ product_id: string; name: string; qty: number }>; total: number }) {
      if (!storeId || missing) return;
      await supabaseBrowser().from("label_print_jobs").insert({
        store_id: storeId, client_key: j.key, template_id: j.templateId && !j.templateId.startsWith("builtin:") ? j.templateId : null,
        template_name: j.templateName.slice(0, 80), profile_name: j.profileName.slice(0, 80), user_name: j.userName,
        items: j.items.slice(0, 2000), total_labels: Math.min(20000, Math.max(1, j.total)), method: "dialog", status: "sent",
      });
    },
    async jobs(): Promise<JobRow[]> {
      const { data, error: e } = await supabaseBrowser().from("label_print_jobs").select("id,created_at,user_name,template_name,profile_name,total_labels,items").eq("store_id", storeId!).order("created_at", { ascending: false }).limit(50);
      fail(e);
      return (data ?? []) as JobRow[];
    },
  };
  return { templates, profiles, loading, missing, error, ...api };
}

// ------------------------------------------------------------------ preferencias de este equipo
export type DevicePrefs = { profileId?: string; templateId?: string; level?: number; point?: string; localProfile?: PrinterProfile };
const prefsKey = (storeId: string) => `remhub:labels:${storeId}`;
export function readPrefs(storeId: string): DevicePrefs {
  try { return JSON.parse(window.localStorage.getItem(prefsKey(storeId)) ?? "{}") as DevicePrefs; } catch { return {}; }
}
export function writePrefs(storeId: string, patch: DevicePrefs) {
  try { window.localStorage.setItem(prefsKey(storeId), JSON.stringify({ ...readPrefs(storeId), ...patch })); } catch { /* sin almacenamiento */ }
}
