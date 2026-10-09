"use client";

import { supabaseBrowser } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { logSessionEvent } from "@/lib/audit-client";
import { forgetStaffAccess } from "@/lib/session-resume";

export function LogoutButton() {
  const router = useRouter();

  async function logout() {
    const sb = supabaseBrowser();
    await logSessionEvent("auth.logout");
    await sb.auth.signOut();

    document.cookie = "app_session=; path=/; max-age=0";
    forgetStaffAccess();
    router.push("/login");
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
