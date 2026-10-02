import { supabaseBrowser } from "@/lib/supabase/client";

export type StoreMemberRole = "store_admin" | "seller" | "accounting" | "viewer";

export type DashboardStore = {
  id: string;
  slug: string;
  name: string;
  whatsapp: string;
  active: boolean;
  active_until: string | null;
  catalog_retail: boolean;
  catalog_wholesale: boolean;
  wholesale_key: string | null;
  owner_id: string;
  theme: string | null;
  logo_url: string | null;
  banner_url: string | null;
};

export type StoreMembership = {
  store_id: string;
  role: StoreMemberRole;
  permissions?: string[] | null;
  active?: boolean;
  username?: string | null;
};

export async function getDashboardStore() {
  const sb = supabaseBrowser();

  const { data: userData, error: userErr } = await sb.auth.getUser();
  if (userErr) throw userErr;
  if (!userData?.user) throw new Error("No hay sesión activa.");

  const userId = userData.user.id;

  const { data: profile, error: profileErr } = await sb
    .from("user_profiles")
    .select("role")
    .eq("user_id", userId)
    .maybeSingle();

  if (profileErr) throw profileErr;

  const profileRole = profile?.role as string | null;

  const storeColumns =
    "id,slug,name,whatsapp,active,active_until,catalog_retail,catalog_wholesale,wholesale_key,owner_id,theme,logo_url,banner_url";
  const { data: ownerStore, error: ownerErr } = await sb
    .from("stores")
    .select(storeColumns)
    .eq("owner_id", userId)
    .maybeSingle();

  if (ownerErr) throw ownerErr;
  if (ownerStore) {
    return {
      store: ownerStore as DashboardStore,
      profileRole: profileRole || "store",
      membership: null,
      isOwner: true,
    };
  }

  const { data: memberData, error: memberErr } = await sb
    .from("store_users")
    .select("store_id,role,permissions,active,username")
    .eq("user_id", userId)
    .eq("active", true)
    .limit(1);

  if (memberErr) throw memberErr;
  const membership = (memberData?.[0] as StoreMembership | undefined) ?? null;
  if (membership) {
    const { data: memberStore, error: storeErr } = await sb
      .from("stores")
      .select(storeColumns)
      .eq("id", membership.store_id)
      .maybeSingle();
    if (storeErr) throw storeErr;
    if (memberStore) {
      return {
        store: memberStore as DashboardStore,
        profileRole: profileRole || "store",
        membership,
        isOwner: false,
      };
    }
  }

  const { data: legacyMemberships, error: legacyError } = await sb
    .from("store_members")
    .select("store_id,role,permissions")
    .eq("user_id", userId)
    .limit(1);

  if (legacyError) {
    const missingLegacyTable =
      legacyError.code === "PGRST205" || legacyError.code === "42P01";
    if (!missingLegacyTable) throw legacyError;
  } else if (legacyMemberships?.[0]) {
    const legacyMembership = {
      ...(legacyMemberships[0] as StoreMembership),
      active: true,
    };
    const { data: legacyStore, error: legacyStoreError } = await sb
      .from("stores")
      .select(storeColumns)
      .eq("id", legacyMembership.store_id)
      .maybeSingle();
    if (legacyStoreError) throw legacyStoreError;
    if (legacyStore) {
      return {
        store: legacyStore as DashboardStore,
        profileRole: profileRole || "store",
        membership: legacyMembership,
        isOwner: false,
      };
    }
  }

  return {
    store: null,
    profileRole,
    membership: null,
    isOwner: false,
  };
}

export function hasStorePermission(
  access: { isOwner: boolean; membership: StoreMembership | null },
  permission: string,
) {
  return (
    access.isOwner ||
    access.membership?.role === "store_admin" ||
    Boolean(access.membership?.permissions?.includes(permission))
  );
}
