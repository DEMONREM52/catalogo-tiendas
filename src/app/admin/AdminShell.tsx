"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import Swal from "sweetalert2";
import { supabaseBrowser } from "@/lib/supabase/client";

function Item({ href, label }: { href: string; label: string }) {
  const path = usePathname();
  const active = path === href;

  return (
    <Link
      href={href}
      className="block rounded-xl px-3 py-2 text-sm border border-white/10"
      style={{
        background: active ? "rgba(255,255,255,0.10)" : "transparent",
      }}
    >
      {label}
    </Link>
  );
}

export default function AdminShell({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const router = useRouter();

  useEffect(() => {
    (async () => {
      // ✅ supabaseBrowser ahora es FUNCIÓN
      const sb = supabaseBrowser();

      const { data } = await sb.auth.getUser();
      if (!data.user) {
        router.replace("/login");
        return;
      }

      // Validar rol admin
      const { data: prof, error } = await sb
        .from("user_profiles")
        .select("role")
        .eq("user_id", data.user.id)
        .maybeSingle();

      if (error || prof?.role !== "admin") {
        await Swal.fire({
          icon: "error",
          title: "Acceso denegado",
          text: "No tienes permisos de administrador.",
          background: "#0b0b0b",
          color: "#fff",
          confirmButtonColor: "#ef4444",
        });
        router.replace("/dashboard");
        return;
      }

      setReady(true);
    })();
  }, [router]);

  async function logout() {
    const sb = supabaseBrowser();
    await sb.auth.signOut();
    router.replace("/login");
  }

  if (!ready) {
    return (
      <main
        className="min-h-screen p-6"
        style={{ background: "#0b0b0b", color: "#fff" }}
      >
        <p>Cargando panel admin...</p>
      </main>
    );
  }

  return (
    <main
      className="min-h-screen"
      style={{ background: "#0b0b0b", color: "#fff" }}
    >
      <div className="mx-auto max-w-7xl p-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Panel Administrador</h1>
            <p className="text-sm opacity-80">
              Control total de tiendas, pedidos y catálogo.
            </p>
          </div>

          <button
            className="rounded-xl border border-white/10 px-4 py-2 text-sm"
            onClick={logout}
          >
            Cerrar sesión
          </button>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-[260px_1fr]">
          <aside className="rounded-2xl border border-white/10 p-4 space-y-2">
            <p className="text-xs opacity-60 mb-2">MENÚ</p>
            <Item href="/admin" label="🏠 Resumen" />
            <Item href="/admin/tiendas" label="🏪 Tiendas" />
            <Item href="/admin/pedidos" label="🧾 Pedidos" />
            <Item href="/admin/productos" label="📦 Productos" />
            <Item href="/admin/categorias" label="🗂️ Categorías" />
            <Item href="/admin/usuarios" label="👤 Usuarios / Roles" />
            <Item href="/admin/themes" label="🎨 Themes" />
          </aside>

          <section className="rounded-2xl border border-white/10 p-4">
            {children}
          </section>
        </div>
      </div>
    </main>
  );
}
