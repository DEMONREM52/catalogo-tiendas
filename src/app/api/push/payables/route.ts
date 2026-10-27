import { NextResponse } from "next/server";
import { cronAuthorized } from "@/lib/audit/anchor";
import { pushAdminClient, sendToUsers, type PushPayload } from "@/lib/push/server";
import { notifyStoreWhatsApp } from "@/lib/notify/store-whatsapp";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Digest = { store_id: string; user_id: string; n: number; overdue: number; due_today: number; amount: number; first_name: string | null };

const money = (v: number) => `$ ${Math.round(Number(v) || 0).toLocaleString("es-CO")}`;

/**
 * Resumen diario al celular (cron de Vercel, 8:00 a. m. Colombia): cuentas por pagar y deudas vencidas de los puntos con la bodega.
 * Cada persona recibe solo las cuentas de sus puntos que según las reglas tocan hoy.
 * Se envía una sola vez por persona y día (erp_push_log).
 */
export async function GET(request: Request) {
  if (!cronAuthorized(request)) return NextResponse.json({ ok: false }, { status: 401 });
  const admin = pushAdminClient();
  // Sin notificaciones al celular configuradas igual sale el WhatsApp (sendToUsers no envía nada).
  if (!admin) return NextResponse.json({ ok: false, skipped: "not-configured" });

  const { data, error } = await admin.rpc("erp_payable_push_digest");
  if (error) return NextResponse.json({ ok: false, error: "digest" }, { status: 500 });

  const day = new Date().toLocaleDateString("en-CA", { timeZone: "America/Bogota" });
  const byStore = new Map<string, Map<string, PushPayload>>();
  for (const d of (data ?? []) as Digest[]) {
    const { error: dup } = await admin.from("erp_push_log").insert({ key: `payables:${d.store_id}:${d.user_id}:${day}` });
    if (dup) continue;
    const parts = [
      d.overdue ? `${d.overdue} vencida${d.overdue === 1 ? "" : "s"}` : "",
      d.due_today ? `${d.due_today} vence${d.due_today === 1 ? "" : "n"} hoy` : "",
    ].filter(Boolean);
    const payload: PushPayload = {
      title: d.overdue ? "🔴 Cuentas por pagar vencidas" : "💸 Cuentas por pagar por vencer",
      body: `${d.n === 1 ? `${d.first_name ?? "Un proveedor"}` : `${d.n} cuentas`} · ${money(d.amount)}${parts.length ? ` · ${parts.join(", ")}` : ""}. Toca para revisarlas.`,
      url: "/dashboard/inventario?tab=payables",
      tag: `payables-${day}`,
      urgent: d.overdue > 0,
    };
    if (!byStore.has(d.store_id)) byStore.set(d.store_id, new Map());
    byStore.get(d.store_id)!.set(d.user_id, payload);
  }

  let sent = 0;
  for (const [storeId, payloads] of byStore) sent += (await sendToUsers(admin, storeId, payloads)).sent;

  // WhatsApp al equipo (si la tienda eligió «cuentas por pagar»): el resumen de toda la tienda (el del dueño, que ve todo).
  const whole = new Map<string, Digest>();
  for (const d of (data ?? []) as Digest[]) if (!whole.has(d.store_id) || d.n > whole.get(d.store_id)!.n) whole.set(d.store_id, d);
  let whatsapp = 0;
  if (whole.size) {
    const { data: stores } = await admin.from("stores").select("id,name").in("id", [...whole.keys()]);
    const names = new Map(((stores ?? []) as Array<{ id: string; name: string }>).map((s) => [s.id, s.name]));
    for (const [storeId, d] of whole) {
      const name = names.get(storeId) ?? "Tu tienda";
      const parts = [d.overdue ? `${d.overdue} vencida${d.overdue === 1 ? "" : "s"}` : "", d.due_today ? `${d.due_today} vence${d.due_today === 1 ? "" : "n"} hoy` : ""].filter(Boolean);
      const text = `💸 ${name}: ${d.n === 1 ? `1 cuenta por pagar (${d.first_name ?? "proveedor"})` : `${d.n} cuentas por pagar`} por ${money(d.amount)}${parts.length ? ` · ${parts.join(", ")}` : ""}. Revísalas en RemHub → Inventario → Cuentas por pagar.`;
      whatsapp += (await notifyStoreWhatsApp(admin, storeId, "payables", name, text, day)).sent;
    }
  }

  // Deudas vencidas de los puntos con la bodega (20261126). Si la migración aún no está, se omite.
  const internal = await sendInternalDigest(admin, day);
  // Permisos temporales vencidos: se quitan de la lista (la base ya los bloqueaba desde que vencieron; 20261127).
  const { data: expired } = await admin.rpc("erp_permission_grants_cleanup");
  // Plan de RemHub: prueba por terminar, plan por vencer o en días de gracia (20261213). Sin la migración se omite.
  const plan = await sendPlanDigest(admin, day);
  // Cumpleaños del equipo (20261251): a todos, el mismo día, el día anterior y una semana antes.
  const birthdays = await sendBirthdayDigest(admin, day);
  return NextResponse.json({ ok: true, people: [...byStore.values()].reduce((s, m) => s + m.size, 0), sent, whatsapp, internal, plan, birthdays, expired_permissions: expired ?? null });
}

type BirthdayDigest = { store_id: string; user_id: string; today_names: string[] | null; tomorrow_names: string[] | null; week_names: string[] | null };

