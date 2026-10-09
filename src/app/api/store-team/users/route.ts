import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  isValidStoreUsername,
  normalizeStoreUsername,
  STORE_MENU_PERMISSIONS,
  storeStaffAuthEmail,
} from "@/lib/store-user-auth";

class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

type StoreAccess = {
  id: string;
  slug: string;
  owner_id: string;
};

type ManagerAccess = {
  store: StoreAccess;
  isOwner: boolean;
  isAdmin: boolean;
  role: string | null;
  permissions: string[];
  /** Punto del administrador de punto: solo gestiona usuarios de su punto. */
  pointId: string | null;
};

function getAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new ApiError(
      "Falta SUPABASE_SERVICE_ROLE_KEY en el servidor. Configura la llave service_role en las variables de entorno del hosting y reinicia o redespliega la aplicación; no uses NEXT_PUBLIC_ ni la compartas.",
      500,
    );
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });
}

async function authorizeRequest(request: Request) {
  const accessToken = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!accessToken) throw new ApiError("Inicia sesión para continuar.", 401);
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  if (!supabaseUrl || !anonKey) throw new ApiError("Falta configurar Supabase en el servidor.", 500);
  const authClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false },
  });
  const { data, error } = await authClient.auth.getUser(accessToken);

  if (error || !data.user) throw new ApiError("La sesión no es válida. Inicia sesión de nuevo.", 401);
  return { admin: getAdminClient(), userId: data.user.id };
}

async function requireStoreManager(
  admin: SupabaseClient,
  userId: string,
  storeId: string,
): Promise<ManagerAccess> {
  const { data: store, error: storeError } = await admin
    .from("stores")
    .select("id,slug,owner_id")
    .eq("id", storeId)
    .maybeSingle();
  if (storeError) throw new ApiError(storeError.message, 500);
  if (!store) throw new ApiError("No se encontró la tienda.", 404);

  const { data: profile, error: profileError } = await admin
    .from("user_profiles")
    .select("role")
    .eq("user_id", userId)
    .maybeSingle();
  if (profileError) throw new ApiError(profileError.message, 500);

  if (profile?.role === "admin") {
    return {
      store: store as StoreAccess,
      isOwner: false,
      isAdmin: true,
      role: "store_admin",
      permissions: [...STORE_MENU_PERMISSIONS],
      pointId: null,
    };
  }

  if (store.owner_id === userId) {
    return { store: store as StoreAccess, isOwner: true, isAdmin: false, role: "store_admin", permissions: [...STORE_MENU_PERMISSIONS], pointId: null };
  }

  const { data: membership, error: membershipError } = await admin
    .from("store_users")
    .select("role,active,permissions,point_id")
    .eq("store_id", storeId)
    .eq("user_id", userId)
    .maybeSingle();
  if (membershipError) throw new ApiError(membershipError.message, 500);
  if (
    !membership?.active ||
    (membership.role !== "store_admin" && !membership.permissions?.includes("users"))
  ) {
    throw new ApiError("Solo el administrador de esta tienda puede gestionar sus usuarios.", 403);
  }

  return {
    store: store as StoreAccess,
    isOwner: false,
    isAdmin: false,
    role: membership.role,
    permissions: membership.permissions ?? [],
    pointId: membership.role === "store_admin" ? null : (membership.point_id as string | null) ?? null,
  };
}

/** Un administrador de punto solo crea y edita usuarios de su propio punto. */
function assertPointScope(manager: ManagerAccess, targetPointId: string | null | undefined) {
  if (!manager.pointId) return;
  if (targetPointId !== manager.pointId) {
    throw new ApiError("Solo puedes gestionar usuarios de tu propio punto.", 403);
  }
}

async function resolvePointIds(admin: SupabaseClient, storeId: string, value: unknown) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new ApiError("Los puntos adicionales no son válidos.", 400);
  const ids = [...new Set(value.map(String).filter(Boolean))];
  if (!ids.length) return [];
  const { data, error } = await admin.from("erp_warehouses").select("id").eq("store_id", storeId).in("id", ids);
  if (error) throw new ApiError(error.message, 500);
  if ((data ?? []).length !== ids.length) throw new ApiError("Alguno de los puntos adicionales no pertenece a esta tienda.", 400);
  return ids;
}

