import type { Metadata } from "next";
import { DemoEntry } from "./DemoEntry";

export const metadata: Metadata = {
  title: "Prueba RemHub gratis · Tienda de demostración",
  description: "Entra a una tienda de ejemplo y prueba RemHub sin registrarte: catálogos, POS, inventario, pedidos y más.",
};

export default function DemoPage() {
  return <DemoEntry />;
}
