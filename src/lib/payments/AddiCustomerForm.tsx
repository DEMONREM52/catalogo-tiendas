"use client";

import { useState, type FormEvent } from "react";

export type AddiCustomerInfo = {
  id_type: string;
  id_number: string;
  first_name: string;
  last_name: string;
  email: string;
  cellphone: string;
  address: string;
  city: string;
};

const inputClass =
  "w-full rounded-2xl border px-4 py-3 text-sm outline-none transition focus:ring-2 focus:ring-amber-400/60";

const inputStyle: React.CSSProperties = {
  borderColor: "var(--t-card-border)",
  background: "color-mix(in oklab, var(--t-card-bg) 92%, transparent)",
  color: "var(--t-text)",
};

export function AddiCustomerForm({
  busy,
  initialPhone,
  onClose,
  onSubmit,
}: {
  busy: boolean;
  initialPhone: string;
  onClose: () => void;
  onSubmit: (customer: AddiCustomerInfo) => void;
}) {
  const [customer, setCustomer] = useState<AddiCustomerInfo>({
    id_type: "CC",
    id_number: "",
    first_name: "",
    last_name: "",
    email: "",
    cellphone: initialPhone.replace(/\D/g, "").replace(/^57(?=\d{10}$)/, ""),
    address: "",
    city: "",
  });

  function update(field: keyof AddiCustomerInfo, value: string) {
    setCustomer((prev) => ({ ...prev, [field]: value }));
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSubmit(customer);
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center bg-black/70 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="addi-form-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <form
        className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-t-[28px] border p-5 shadow-2xl sm:rounded-[28px] sm:p-7"
        onSubmit={submit}
        style={{
          borderColor: "var(--t-card-border)",
          background: "var(--t-card-bg)",
          color: "var(--t-text)",
        }}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-amber-400">Pago seguro en cuotas</p>
            <h2 id="addi-form-title" className="mt-1 text-xl font-bold">Continúa con Addi</h2>
            <p className="mt-2 max-w-xl text-sm" style={{ color: "var(--t-muted)" }}>
              Addi necesita estos datos para evaluar tu solicitud. Se enviarán directamente a Addi para procesar el pago.
            </p>
          </div>
          <button
            type="button"
            aria-label="Cerrar formulario"
            onClick={onClose}
            disabled={busy}
            className="rounded-full border px-3 py-2 text-sm disabled:opacity-50"
            style={{ borderColor: "var(--t-card-border)" }}
          >
            ✕
          </button>
        </div>

        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <label className="text-sm font-semibold">
            Tipo de documento
            <select
              className={`${inputClass} mt-1`}
              style={inputStyle}
              value={customer.id_type}
              onChange={(event) => update("id_type", event.target.value)}
            >
              <option value="CC">Cédula de ciudadanía</option>
              <option value="CE">Cédula de extranjería</option>
              <option value="TI">Tarjeta de identidad</option>
              <option value="PA">Pasaporte</option>
              <option value="NIT">NIT</option>
            </select>
          </label>
          <label className="text-sm font-semibold">
            Número de documento
            <input
              className={`${inputClass} mt-1`}
              style={inputStyle}
              value={customer.id_number}
              onChange={(event) => update("id_number", event.target.value)}
              autoComplete="off"
              required
              maxLength={30}
            />
          </label>
          <label className="text-sm font-semibold">
            Nombres
            <input
              className={`${inputClass} mt-1`}
              style={inputStyle}
              value={customer.first_name}
              onChange={(event) => update("first_name", event.target.value)}
              autoComplete="given-name"
              required
              maxLength={100}
            />
          </label>
          <label className="text-sm font-semibold">
            Apellidos
            <input
              className={`${inputClass} mt-1`}
              style={inputStyle}
              value={customer.last_name}
              onChange={(event) => update("last_name", event.target.value)}
              autoComplete="family-name"
              required
              maxLength={100}
            />
          </label>
          <label className="text-sm font-semibold">
            Correo electrónico
            <input
              className={`${inputClass} mt-1`}
              style={inputStyle}
              type="email"
              value={customer.email}
              onChange={(event) => update("email", event.target.value)}
              autoComplete="email"
              required
              maxLength={254}
            />
          </label>
          <label className="text-sm font-semibold">
            Celular
            <div className="mt-1 flex gap-2">
              <span className="rounded-2xl border px-3 py-3 text-sm" style={{ borderColor: "var(--t-card-border)" }}>+57</span>
              <input
                className={inputClass}
                style={inputStyle}
                type="tel"
                inputMode="numeric"
                value={customer.cellphone}
                onChange={(event) => update("cellphone", event.target.value.replace(/\D/g, "").slice(0, 10))}
                autoComplete="tel-national"
                required
                minLength={10}
                maxLength={10}
              />
            </div>
          </label>
          <label className="text-sm font-semibold sm:col-span-2">
            Dirección de entrega
            <input
              className={`${inputClass} mt-1`}
              style={inputStyle}
              value={customer.address}
              onChange={(event) => update("address", event.target.value)}
              autoComplete="street-address"
              required
              maxLength={160}
            />
          </label>
          <label className="text-sm font-semibold sm:col-span-2">
            Ciudad
            <input
              className={`${inputClass} mt-1`}
              style={inputStyle}
              value={customer.city}
              onChange={(event) => update("city", event.target.value)}
              autoComplete="address-level2"
              required
              maxLength={100}
            />
          </label>
        </div>

        <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="btn-soft rounded-2xl px-5 py-3 text-sm font-semibold disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={busy}
            className="rounded-2xl px-5 py-3 text-sm font-bold text-slate-950 transition hover:brightness-105 disabled:opacity-60"
            style={{ background: "linear-gradient(135deg, #facc15, #f59e0b)" }}
          >
            {busy ? "Conectando con Addi..." : "Continuar a Addi"}
          </button>
        </div>
      </form>
    </div>
  );
}