function assertCanGrantPermissions(manager: ManagerAccess, permissions: string[]) {
  if (manager.isOwner || manager.role === "store_admin") return;
  if (permissions.some((permission) => !manager.permissions.includes(permission))) {
    throw new ApiError("No puedes asignar permisos que tú no tienes en esta tienda.", 403);
  }
}

function respondWithError(error: unknown) {
  const status = error instanceof ApiError ? error.status : 500;
  const message = error instanceof Error ? error.message : "Error inesperado.";
  if (status >= 500) console.error("Error en la gestión de usuarios de tienda:", message);
  return NextResponse.json({ ok: false, error: message }, { status });
}

function normalizePermissions(value: unknown) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter(
    (permission): permission is string =>
      typeof permission === "string" &&
      STORE_MENU_PERMISSIONS.includes(permission as (typeof STORE_MENU_PERMISSIONS)[number]),
  ))];
}

async function resolvePointId(admin: SupabaseClient, storeId: string, value: unknown) {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  const id = String(value);
  const { data, error } = await admin.from("erp_warehouses").select("id").eq("id", id).eq("store_id", storeId).maybeSingle();
  if (error) throw new ApiError(error.message, 500);
  if (!data) throw new ApiError("El punto seleccionado no pertenece a esta tienda.", 400);
  return id;
}

export async function GET(request: Request) {
  try {
    const { admin, userId } = await authorizeRequest(request);
    const storeId = new URL(request.url).searchParams.get("store_id");
    if (!storeId) throw new ApiError("Falta el identificador de la tienda.", 400);
    const manager = await requireStoreManager(admin, userId, storeId);

    let query = admin
      .from("store_users")
      .select("*")
      .eq("store_id", storeId)
      .order("created_at", { ascending: false });
    if (manager.pointId) query = query.eq("point_id", manager.pointId);
    const { data, error } = await query;
    if (error) throw new ApiError(error.message, 500);

    const users = (data ?? []).map((member) => ({
      ...member,
      permissions: Array.isArray(member.permissions) ? member.permissions : [],
    }));
    return NextResponse.json({ ok: true, users });
  } catch (error) {
    return respondWithError(error);
  }
}

