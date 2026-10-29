"use client";

import { useLayoutEffect, useRef, useState } from "react";

/**
 * Nombre de producto que no se corta a la fuerza: hasta `lines` líneas y, si es más largo, «ver más» lo muestra
 * completo sin descuadrar la fila. El nombre completo también queda en el título (al pasar el mouse) y para lectores.
 */
export function ProductName({ name, lines = 2, className = "", expandable = true }: { name: string; lines?: 1 | 2 | 3; className?: string; /** false dentro de otro botón (no se anidan botones). */ expandable?: boolean }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const [long, setLong] = useState(false);

  // ¿Se cortó? Se mide al cambiar el nombre o el ancho (la fila puede crecer o encogerse).
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || open) return;
    const measure = () => setLong(el.scrollHeight > el.clientHeight + 1);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [name, open, lines]);

  return (
    <span className={`block min-w-0 ${className}`}>
      <span
        ref={ref}
        title={name}
        className="block break-words [overflow-wrap:anywhere]"
        style={open ? undefined : { display: "-webkit-box", WebkitLineClamp: lines, WebkitBoxOrient: "vertical", overflow: "hidden" }}
      >
        {name}
      </span>
      {expandable && (long || open) ? (
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
          className="mt-0.5 text-[11px] font-bold"
          style={{ color: "var(--t-accent)" }}
          aria-expanded={open}
        >
          {open ? "ver menos" : "ver más"}
        </button>
      ) : null}
    </span>
  );
}
