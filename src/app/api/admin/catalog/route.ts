import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

function getEnvironment() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !anonKey) {
    throw new ApiError("Falta configurar la conexión de Supabase en el servidor.", 500);
  }
  if (!serviceRoleKey) {
    throw new ApiError(
      "Falta SUPABASE_SERVICE_ROLE_KEY en el servidor. Configura la llave service_role en el hosting y vuelve a desplegar; no la compartas ni la publiques como NEXT_PUBLIC_.",
      500,
    );
  }

  return { url, anonKey, serviceRoleKey };
}

async function authorizeAdmin(request: Request) {
  const accessToken = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!accessToken) throw new ApiError("Inicia sesión para continuar.", 401);

  const { url, anonKey, serviceRoleKey } = getEnvironment();
  const authClient = createClient(url, anonKey, { auth: { persistSession: false } });
  const { data: authData, error: authError } = await authClient.auth.getUser(accessToken);
  if (authError || !authData.user) {
    throw new ApiError("La sesión no es válida. Inicia sesión de nuevo.", 401);
  }

  const admin = createClient(url, serviceRoleKey, { auth: { persistSession: false } });
  const { data: profile, error: profileError } = await admin
    .from("user_profiles")
    .select("role")
    .eq("user_id", authData.user.id)
    .maybeSingle();

  if (profileError) throw new ApiError(profileError.message, 500);
  if (profile?.role !== "admin") throw new ApiError("No tienes permisos de administrador.", 403);

  return admin;
}

function respondWithError(error: unknown) {
  const status = error instanceof ApiError ? error.status : 500;
  const message = error instanceof Error ? error.message : "Error inesperado.";
  if (status >= 500) console.error("Error cargando catálogo administrativo:", message);
  return NextResponse.json({ ok: false, error: message }, { status });
}