export async function POST(request: Request) {
  try {
    const { admin, userId } = await authorizeRequest(request);
    const body = await request.json();
    const storeId = String(body.store_id ?? "");
    const username = normalizeStoreUsername(String(body.username ?? ""));
    const password = String(body.password ?? "");
    const displayName = String(body.display_name ?? "").trim();
    const requestedRole = String(body.role ?? "seller");
    const requestedPermissions = normalizePermissions(body.permissions);

    if (!storeId) throw new ApiError("Falta seleccionar la tienda.", 400);
    if (!isValidStoreUsername(username)) {
      throw new ApiError("El usuario debe tener de 3 a 32 caracteres: letras, números, punto, guion o guion bajo.", 400);
    }
    if (password.length < 8) {
      throw new ApiError("La contraseña debe tener al menos 8 caracteres.", 400);
    }
    if (displayName.length > 100) throw new ApiError("El nombre visible no puede superar 100 caracteres.", 400);
    const allowedRoles = ["store_admin", "seller", "accounting", "viewer"] as const;
    if (!allowedRoles.includes(requestedRole as (typeof allowedRoles)[number])) {
      throw new ApiError("El rol seleccionado no es válido.", 400);
    }

    const manager = await requireStoreManager(admin, userId, storeId);
    const permissions =
      requestedRole === "store_admin" ? [...STORE_MENU_PERMISSIONS] : requestedPermissions;
    assertCanGrantPermissions(manager, permissions);
    if (requestedRole === "store_admin" && !manager.isOwner && !manager.isAdmin) {
      throw new ApiError("Solo el dueño o administrador global puede crear otro administrador de tienda.", 403);
    }
    const pointId = manager.pointId ?? (await resolvePointId(admin, storeId, body.point_id));
    assertPointScope(manager, pointId);
    const store = manager.store;
    const { data: duplicate, error: duplicateError } = await admin
      .from("store_users")
      .select("user_id")
      .eq("store_id", storeId)
      .eq("username", username)
      .maybeSingle();
    if (duplicateError) throw new ApiError(duplicateError.message, 500);
    if (duplicate) throw new ApiError("Ese usuario interno ya existe en esta tienda.", 409);

    const email = storeStaffAuthEmail(storeId, username);
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        internal_username: username,
        internal_store_id: storeId,
        display_name: displayName || username,
      },
    });
    if (createError || !created.user) {
      throw new ApiError(createError?.message ?? "No se pudo crear el acceso.", 400);
    }

    const userIdCreated = created.user.id;
    const { error: membershipError } = await admin.from("store_users").insert({
      store_id: storeId,
      user_id: userIdCreated,
      username,
      display_name: displayName || username,
      role: requestedRole,
      permissions,
      active: true,
      ...(pointId ? { point_id: pointId } : {}),
    });

    if (membershipError) {
      await admin.auth.admin.deleteUser(userIdCreated);
      throw new ApiError(membershipError.message, 500);
    }

    const { error: profileError } = await admin
      .from("user_profiles")
      .upsert({ user_id: userIdCreated, role: "store" }, { onConflict: "user_id" });
    if (profileError) {
      await admin.from("store_users").delete().eq("store_id", storeId).eq("user_id", userIdCreated);
      await admin.auth.admin.deleteUser(userIdCreated);
      throw new ApiError(profileError.message, 500);
    }

    const loginUrl = new URL(`/acceso/${encodeURIComponent(store.slug)}`, request.url);
    loginUrl.searchParams.set("sid", storeId);
    loginUrl.searchParams.set("usuario", username);

    return NextResponse.json({
      ok: true,
      user: {
        store_id: storeId,
        user_id: userIdCreated,
        username,
        display_name: displayName || username,
        role: requestedRole,
        permissions,
        active: true,
        point_id: pointId ?? null,
        created_at: created.user.created_at,
      },
      login_url: loginUrl.toString(),
    });
  } catch (error) {
    return respondWithError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const { admin, userId } = await authorizeRequest(request);
    const body = await request.json();
    const storeId = String(body.store_id ?? "");
    const targetUserId = String(body.user_id ?? "");
    if (!storeId || !targetUserId) throw new ApiError("Faltan datos del usuario.", 400);
    const manager = await requireStoreManager(admin, userId, storeId);
    if (targetUserId === userId) throw new ApiError("No puedes eliminar tu propio usuario.", 400);
    if (manager.store.owner_id === targetUserId) throw new ApiError("No se puede eliminar al dueño de la tienda.", 400);

    const { data: target, error: targetError } = await admin
      .from("store_users")
      .select("user_id,role,username,point_id")
      .eq("store_id", storeId)
      .eq("user_id", targetUserId)
      .maybeSingle();
    if (targetError) throw new ApiError(targetError.message, 500);
    if (!target) throw new ApiError("El usuario no pertenece a esta tienda.", 404);
    assertPointScope(manager, target.point_id as string | null);
    if (target.role === "store_admin" && !manager.isOwner && !manager.isAdmin) {
      throw new ApiError("Solo el dueño puede eliminar a otro administrador.", 403);
    }

    const { error: deleteError } = await admin.from("store_users").delete().eq("store_id", storeId).eq("user_id", targetUserId);
    if (deleteError) throw new ApiError(deleteError.message, 500);

    // Si no pertenece a otra tienda ni es dueño de una, se borra también su acceso.
    const [{ count: otherMemberships }, { count: ownedStores }, { data: profile }] = await Promise.all([
      admin.from("store_users").select("user_id", { count: "exact", head: true }).eq("user_id", targetUserId),
      admin.from("stores").select("id", { count: "exact", head: true }).eq("owner_id", targetUserId),
      admin.from("user_profiles").select("role").eq("user_id", targetUserId).maybeSingle(),
    ]);
    let warning: string | null = null;
    if (!otherMemberships && !ownedStores && profile?.role !== "admin") {
      const { error: authError } = await admin.auth.admin.deleteUser(targetUserId);
      if (authError) {
        // Si la base conserva referencias, se bloquea el acceso para siempre en lugar de borrarlo.
        await admin.auth.admin.updateUserById(targetUserId, { ban_duration: "876000h" });
        warning = "El acceso se quitó y el usuario quedó bloqueado de forma permanente (se conserva por el historial).";
      } else {
        await admin.from("user_profiles").delete().eq("user_id", targetUserId);
      }
    }
    return NextResponse.json({ ok: true, warning });
  } catch (error) {
    return respondWithError(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const { admin, userId } = await authorizeRequest(request);
    const body = await request.json();
    const storeId = String(body.store_id ?? "");
    const targetUserId = String(body.user_id ?? "");
    if (!storeId || !targetUserId) throw new ApiError("Faltan datos del usuario.", 400);
    const manager = await requireStoreManager(admin, userId, storeId);
    const store = manager.store;
    if (targetUserId === userId) throw new ApiError("No puedes cambiar tus propios permisos desde esta pantalla.", 400);

    const { data: target, error: targetError } = await admin
      .from("store_users")
      .select("user_id,role,point_id")
      .eq("store_id", storeId)
      .eq("user_id", targetUserId)
      .maybeSingle();
    if (targetError) throw new ApiError(targetError.message, 500);
    if (!target) throw new ApiError("El usuario no pertenece a esta tienda.", 404);
    assertPointScope(manager, target.point_id as string | null);
    if (target.role === "store_admin" && store.owner_id !== userId && !manager.isAdmin) {
      throw new ApiError("Solo el dueño puede administrar el acceso de otro administrador.", 403);
    }

    const patch: { point_id?: string | null; point_ids?: string[]; permissions?: string[]; active?: boolean; role?: "store_admin" | "seller" | "accounting" | "viewer" } = {};
    if (body.permissions !== undefined) {
      patch.permissions = normalizePermissions(body.permissions);
      assertCanGrantPermissions(manager, patch.permissions);
    }
    if (typeof body.active === "boolean") patch.active = body.active;
    const pointPatch = await resolvePointId(admin, storeId, body.point_id);
    if (pointPatch !== undefined) {
      assertPointScope(manager, pointPatch);
      patch.point_id = pointPatch;
    }
    const extraPoints = await resolvePointIds(admin, storeId, body.point_ids);
    if (extraPoints !== undefined) {
      if (manager.pointId) throw new ApiError("Solo la tienda madre define los puntos adicionales de un usuario.", 403);
      const home = pointPatch !== undefined ? pointPatch : (target.point_id as string | null);
      patch.point_ids = home ? extraPoints.filter((id) => id !== home) : [];
    }
    if (body.role !== undefined) {
      const allowedRoles = ["store_admin", "seller", "accounting", "viewer"] as const;
      if (!allowedRoles.includes(body.role)) throw new ApiError("El rol seleccionado no es válido.", 400);
      if (!manager.isOwner && !manager.isAdmin && manager.role !== "store_admin") {
        throw new ApiError("Solo el dueño o administrador de tienda puede cambiar roles.", 403);
      }
      if (body.role === "store_admin" && !manager.isOwner && !manager.isAdmin) {
        throw new ApiError("Solo el dueño o administrador global puede asignar otro administrador de tienda.", 403);
      }
      patch.role = body.role;
    }
    const newPassword = body.new_password === undefined ? null : String(body.new_password);
    if (newPassword !== null && newPassword.length < 8) {
      throw new ApiError("La nueva contraseña debe tener al menos 8 caracteres.", 400);
    }
    if (Object.keys(patch).length === 0 && newPassword === null) {
      throw new ApiError("No hay cambios para guardar.", 400);
    }

    if (newPassword !== null) {
      const { error: passwordError } = await admin.auth.admin.updateUserById(targetUserId, {
        password: newPassword,
      });
      if (passwordError) throw new ApiError(passwordError.message, 400);
    }

    let user = null;
    if (Object.keys(patch).length > 0) {
      const { data, error } = await admin
        .from("store_users")
        .update(patch)
        .eq("store_id", storeId)
        .eq("user_id", targetUserId)
        .select("*")
        .single();
      if (error) throw new ApiError(error.message, 500);
      user = data;
    }

    return NextResponse.json({
      ok: true,
      user: user
        ? { ...user, permissions: Array.isArray(user.permissions) ? user.permissions : [] }
        : null,
    });
  } catch (error) {
    return respondWithError(error);
  }
}
