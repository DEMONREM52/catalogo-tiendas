"use client";

import { useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import Swal from "sweetalert2";

type Role = "admin" | "store";

function CardLink({
  title,
  desc,
  href,
  badge,
}: {
  title: string;
  desc: string;
  href: string;
  badge?: string;
}) {
  return (
    <a
      href={href}
      className="block rounded-2xl border border-white/10 bg-black/30 p-5 hover:bg-black/40 transition"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-lg font-semibold">{title}</p>
          <p className="mt-1 text-sm opacity-80">{desc}</p>
        </div>
        {badge ? (
          <span className="rounded-full border border-white/10 px-3 py-1 text-xs opacity-90">
            {badge}
          </span>
        ) : null}
      </div>
    </a>
  );
}

type StoreInfo = {
  id: string;
  name: string;
  slug: string;
  whatsapp: string;
  active: boolean;
  wholesale_key: string | null; // ✅ IMPORTANTE
};

export default function DashboardPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState<string>("");
  const [role, setRole] = useState<Role | null>(null);

  const [store, setStore] = useState<StoreInfo | null>(null);

  // ✅ Link Detal normal
  const storeCatalogDetal = useMemo(() => {
    if (!store) return "#";
    return `/${store.slug}/detal`;
  }, [store]);

  // ✅ Link Mayor con key
  const storeCatalogMayor = useMemo(() => {
    if (!store) return "#";
    if (!store.wholesale_key) return `/${store.slug}/mayor`;
    return `/${store.slug}/mayor?key=${encodeURIComponent(store.wholesale_key)}`;
  }, [store]);

  useEffect(() => {
    (async () => {
      setLoading(true);

      try {
        const sb = supabaseBrowser();

        // 0) Usuario
        const { data: userRes, error: userErr } = await sb.auth.getUser();
        if (userErr) throw userErr;

        if (!userRes.user) {
          router.replace("/login");
          return;
        }

        setEmail(userRes.user.email ?? "");

        // 1) Rol
        const { data: prof, error: profErr } = await sb
          .from("user_profiles")
          .select("role")
          .eq("user_id", userRes.user.id)
          .maybeSingle();

        if (profErr || !prof?.role) {
          await Swal.fire({
            icon: "error",
            title: "Perfil no configurado",
            text: "No se encontró tu rol. Contacta al administrador.",
            background: "#0b0b0b",
            color: "#fff",
            confirmButtonColor: "#ef4444",
          });
          setLoading(false);
          return;
        }

        const userRole = prof.role as Role;
        setRole(userRole);

        // 2) Si es tienda → datos de la tienda (✅ con wholesale_key)
        if (userRole === "store") {
          const { data: storeData, error: stErr } = await sb
            .from("stores")
            .select("id,name,slug,whatsapp,active,wholesale_key")
            .eq("owner_id", userRes.user.id)
            .maybeSingle();

          if (stErr) throw stErr;
          if (storeData) setStore(storeData as StoreInfo);
        }
      } catch (e: any) {
        await Swal.fire({
          icon: "error",
          title: "Error cargando dashboard",
          text: e?.message ?? "Error",
          background: "#0b0b0b",
          color: "#fff",
          confirmButtonColor: "#ef4444",
        });
      } finally {
        setLoading(false);
      }
    })();
  }, [router]);

  async function logout() {
    const sb = supabaseBrowser();
    await sb.auth.signOut();
    document.cookie = "app_session=; path=/; max-age=0";
    router.replace("/login");
  }

  // ✅ Botón para abrir catálogo mayor con validación
  async function openMayorCatalog() {
    if (!store) return;

    if (!store.wholesale_key) {
      await Swal.fire({
        icon: "info",
        title: "Falta Mayoristas key",
        text: "Esta tienda no tiene la clave mayorista configurada. Pídele al administrador que la ponga.",
        background: "#0b0b0b",
        color: "#fff",
      });
      return;
    }

    window.open(storeCatalogMayor, "_blank");
  }

  if (loading) {
    return (
      <main
        className="min-h-screen p-6"
        style={{ background: "#0b0b0b", color: "#fff" }}
      >
        <div className="mx-auto max-w-6xl">
          <p>Cargando dashboard...</p>
        </div>
      </main>
    );
  }

  return (
    <main
      className="min-h-screen p-6"
      style={{ background: "#0b0b0b", color: "#fff" }}
    >
      <div className="mx-auto max-w-6xl space-y-6">
        {/* Header */}
        <div className="rounded-2xl border border-white/10 bg-black/30 p-6">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div>
              <h1 className="text-2xl font-bold">Dashboard</h1>
              <p className="mt-2 text-sm opacity-80">
                Sesión iniciada como <b>{email}</b>
              </p>

              <div className="mt-3 inline-flex items-center gap-2 rounded-xl border border-white/10 px-3 py-1 text-xs opacity-90">
                <span className="opacity-70">Rol:</span>
                <b>{role === "admin" ? "Administrador" : "Tienda"}</b>
              </div>

              {role === "store" && store ? (
                <p className="mt-3 text-sm opacity-80">
                  Tienda: <b>{store.name}</b>{" "}
                  <span className="opacity-60">({store.slug})</span>{" "}
                  {!store.active ? (
                    <span className="ml-2 rounded-full border border-yellow-500/30 bg-yellow-500/10 px-2 py-0.5 text-xs text-yellow-200">
                      Desactivada
                    </span>
                  ) : null}
                </p>
              ) : null}
            </div>

            <div className="flex flex-wrap gap-2">
              {role === "admin" ? (
                <a
                  href="/admin"
                  className="rounded-xl px-4 py-2 font-semibold"
                  style={{ background: "#fff", color: "#0b0b0b" }}
                >
                  Ir al Panel Administrador →
                </a>
              ) : null}

              {role === "store" && store ? (
                <>
                  <a
                    href={storeCatalogDetal}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-xl border border-white/10 px-4 py-2"
                  >
                    Ver catálogo Detal
                  </a>

                  {/* ✅ Mayor: botón con key */}
                  <button
                    onClick={openMayorCatalog}
                    className="rounded-xl border border-white/10 px-4 py-2"
                  >
                    Ver catálogo Mayor
                  </button>
                </>
              ) : null}

              <button
                className="rounded-xl border border-white/10 px-4 py-2"
                onClick={logout}
              >
                Cerrar sesión
              </button>
            </div>
          </div>
        </div>

        {/* Contenido según rol */}
        {role === "admin" ? (
          <div className="rounded-2xl border border-white/10 bg-black/30 p-6">
            <h2 className="text-xl font-semibold">Acceso de administrador</h2>
            <p className="mt-2 text-sm opacity-80">
              Puedes gestionar tiendas, pedidos, productos, categorías y usuarios.
            </p>

            <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
              <CardLink
                title="🏪 Administrar tiendas"
                desc="Crear, editar, activar/inactivar, cambiar owner, ver catálogos."
                href="/admin/tiendas"
              />
              <CardLink
                title="🧾 Administrar pedidos"
                desc="Ver todos los pedidos, estados, copiar link, abrir comprobante."
                href="/admin/pedidos"
              />
              <CardLink
                title="📦 Administrar productos"
                desc="Buscar por tienda, filtrar por categoría, editar y eliminar."
                href="/admin/productos"
              />
              <CardLink
                title="👤 Usuarios y roles"
                desc="Asignar roles y controlar accesos."
                href="/admin/usuarios"
              />
            </div>
          </div>
        ) : (
          <div className="rounded-2xl border border-white/10 bg-black/30 p-6">
            <h2 className="text-xl font-semibold">Panel de tu tienda</h2>
            <p className="mt-2 text-sm opacity-80">
              Administra tu catálogo, tu perfil y revisa pedidos. Todo desde aquí.
            </p>

            {!store ? (
              <div className="mt-4 rounded-2xl border border-white/10 p-4">
                <p className="font-semibold">⚠️ No encontramos tu tienda</p>
                <p className="mt-1 text-sm opacity-80">
                  Aún no tienes una tienda asociada a este usuario.
                </p>
              </div>
            ) : (
              <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                <CardLink
                  title="🏪 Mi tienda"
                  desc="Nombre, logo, banner, WhatsApp, tema y configuración."
                  href="/dashboard/store"
                  badge="Perfil"
                />
                <CardLink
                  title="📦 Productos"
                  desc="Crear, editar, imagen, precios detal/mayor, activar/inactivar."
                  href="/dashboard/products"
                  badge="Catálogo"
                />
                <CardLink
                  title="🗂️ Categorías"
                  desc="Crea categorías con imagen y organiza tus productos."
                  href="/dashboard/categories"
                  badge="Orden"
                />
                <CardLink
                  title="🧾 Pedidos"
                  desc="Ver pedidos de clientes, confirmar y completar estados."
                  href="/dashboard/pedidos"
                  badge="Ventas"
                />
              </div>
            )}
          </div>
        )}

        <p className="text-xs opacity-60">
          Consejo: mantén tu catálogo actualizado (imágenes y categorías) para vender más.
        </p>
      </div>
    </main>
  );
}
