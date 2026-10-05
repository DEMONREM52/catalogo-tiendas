"use client";

import { IconBtn } from "@/app/dashboard/IconBtn";
import { WithDv, docWithDv } from "@/app/dashboard/nit";
import { useEffect, useMemo, useState } from "react";
import Swal from "sweetalert2";
import { supabaseBrowser } from "@/lib/supabase/client";
import { getDashboardStore, type DashboardStore } from "@/lib/store-utils";
import { getStoreDataSchemaErrorMessage } from "@/lib/store-schema-errors";

type Client = {
  id: string;
  store_id: string;
  name: string;
  document_number: string | null;
  email: string | null;
  mobile: string | null;
  address: string | null;
  city: string | null;
  department: string | null;
  price_list: number;
  created_at: string;
};

type ClientForm = {
  id?: string;
  name: string;
  document_number: string;
  email: string;
  mobile: string;
  address: string;
  city: string;
  department: string;
  price_list: number;
};

function inputProps() {
  return {
    className: "w-full rounded-2xl border px-4 py-3 text-sm outline-none",
    style: {
      borderColor: "var(--t-card-border)",
      background: "color-mix(in oklab, var(--t-card-bg) 92%, transparent)",
      color: "var(--t-text)",
    } as React.CSSProperties,
  };
}

function cardProps() {
  return {
    className: "rounded-[28px] border p-6",
    style: {
      borderColor: "var(--t-card-border)",
      background: "var(--t-card-bg)",
      color: "var(--t-text)",
    } as React.CSSProperties,
  };
}

