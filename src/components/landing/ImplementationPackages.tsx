import { IMPLEMENTATION_EXTRAS, IMPLEMENTATION_PACKAGES, IMPLEMENTATION_TERMS, TRADITIONAL_VS_REMHUB } from "@/lib/saas/implementation";

const cop = (n: number) => "$ " + Math.round(n).toLocaleString("es-CO");

/** Paquetes de implementación (pago único, opcional). Sirve en la página de inicio y en «Mi plan». */
export function ImplementationPackages({ contactHref }: { contactHref: (text: string) => string }) {
  return (
    <div className="space-y-3">
      <div className="grid gap-3 md:grid-cols-3">
        {IMPLEMENTATION_PACKAGES.map((p) => (
          <div key={p.id} className="flex flex-col rounded-3xl border p-5" style={{ borderColor: p.highlight ? "color-mix(in oklab, var(--t-accent) 60%, transparent)" : "var(--t-card-border)", background: "var(--t-card-bg)" }}>
            <p className="text-lg font-black">{p.name}</p>
            <p className="text-xs" style={{ color: "var(--t-muted)" }}>{p.tagline}</p>
            <p className="mt-3 text-2xl font-black">{p.price ? <>{p.from ? <span className="text-sm font-semibold">desde </span> : null}{cop(p.price)}</> : "Gratis"}</p>
            <p className="text-xs" style={{ color: "var(--t-muted)" }}>{p.price ? "pago único" : "incluido en todos los planes"}</p>
            <ul className="mt-3 flex-1 space-y-1.5 text-sm">{p.includes.map((i) => <li key={i}>✓ {i}</li>)}</ul>
            {p.price ? (
              <a href={contactHref(`Hola! Me interesa el paquete «${p.name}» de RemHub para mi negocio. ¿Me cuentas cómo sería?`)} target="_blank" rel="noopener noreferrer"
                className="mt-4 rounded-2xl border px-4 py-2.5 text-center text-sm font-bold" style={{ borderColor: "var(--t-card-border)" }}>
                💬 Lo quiero
              </a>
            ) : null}
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs" style={{ color: "var(--t-muted)" }}>
        {IMPLEMENTATION_EXTRAS.map((e) => <span key={e.name}>{e.name}: <b style={{ color: "var(--t-text)" }}>{e.from ? "desde " : ""}{cop(e.price)}</b> {e.unit}</span>)}
      </div>
      <p className="text-xs" style={{ color: "var(--t-muted)" }}>{IMPLEMENTATION_TERMS}</p>
    </div>
  );
}

/** «RemHub vs. sistemas tradicionales», sin nombrar a ninguna empresa. */
export function TraditionalComparison() {
  return (
    <div className="overflow-x-auto rounded-3xl border" style={{ borderColor: "var(--t-card-border)", background: "var(--t-card-bg)" }}>
      <table className="w-full min-w-[560px] text-sm">
        <thead>
          <tr className="text-left">
            <th className="px-4 py-3 text-xs font-bold" style={{ color: "var(--t-muted)" }}> </th>
            <th className="px-4 py-3 text-xs font-bold" style={{ color: "var(--t-muted)" }}>Sistemas tradicionales</th>
            <th className="px-4 py-3 text-xs font-black" style={{ color: "var(--t-accent)" }}>RemHub</th>
          </tr>
        </thead>
        <tbody>
          {TRADITIONAL_VS_REMHUB.map((r) => (
            <tr key={r.topic} className="border-t" style={{ borderColor: "var(--t-card-border)" }}>
              <td className="px-4 py-3 font-semibold">{r.topic}</td>
              <td className="px-4 py-3" style={{ color: "var(--t-muted)" }}>{r.traditional}</td>
              <td className="px-4 py-3 font-semibold">✓ {r.remhub}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
