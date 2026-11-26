"use client";

import { useEffect, useRef, useState, type ImgHTMLAttributes } from "react";
import { thumbUrl } from "@/lib/images/thumb";

/**
 * `<img>` para tarjetas y listas: usa la miniatura de 480 px si existe (lib/images/thumb.ts) y, si falta, vuelve sola
 * a la foto grande. Con las miniaturas apagadas es un `<img>` normal.
 * Para la foto en grande (ficha del producto, visor) usa `<img>` con la dirección original.
 */
export function ThumbImg({ src, onError, ...rest }: Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> & { src: string | null | undefined }) {
  const original = src ?? "";
  const thumb = thumbUrl(original);
  // Se guarda para qué foto falló la miniatura: si cambia la foto, se vuelve a intentar con la suya.
  const [failedFor, setFailedFor] = useState<string | null>(null);
  const useThumb = Boolean(thumb) && failedFor !== original;
  const ref = useRef<HTMLImageElement>(null);

  // Si la miniatura falló antes de que la página despertara (catálogo armado en el servidor), onError no llegó.
  useEffect(() => {
    const el = ref.current;
    if (!useThumb || !el || !el.complete || el.naturalWidth !== 0) return;
    const t = window.setTimeout(() => setFailedFor(original), 0);
    return () => window.clearTimeout(t);
  }, [useThumb, original]);

  return (
    // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
    <img
      ref={ref}
      {...rest}
      src={useThumb ? thumb! : original}
      onError={(e) => {
        if (useThumb) { setFailedFor(original); return; }
        onError?.(e);
      }}
    />
  );
}
