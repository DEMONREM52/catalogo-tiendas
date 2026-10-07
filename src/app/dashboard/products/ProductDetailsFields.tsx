"use client";

import { useState } from "react";
import { GalleryEditor } from "./GalleryEditor";
import {
  linesToList,
  linesToSpecifications,
  type ProductDetails,
} from "@/lib/product-details";

type Props = {
  details: ProductDetails;
  onChange: (details: ProductDetails) => void;
  userId: string | null;
  productId?: string;
};

const textStyle: React.CSSProperties = {
  borderColor: "var(--t-card-border)",
  background: "color-mix(in oklab, var(--t-card-bg) 92%, transparent)",
  color: "var(--t-text)",
};

export default function ProductDetailsFields({ details, onChange, userId, productId }: Props) {
  const [specsText, setSpecsText] = useState(() =>
    details.specifications.map((item) => `${item.name}: ${item.value}`).join("\n"),
  );
  const [uploadId] = useState(() => Math.random().toString(36).slice(2));

  function update<K extends keyof ProductDetails>(key: K, value: ProductDetails[K]) {
    onChange({ ...details, [key]: value });
  }

  return (
    <section className="space-y-4 rounded-[22px] border p-4 sm:p-5" style={textStyle}>
      <div>
        <h2 className="text-lg font-bold">✨ Página de producto</h2>
        <p className="mt-1 text-sm opacity-75">
          Agrega información comprobable para que tus clientes conozcan mejor el producto.
        </p>
      </div>

      <label className="block text-sm font-medium">
        Descripción completa
        <textarea
          className="mt-1 min-h-32 w-full rounded-2xl border p-3 outline-none"
          style={textStyle}
          value={details.long_description}
          onChange={(event) => update("long_description", event.target.value)}
          placeholder="Detalles, usos y contexto que conozcas del producto…"
          maxLength={10000}
        />
      </label>

      <label className="block text-sm font-medium">
        Características verificadas (una por línea)
        <textarea
          className="mt-1 min-h-24 w-full rounded-2xl border p-3 outline-none"
          style={textStyle}
          value={details.highlights.join("\n")}
          onChange={(event) => update("highlights", linesToList(event.target.value))}
          placeholder={"Incluye cable USB\nCompatible con el modelo X"}
          maxLength={3000}
        />
      </label>

      <label className="block text-sm font-medium">
        Especificaciones (una por línea, formato Nombre: valor)
        <textarea
          className="mt-1 min-h-24 w-full rounded-2xl border p-3 outline-none"
          style={textStyle}
          value={specsText}
          onChange={(event) => {
            setSpecsText(event.target.value);
            update("specifications", linesToSpecifications(event.target.value));
          }}
          placeholder={"Color: Negro\nContenido: 1 unidad"}
          maxLength={3000}
        />
      </label>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm font-medium">
          Enlace de video del producto
          <input
            className="mt-1 w-full rounded-2xl border p-3 outline-none"
            style={textStyle}
            type="url"
            value={details.video_url}
            onChange={(event) => update("video_url", event.target.value)}
            placeholder="https://…"
          />
        </label>
        <label className="block text-sm font-medium">
          Tutorial o guía de uso
          <input
            className="mt-1 w-full rounded-2xl border p-3 outline-none"
            style={textStyle}
            type="url"
            value={details.tutorial_url}
            onChange={(event) => update("tutorial_url", event.target.value)}
            placeholder="https://…"
          />
        </label>
      </div>

      <GalleryEditor
        urls={details.gallery_urls}
        onChange={(urls) => update("gallery_urls", urls)}
        userId={userId}
        productId={productId}
        uploadId={uploadId}
      />
    </section>
  );
}