export async function GET(request: Request) {
  try {
    const admin = await authorizeAdmin(request);
    const params = new URL(request.url).searchParams;
    const resource = params.get("resource");

    if (resource === "orders") {
      const limit = Math.min(1000, Math.max(1, Number(params.get("limit")) || 1000));
      const offset = Math.max(0, Number(params.get("offset")) || 0);
      let query = admin
        .from("orders")
        .select(
          "id,store_id,catalog_type,status,payment_status,total,token,receipt_no,created_at,customer_name,customer_whatsapp,customer_note,stores(name,slug)",
        )
        .order("created_at", { ascending: false })
        .range(offset, offset + limit - 1);
      const storeId = params.get("storeId");
      if (storeId && storeId !== "all") query = query.eq("store_id", storeId);
      const { data, error } = await query;
      if (error) throw new ApiError(error.message, 500);
      return NextResponse.json({ data: data ?? [] });
    }

    if (resource === "users") {
      const pageSize = 1000;
      const [profilesResult, storesResult, membershipsResult] = await Promise.all([
        admin.from("user_profiles").select("user_id,role,created_at").order("created_at", { ascending: false }),
        admin.from("stores").select("id,name,slug,owner_id"),
        admin.from("store_users").select("store_id,user_id,username,display_name,role,active,permissions,created_at"),
      ]);
      if (profilesResult.error) throw new ApiError(profilesResult.error.message, 500);
      if (storesResult.error) throw new ApiError(storesResult.error.message, 500);
      if (membershipsResult.error) throw new ApiError(membershipsResult.error.message, 500);

      const authUsers: Array<{
        id: string;
        email?: string;
        created_at: string;
        last_sign_in_at?: string;
        user_metadata?: Record<string, unknown>;
      }> = [];
      for (let page = 1; ; page += 1) {
        const { data, error } = await admin.auth.admin.listUsers({ page, perPage: pageSize });
        if (error) throw new ApiError(error.message, 500);
        authUsers.push(...data.users);
        if (data.users.length < pageSize) break;
      }

      const stores = storesResult.data ?? [];
      const storeNames = new Map(stores.map((store) => [store.id, store]));
      const membershipsByUser = new Map<string, Array<Record<string, unknown>>>();
      for (const membership of membershipsResult.data ?? []) {
        const store = storeNames.get(membership.store_id);
        const current = membershipsByUser.get(membership.user_id) ?? [];
        current.push({
          store_id: membership.store_id,
          store_name: store?.name ?? "Tienda",
          store_slug: store?.slug ?? "",
          username: membership.username,
          display_name: membership.display_name,
          role: membership.role,
          active: membership.active,
          permissions: membership.permissions ?? [],
          created_at: membership.created_at,
        });
        membershipsByUser.set(membership.user_id, current);
      }

      const profileByUser = new Map((profilesResult.data ?? []).map((profile) => [profile.user_id, profile]));
      const authById = new Map(authUsers.map((user) => [user.id, user]));
      const userIds = new Set([
        ...authById.keys(),
        ...profileByUser.keys(),
        ...stores.map((store) => store.owner_id),
        ...membershipsByUser.keys(),
      ]);
      const data = [...userIds].map((userId) => {
        const authUser = authById.get(userId);
        const profile = profileByUser.get(userId);
        const ownedStores = stores
          .filter((store) => store.owner_id === userId)
          .map((store) => ({ id: store.id, name: store.name, slug: store.slug }));
        return {
          user_id: userId,
          email: authUser?.email ?? null,
          role: profile?.role ?? "sin perfil",
          created_at: profile?.created_at ?? authUser?.created_at ?? null,
          last_sign_in_at: authUser?.last_sign_in_at ?? null,
          display_name:
            typeof authUser?.user_metadata?.display_name === "string"
              ? authUser.user_metadata.display_name
              : null,
          owned_stores: ownedStores,
          memberships: membershipsByUser.get(userId) ?? [],
        };
      });
      data.sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));
      return NextResponse.json({ data });
    }

    if (resource === "stores") {
      const { data, error } = await admin
        .from("stores")
        .select(
          "id,name,slug,whatsapp,owner_id,active,active_until,catalog_retail,catalog_wholesale,wholesale_key,created_at",
        )
        .order("created_at", { ascending: false });
      if (error) throw new ApiError(error.message, 500);
      return NextResponse.json({ data: data ?? [] });
    }

    const storeId = params.get("storeId");
    if (!storeId) throw new ApiError("Selecciona una tienda.", 400);

    if (resource === "categories") {
      let query = admin
        .from("product_categories")
        .select("id,store_id,name,image_url,sort_order,active,created_at")
        .eq("store_id", storeId)
        .order("sort_order", { ascending: true });
      if (params.get("activeOnly") === "true") query = query.eq("active", true);
      const { data, error } = await query;
      if (error) throw new ApiError(error.message, 500);
      return NextResponse.json({ data: data ?? [] });
    }

    if (resource !== "products") {
      throw new ApiError("Recurso administrativo no válido.", 400);
    }

    if (params.get("search")) {
      const limit = Math.min(50, Math.max(1, Number(params.get("limit")) || 50));
      const offset = Math.max(0, Number(params.get("offset")) || 0);
      const status = params.get("status") ?? "all";
      if (!["all", "active", "inactive"].includes(status)) {
        throw new ApiError("Filtro de estado no válido.", 400);
      }
      const categoryId = params.get("categoryId");
      const { data, error } = await admin.rpc("search_products_pro", {
        p_store_id: storeId,
        p_query: params.get("search"),
        p_limit: limit,
        p_offset: offset,
        p_status: status,
        p_category_id: categoryId && categoryId !== "all" ? categoryId : null,
      });
      if (error) throw new ApiError(error.message, 500);
      return NextResponse.json({ data: data ?? [] });
    }

    const limit = Math.min(100, Math.max(1, Number(params.get("limit")) || 20));
    let query = admin
      .from("products")
      .select(
        "id,store_id,created_at,name,description,price_retail,price_wholesale,min_wholesale,stock,active,image_url,category_id",
      )
      .eq("store_id", storeId);

    const createdAt = params.get("createdAt");
    const id = params.get("id");
    if (createdAt && id) {
      query = query.or(`created_at.lt.${createdAt},and(created_at.eq.${createdAt},id.lt.${id})`);
    }

    const { data, error } = await query
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(limit);
    if (error) throw new ApiError(error.message, 500);
    return NextResponse.json({ data: data ?? [] });
  } catch (error) {
    return respondWithError(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const admin = await authorizeAdmin(request);
    const body = (await request.json()) as { resource?: string; id?: string; status?: string; role?: string };

    if (body.resource === "orders") {
      const statuses = ["draft", "sent", "confirmed", "completed"];
      if (!body.id || !statuses.includes(body.status ?? "")) {
        throw new ApiError("El pedido o el estado seleccionado no es válido.", 400);
      }
      const { error } = await admin.from("orders").update({ status: body.status }).eq("id", body.id);
      if (error) throw new ApiError(error.message, 500);
      return NextResponse.json({ ok: true });
    }

    if (body.resource === "user-profile") {
      if (!body.id || !["admin", "store"].includes(body.role ?? "")) {
        throw new ApiError("El usuario o rol seleccionado no es válido.", 400);
      }
      const { error } = await admin
        .from("user_profiles")
        .upsert({ user_id: body.id, role: body.role }, { onConflict: "user_id" });
      if (error) throw new ApiError(error.message, 500);
      return NextResponse.json({ ok: true });
    }

    throw new ApiError("Recurso administrativo no válido.", 400);
  } catch (error) {
    return respondWithError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const admin = await authorizeAdmin(request);
    const params = new URL(request.url).searchParams;
    const resource = params.get("resource");
    const userId = params.get("id");
    if (resource !== "user-profile" || !userId) {
      throw new ApiError("Solicitud administrativa no válida.", 400);
    }
    const { error } = await admin.from("user_profiles").delete().eq("user_id", userId);
    if (error) throw new ApiError(error.message, 500);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return respondWithError(error);
  }
}
