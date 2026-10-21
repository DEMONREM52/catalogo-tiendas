"use client";

import { useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import { openCommandPalette, openShortcuts } from "./CommandPalette";

/**
 * Ayuda dentro del panel: consejos cortos de la pantalla donde estás, atajos y soporte por WhatsApp
 * con la tienda, la pantalla y el navegador ya escritos (así no hay que explicar desde cero).
 */

const SUPPORT = process.env.NEXT_PUBLIC_REMHUB_WHATSAPP || "573218846041";

type Guide = { match: string; title: string; tips: string[] };
const GUIDES: Guide[] = [
  { match: "/dashboard/pos", title: "POS / Vender", tips: [
    "Busca por nombre, referencia o escanea el código de barras; F2 abre la búsqueda con fotos.",
    "Las existencias se actualizan solas: si otra persona vende, aquí baja el número («Existencias en vivo»).",
    "Antes de cobrar se revisa que haya unidades; si alguien vendió primero, te ofrecemos ajustar el carrito.",
    "¿Quitaste un producto por error? Toca «Deshacer» en el aviso de abajo.",
    "«En espera» guarda la venta mientras atiendes a otro cliente.",
  ] },
  { match: "/dashboard/caja", title: "Caja", tips: [
    "Abre la caja al empezar con la base en efectivo.",
    "Al cerrar, cuenta billetes y monedas: el sistema te dice si cuadra, sobra o falta.",
    "Después de cerrar puedes enviar el resumen por WhatsApp (botón 💬 también en el historial).",
  ] },
  { match: "/dashboard/inventario?tab=transfers", title: "Traslados", tips: [
    "Elige origen y destinos; «💡 Sugerir según ventas» propone cantidades con lo que vendió cada punto.",
    "Enter pasa al siguiente destino; ↑ ↓ cambian de producto; F2 agrega otro.",
    "«Disponible» baja en vivo si otra persona vende o traslada mientras armas el traslado.",
    "Mientras nadie firme «Revisado», el traslado se puede corregir.",
    "🏷️ Etiquetas imprime códigos de barras con el precio del punto que recibe.",
  ] },
  { match: "/dashboard/inventario?tab=purchases", title: "Ingreso de factura", tips: [
    "F2 busca productos con fotos; Ctrl + Enter guarda el ingreso.",
    "«✨ Crear producto» crea uno nuevo sin salir de la factura.",
    "Con el % de cada producto se recalculan sus 5 precios al guardar.",
    "En el historial puedes buscar por proveedor, número o producto, y sacar 🏷️ etiquetas.",
  ] },
  { match: "/dashboard/inventario?tab=adjustments", title: "Ajustes y conteos", tips: [
    "«Contar por partes» trae una categoría completa para contarla.",
    "Solo se ajustan los productos que cambies.",
    "Si alguien vende mientras cuentas, al aplicar te ofrecemos descontar esas ventas de tu conteo.",
  ] },
  { match: "/dashboard/inventario", title: "Inventario", tips: [
    "Existencias: filtra por punto, categoría, sin costo o con pocas unidades.",
    "Kardex: cada entrada y salida de un producto, con quién y cuándo.",
  ] },
  { match: "/dashboard/pedidos", title: "Pedidos", tips: [
    "Pedidos internos: un punto le pide mercancía a la bodega u otro punto.",
    "Antes de enviar te avisamos si ese producto ya está pedido y cuánto le queda libre a quien surte.",
  ] },
  { match: "/dashboard/clientes", title: "Clientes y cartera", tips: [
    "«Frecuentes» muestra quién compra más y a quién conviene escribirle para que vuelva.",
    "Cartera: lo que te deben, abonos y estados de cuenta.",
  ] },
  { match: "/dashboard/products", title: "Productos", tips: [
    "Los productos nuevos quedan activos aunque no tengan unidades.",
    "🏷️ Etiqueta imprime el código de barras con el precio.",
  ] },
  { match: "/dashboard/rentabilidad", title: "Rentabilidad", tips: [
    "Reglas de precio por punto: un % o un precio fijo por punto, categoría o producto.",
    "Liquidación: venta menos costo de cada punto.",
  ] },
  { match: "/dashboard", title: "Inicio", tips: [
    "«Tus pendientes» muestra lo que espera una acción tuya: traslados, pedidos, precios y productos sin costo.",
    "Ctrl + K busca cualquier cosa: páginas, productos, #traslados, clientes y ventas.",
  ] },
];

function guideFor(path: string, search: string) {
  const full = `${path}${search}`;
  return GUIDES.find((g) => (g.match.includes("?") ? full.startsWith(g.match) : path === g.match || path.startsWith(`${g.match}/`))) ?? GUIDES[GUIDES.length - 1];
}

export function HelpButton({ storeName, userName }: { storeName?: string | null; userName?: string | null }) {
  const mounted = useSyncExternalStore(() => () => {}, () => true, () => false);
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const guide = guideFor(pathname, search);

  const support = () => {
    const text = [
      "Hola! Necesito ayuda con RemHub.",
      "",
      `• Tienda: ${storeName ?? "—"}`,
      `• Usuario: ${userName ?? "—"}`,
      `• Pantalla: ${guide.title} (${window.location.pathname}${window.location.search})`,
      `• Navegador: ${navigator.userAgent.includes("Mobile") ? "celular" : "computador"}`,
      "",
      "Lo que pasa: ",
    ].join("\n");
    window.open(`https://wa.me/${SUPPORT}?text=${encodeURIComponent(text)}`, "_blank", "noopener");
  };

  return (
    <>
      <button type="button" onClick={() => { setSearch(window.location.search); setOpen(true); }} title="Ayuda" aria-label="Ayuda"
        className="inline-flex h-8 w-8 items-center justify-center rounded-xl border text-sm font-black transition hover:-translate-y-0.5"
        style={{ borderColor: "var(--t-card-border)", background: "var(--t-card-bg)", color: "var(--t-muted)" }}>?</button>
      {mounted && open ? createPortal(
        <div className="fixed inset-0 z-[190] flex justify-end" onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }} onKeyDown={(e) => { if (e.key === "Escape") setOpen(false); }} style={{ background: "rgba(0,0,0,.45)" }}>
          <aside role="dialog" aria-modal="true" aria-label="Ayuda" className="flex h-dvh w-full max-w-sm flex-col border-l p-5 shadow-2xl" style={{ borderColor: "var(--t-card-border)", background: "var(--t-bg-base)", color: "var(--t-text)" }}>
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-black">💡 Ayuda · {guide.title}</h3>
              <button type="button" autoFocus onClick={() => setOpen(false)} className="rounded-lg border px-2.5 py-1 text-xs font-semibold" style={{ borderColor: "var(--t-card-border)" }}>Cerrar</button>
            </div>
            <ul className="mt-4 flex-1 space-y-2.5 overflow-y-auto text-sm">
              {guide.tips.map((t) => (
                <li key={t} className="flex gap-2 rounded-xl border p-3" style={{ borderColor: "var(--t-card-border)", background: "var(--t-card-bg)" }}><span aria-hidden>✔️</span><span>{t}</span></li>
              ))}
            </ul>
            <div className="mt-4 space-y-2">
              <button type="button" onClick={() => { setOpen(false); openCommandPalette(); }} className="w-full rounded-xl border px-3 py-2.5 text-sm font-semibold" style={{ borderColor: "var(--t-card-border)" }}>🔍 Buscar algo (Ctrl + K)</button>
              <button type="button" onClick={() => { setOpen(false); openShortcuts(); }} className="w-full rounded-xl border px-3 py-2.5 text-sm font-semibold" style={{ borderColor: "var(--t-card-border)" }}>⌨️ Ver atajos de teclado</button>
              <button type="button" onClick={support} className="w-full rounded-xl px-3 py-2.5 text-sm font-bold text-white" style={{ background: "#16a34a" }}>💬 Hablar con soporte por WhatsApp</button>
              <p className="text-center text-[11px]" style={{ color: "var(--t-muted)" }}>El mensaje ya lleva tu tienda y la pantalla donde estás.</p>
            </div>
          </aside>
        </div>,
        document.body,
      ) : null}
    </>
  );
}