export default function ClientesPage() {
  const [store, setStore] = useState<DashboardStore | null>(null);
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [q, setQ] = useState("");
  const [form, setForm] = useState<ClientForm>({
    name: "",
    document_number: "",
    email: "",
    mobile: "",
    address: "",
    city: "",
    department: "",
    price_list: 3,
  });
  const [editing, setEditing] = useState(false);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return clients;
    const digits = term.replace(/\D/g, "");
    return clients.filter((client) => {
      if (
        digits.length > 0 &&
        ((client.document_number ?? "").replace(/\D/g, "").includes(digits) ||
          (client.mobile ?? "").replace(/\D/g, "").includes(digits))
      )
        return true;
      return [
        client.name,
        client.email ?? "",
        client.mobile ?? "",
        client.document_number ?? "",
        client.city ?? "",
        client.department ?? "",
      ]
        .join(" ")
        .toLowerCase()
        .includes(term);
    });
  }, [clients, q]);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    try {
      const access = await getDashboardStore();
      if (!access.store) {
        throw new Error("No tienes acceso a ninguna tienda.");
      }

      setStore(access.store);
      const sb = supabaseBrowser();

      const { data, error } = await sb
        .from("billing_customers")
        .select(
          "id,store_id,name,document_number,email,mobile,address,city,department,price_list,created_at",
        )
        .eq("store_id", access.store.id)
        .order("created_at", { ascending: false });

      if (error) throw error;
      setClients((data as Client[]) ?? []);
    } catch (err: unknown) {
      await Swal.fire({
        icon: "error",
        title: "No se pudieron cargar los clientes",
        text: getStoreDataSchemaErrorMessage(err),
        background: "#0b0b0b",
        color: "#fff",
        confirmButtonColor: "#ef4444",
      });
    } finally {
      setLoading(false);
    }
  }

  function resetForm() {
    setForm({
      name: "",
      document_number: "",
      email: "",
      mobile: "",
      address: "",
      city: "",
      department: "",
      price_list: 3,
    });
    setEditing(false);
  }

  async function saveClient() {
    if (!store) return;
    if (!form.name.trim()) {
      await Swal.fire({
        icon: "warning",
        title: "Nombre requerido",
        text: "Escribe el nombre del cliente.",
        background: "#0b0b0b",
        color: "#fff",
        confirmButtonColor: "#f59e0b",
      });
      return;
    }

    setSaving(true);

    try {
      const payload = {
        store_id: store.id,
        name: form.name.trim(),
        document_number: form.document_number?.trim() || null,
        email: form.email?.trim() || null,
        mobile: form.mobile?.trim() || null,
        address: form.address?.trim() || null,
        city: form.city?.trim() || null,
        department: form.department?.trim() || null,
        price_list: form.price_list,
      };

      const sb = supabaseBrowser();
      let result: Client;

      if (editing && form.id) {
        const { data, error } = await sb
          .from("billing_customers")
          .update(payload)
          .eq("id", form.id)
          .select(
            "id,store_id,name,document_number,email,mobile,address,city,department,price_list,created_at",
          )
          .single();

        if (error) throw error;
        result = data as Client;
        setClients((prev) =>
          prev.map((item) => (item.id === result.id ? result : item)),
        );
      } else {
        const { data, error } = await sb
          .from("billing_customers")
          .insert(payload)
          .select(
            "id,store_id,name,document_number,email,mobile,address,city,department,price_list,created_at",
          )
          .single();

        if (error) throw error;
        result = data as Client;
        setClients((prev) => [result, ...prev]);
      }

      await Swal.fire({
        icon: "success",
        title: editing ? "Tercero modificado" : "Tercero guardado",
        timer: 1000,
        showConfirmButton: false,
        background: "#0b0b0b",
        color: "#fff",
      });

      resetForm();
    } catch (err: unknown) {
      await Swal.fire({
        icon: "error",
        title: "No se pudo guardar",
        text: getStoreDataSchemaErrorMessage(err),
        background: "#0b0b0b",
        color: "#fff",
        confirmButtonColor: "#ef4444",
      });
    } finally {
      setSaving(false);
    }
  }

  function editClient(client: Client) {
    setForm({
      id: client.id,
      name: client.name,
      document_number: client.document_number ?? "",
      email: client.email ?? "",
      mobile: client.mobile ?? "",
      address: client.address ?? "",
      city: client.city ?? "",
      department: client.department ?? "",
      price_list: client.price_list ?? 3,
    });
    setEditing(true);
  }

  async function deleteClient(client: Client) {
    const res = await Swal.fire({
      icon: "warning",
      title: "Eliminar cliente",
      text: `Se eliminará ${client.name}. Esta acción no se puede deshacer.`,
      showCancelButton: true,
      confirmButtonText: "Eliminar",
      cancelButtonText: "Cancelar",
      background: "#0b0b0b",
      color: "#fff",
      confirmButtonColor: "#ef4444",
    });

    if (!res.isConfirmed) return;

    try {
      const sb = supabaseBrowser();
      const { error } = await sb.from("billing_customers").delete().eq("id", client.id);
      if (error) throw error;
      setClients((prev) => prev.filter((item) => item.id !== client.id));

      await Swal.fire({
        icon: "success",
        title: "Cliente eliminado",
        timer: 900,
        showConfirmButton: false,
        background: "#0b0b0b",
        color: "#fff",
      });
    } catch (err: unknown) {
      await Swal.fire({
        icon: "error",
        title: "No se pudo eliminar",
        text: String((err as Error)?.message ?? err),
        background: "#0b0b0b",
        color: "#fff",
        confirmButtonColor: "#ef4444",
      });
    }
  }

  const title = store ? `Clientes de ${store.name}` : "Clientes";

  return (
    <main className="space-y-6">
      <div {...cardProps()}>
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="text-2xl font-semibold">👥 Clientes</h1>
            <p className="mt-2 text-sm" style={{ color: "var(--t-muted)" }}>
              Guarda los datos fiscales y de contacto de tus clientes para
              facturar y vender a crédito.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              className="rounded-2xl border px-4 py-2 text-sm font-semibold"
              style={{
                borderColor: "var(--t-card-border)",
                background:
                  "color-mix(in oklab, var(--t-card-bg) 90%, transparent)",
                color: "var(--t-text)",
              }}
              onClick={resetForm}
              disabled={saving}
            >
              Nuevo cliente
            </button>
          </div>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[360px_1fr]">
        <div {...cardProps()}>
          <h2 className="text-lg font-semibold">
            {editing ? "✏️ Modificar tercero" : "Agregar tercero"}
          </h2>

          <div className="mt-4 space-y-3">
            <div>
              <label className="text-sm font-semibold">Nombre</label>
              <input
                {...inputProps()}
                value={form.name}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, name: e.target.value }))
                }
                placeholder="Nombre o empresa"
              />
            </div>

            <div>
              <label className="text-sm font-semibold">Documento</label>
              <WithDv value={form.document_number}>
                <input
                  {...inputProps()}
                  value={form.document_number}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, document_number: e.target.value }))
                  }
                  placeholder="NIT o cédula"
                />
              </WithDv>
            </div>

            <div>
              <label className="text-sm font-semibold">Email</label>
              <input
                {...inputProps()}
                type="email"
                value={form.email}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, email: e.target.value }))
                }
                placeholder="correo@cliente.com"
              />
            </div>

            <div>
              <label className="text-sm font-semibold">WhatsApp / Móvil</label>
              <input
                {...inputProps()}
                value={form.mobile}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, mobile: e.target.value }))
                }
                placeholder="57XXXXXXXXX"
              />
            </div>
 
            <div>
              <label className="text-sm font-semibold">Lista de precio</label>
              <select
                {...inputProps()}
                value={form.price_list}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, price_list: Number(e.target.value) }))
                }
              >
                {[1, 2, 3, 4, 5].map((value) => (
                  <option key={value} value={value}>
                    Precio {value}
                  </option>
                ))}
              </select>
            </div>
 
            <div>
              <label className="text-sm font-semibold">Dirección</label>
              <input
                {...inputProps()}
                value={form.address}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, address: e.target.value }))
                }
                placeholder="Barrio, calle, número"
              />
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <label className="text-sm font-semibold">Ciudad</label>
                <input
                  {...inputProps()}
                  value={form.city}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, city: e.target.value }))
                  }
                  placeholder="Ciudad"
                />
              </div>
              <div>
                <label className="text-sm font-semibold">Departamento</label>
                <input
                  {...inputProps()}
                  value={form.department}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, department: e.target.value }))
                  }
                  placeholder="Departamento"
                />
              </div>
            </div>

            <button
              onClick={saveClient}
              disabled={saving}
              className="rounded-2xl border px-4 py-3 text-sm font-semibold transition hover:brightness-110 disabled:opacity-60"
              style={{
                borderColor:
                  "color-mix(in oklab, var(--t-accent) 45%, var(--t-card-border))",
                background: "var(--t-cta)",
                color: "#0b0b0b",
              }}
            >
              {saving
                ? "Guardando..."
                : editing
                  ? "Actualizar cliente"
                  : "Guardar tercero"}
            </button>
          </div>
        </div>

        <div {...cardProps()}>
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">{title}</h2>
              <p className="mt-1 text-sm" style={{ color: "var(--t-muted)" }}>
                {clients.length} cliente{clients.length === 1 ? "" : "s"}{" "}
                cargado{clients.length === 1 ? "" : "s"}.
              </p>
            </div>

            <input
              {...inputProps()}
              className="w-full rounded-2xl border px-4 py-3 text-sm outline-none md:w-64"
              placeholder="Buscar clientes..."
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>

          {loading ? (
            <p className="mt-6 text-sm" style={{ color: "var(--t-muted)" }}>
              Cargando clientes...
            </p>
          ) : filtered.length === 0 ? (
            <p className="mt-6 text-sm" style={{ color: "var(--t-muted)" }}>
              No hay clientes aún.
            </p>
          ) : (
            <div className="mt-6 space-y-4">
              {filtered.map((client) => (
                <div
                  key={client.id}
                  className="rounded-[24px] border p-4"
                  style={{
                    borderColor: "var(--t-card-border)",
                    background:
                      "color-mix(in oklab, var(--t-card-bg) 94%, transparent)",
                  }}
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <p className="font-semibold">{client.name}</p>
                      <p
                        className="mt-1 text-sm"
                        style={{ color: "var(--t-muted)" }}
                      >
                        {client.document_number ? docWithDv(client.document_number) : "Sin documento"} · Precio {client.price_list}
                      </p>
                      <p
                        className="mt-1 text-sm"
                        style={{ color: "var(--t-muted)" }}
                      >
                        {client.email ?? "Sin email"} · {client.mobile ?? "Sin WhatsApp"}
                      </p>
                    </div>

                    <div className="flex gap-2">
                      <IconBtn icon="edit" title="Modificar tercero" onClick={() => editClient(client)} />
                      <IconBtn icon="trash" tone="danger" title="Eliminar" onClick={() => deleteClient(client)} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