const list = (names: string[]) => (names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} y ${names.at(-1)}`);

async function sendBirthdayDigest(admin: NonNullable<ReturnType<typeof pushAdminClient>>, day: string) {
  const { data, error } = await admin.rpc("erp_birthday_push_digest");
  if (error) return { skipped: true };
  const byStore = new Map<string, Map<string, PushPayload>>();
  for (const d of (data ?? []) as BirthdayDigest[]) {
    const { error: dup } = await admin.from("erp_push_log").insert({ key: `birthday:${d.store_id}:${d.user_id}:${day}` });
    if (dup) continue;
    const today = d.today_names ?? [], tomorrow = d.tomorrow_names ?? [], week = d.week_names ?? [];
    const payload: PushPayload = today.length
      ? { title: `🎂🎉 ¡Hoy cumple${today.length > 1 ? "n" : ""} años ${list(today)}!`, body: `Entra a RemHub y déjale${today.length > 1 ? "s" : ""} tu felicitación en el muro 🥳${tomorrow.length ? ` · Mañana: ${list(tomorrow)}` : ""}`, url: "/dashboard?cumple=1", tag: `birthday-${day}`, urgent: true }
      : tomorrow.length
        ? { title: `🎈 Mañana cumple${tomorrow.length > 1 ? "n" : ""} ${list(tomorrow)}`, body: "¡Prepara la sorpresa! Ya puedes dejar tu felicitación en RemHub 🎁", url: "/dashboard?cumple=1", tag: `birthday-${day}` }
        : { title: `🗓️ En una semana cumple${week.length > 1 ? "n" : ""} ${list(week)}`, body: "Faltan 7 días. ¿Organizamos algo? 🎉", url: "/dashboard?cumple=1", tag: `birthday-${day}` };
    if (!byStore.has(d.store_id)) byStore.set(d.store_id, new Map());
    byStore.get(d.store_id)!.set(d.user_id, payload);
  }
  let sent = 0;
  for (const [storeId, payloads] of byStore) sent += (await sendToUsers(admin, storeId, payloads)).sent;
  return { people: [...byStore.values()].reduce((s, m) => s + m.size, 0), sent };
}

type PlanDigest = { store_id: string; user_id: string; kind: "trial_ending" | "plan_due" | "grace"; days: number; plan_name: string | null };

async function sendPlanDigest(admin: NonNullable<ReturnType<typeof pushAdminClient>>, day: string) {
  const { data, error } = await admin.rpc("saas_push_digest");
  if (error) return { skipped: true };
  let sent = 0;
  for (const d of (data ?? []) as PlanDigest[]) {
    const { error: dup } = await admin.from("erp_push_log").insert({ key: `saas:${d.store_id}:${day}` });
    if (dup) continue;
    const payload: PushPayload = d.kind === "trial_ending"
      ? { title: "✨ Tu prueba de RemHub termina pronto", body: `${d.days ? `Te queda${d.days === 1 ? "" : "n"} ${d.days} día${d.days === 1 ? "" : "s"}` : "Termina hoy"} de ${d.plan_name ?? "tu prueba"}. Elige tu plan para no perder funciones; tus datos siguen guardados.`, url: "/dashboard/plan", tag: `saas-${day}` }
      : d.kind === "grace"
        ? { title: "⚠️ Tu plan de RemHub venció", body: "Estás en días de gracia. Renueva para seguir con todas tus funciones.", url: "/dashboard/plan", tag: `saas-${day}`, urgent: true }
        : { title: "💎 Tu plan de RemHub vence pronto", body: `${d.plan_name ?? "Tu plan"} vence en ${d.days} día${d.days === 1 ? "" : "s"}. Renuévalo en un toque.`, url: "/dashboard/plan", tag: `saas-${day}` };
    sent += (await sendToUsers(admin, d.store_id, new Map([[d.user_id, payload]]))).sent;
  }
  return { people: (data ?? []).length, sent };
}

type InternalDigest = { store_id: string; user_id: string; points: number; overdue: number; max_days: number; first_name: string | null };

async function sendInternalDigest(admin: NonNullable<ReturnType<typeof pushAdminClient>>, day: string) {
  const { data, error } = await admin.rpc("erp_internal_push_digest");
  if (error) return { skipped: true };
  const byStore = new Map<string, Map<string, PushPayload>>();
  for (const d of (data ?? []) as InternalDigest[]) {
    const { error: dup } = await admin.from("erp_push_log").insert({ key: `internal:${d.store_id}:${d.user_id}:${day}` });
    if (dup) continue;
    const payload: PushPayload = {
      title: "🤝 Deuda vencida con la bodega",
      body: d.points === 1
        ? `${d.first_name ?? "Un punto"} debe ${money(d.overdue)} vencido${d.max_days ? ` (hace ${d.max_days} día${d.max_days === 1 ? "" : "s"})` : ""}. Toca para ver la cuenta.`
        : `${d.points} puntos deben ${money(d.overdue)} vencido; el más alto: ${d.first_name ?? "—"}. Toca para ver las cuentas.`,
      url: "/dashboard/inventario?tab=internal",
      tag: `internal-${day}`,
      urgent: d.max_days >= 7,
    };
    if (!byStore.has(d.store_id)) byStore.set(d.store_id, new Map());
    byStore.get(d.store_id)!.set(d.user_id, payload);
  }
  let sent = 0;
  for (const [storeId, payloads] of byStore) sent += (await sendToUsers(admin, storeId, payloads)).sent;
  return { people: [...byStore.values()].reduce((s, m) => s + m.size, 0), sent };
}
