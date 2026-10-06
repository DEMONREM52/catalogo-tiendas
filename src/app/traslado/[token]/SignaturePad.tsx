"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";

export type SignaturePadHandle = { toDataUrl: () => string | null; clear: () => void };

/** Recuadro para firmar con el dedo o el mouse. Exporta PNG con fondo blanco. */
export const SignaturePad = forwardRef<SignaturePadHandle, { onChange?: (hasInk: boolean) => void }>(function SignaturePad({ onChange }, ref) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  const [hasInk, setHasInk] = useState(false);

  function paintBackground() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // Escala moderada: nítida en celulares sin generar imágenes pesadas.
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.round(rect.width * ratio);
    canvas.height = Math.round(rect.height * ratio);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(ratio, ratio);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = 2.4;
    ctx.strokeStyle = "#0f172a";
    paintBackground();
  }, []);

  function point(e: React.PointerEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function start(e: React.PointerEvent<HTMLCanvasElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = true;
    last.current = point(e);
    const ctx = canvasRef.current?.getContext("2d");
    if (ctx && last.current) {
      ctx.beginPath();
      ctx.arc(last.current.x, last.current.y, 1.2, 0, Math.PI * 2);
      ctx.fillStyle = "#0f172a";
      ctx.fill();
    }
  }

  function move(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current || !last.current) return;
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    const p = point(e);
    ctx.beginPath();
    ctx.moveTo(last.current.x, last.current.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    last.current = p;
    if (!hasInk) {
      setHasInk(true);
      onChange?.(true);
    }
  }

  function end() {
    drawing.current = false;
    last.current = null;
  }

  function clear() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    paintBackground();
    ctx.restore();
    setHasInk(false);
    onChange?.(false);
  }

  useImperativeHandle(ref, () => ({
    toDataUrl: () => (hasInk ? canvasRef.current?.toDataURL("image/png") ?? null : null),
    clear,
  }));

  return (
    <div>
      <div className="relative overflow-hidden rounded-2xl border-2 border-dashed" style={{ borderColor: "var(--t-card-border)" }}>
        <canvas
          ref={canvasRef}
          className="block h-44 w-full cursor-crosshair touch-none"
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
          onPointerLeave={end}
          aria-label="Recuadro para firmar"
        />
        {!hasInk ? (
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm" style={{ color: "#94a3b8" }}>
            Firma aquí con el dedo
          </span>
        ) : null}
        <span className="pointer-events-none absolute bottom-8 left-6 right-6 border-b" style={{ borderColor: "#cbd5e1" }} />
      </div>
      <button type="button" onClick={clear} className="mt-1.5 text-xs font-semibold underline" style={{ color: "var(--t-muted)" }}>
        Borrar firma
      </button>
    </div>
  );
});
