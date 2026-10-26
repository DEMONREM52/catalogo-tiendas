"use client";

import { signOutEverywhere } from "@/lib/supabase/offline-session";
import { useRouter } from "next/navigation";
import { logSessionEvent } from "@/lib/audit-client";
import { forgetStaffAccess } from "@/lib/session-resume";
import { logoutRedirect } from "@/lib/store-space";
import { cacheClear } from "@/lib/offline/cache";

export function LogoutButton() {
  const router = useRouter();

  async function logout() {
    await logSessionEvent("auth.logout");
    // También sin conexión (Supabase no borra la sesión si no logra avisarle al servidor).
    await signOutEverywhere();

    document.cookie = "app_session=; path=/; max-age=0";
    forgetStaffAccess();
    await cacheClear();
    const to = logoutRedirect();
    if (to.startsWith("http")) window.location.replace(to);
    else router.push(to);
  }

  return (
    <button
      className="rounded-xl border border-white/10 px-4 py-2"
      onClick={logout}
    >
      Cerrar sesión
    </button>
  );
}
