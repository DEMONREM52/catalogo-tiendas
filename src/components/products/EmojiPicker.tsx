"use client";

import { useMemo, useState } from "react";
import { Search, X } from "lucide-react";

/**
 * Selector de emojis liviano (sin librerías): categorías pensadas para vender, buscador por palabras en español
 * y los últimos que usaste. También se puede pegar cualquier emoji o usar el teclado del celular / Windows + «.».
 */

type Cat = { key: string; label: string; icon: string; list: string };
// Cada emoji va seguido de palabras para buscarlo («🔥 fuego caliente»), separados por «|».
const CATS: Cat[] = [
  { key: "ventas", label: "Ventas", icon: "🔥", list: "🔥 fuego caliente top|💰 plata dinero precio|💵 billete efectivo|💲 precio peso|🤑 plata|💸 gasto vuela|🏷️ etiqueta precio oferta|🛍️ compras bolsa|🛒 carrito compra|💳 tarjeta pago|🧾 factura recibo|📦 caja paquete envio|🚚 envio domicilio camion|🛵 domicilio moto|📲 celular pedir|📞 llamar telefono|💬 mensaje chat|✅ listo check|☑️ check|✔️ check|❌ no equis antes|⭕ circulo|💥 explosion oferta|⚡ rayo rapido flash|🎁 regalo|🎉 fiesta celebrar|🎊 fiesta|🥳 fiesta|🆕 nuevo|🆓 gratis|🔝 top|💯 cien|‼️ atencion|❗ atencion|❓ pregunta|⏳ tiempo reloj|⌛ tiempo|⏰ alarma hora|📢 anuncio megafono|📣 megafono|👉 mano señalar|👇 abajo|👆 arriba|➡️ flecha|⬇️ abajo|🔽 abajo|🔴 rojo|🟢 verde|🟡 amarillo|🔵 azul|⭐ estrella destacado|🌟 estrella brillo|✨ brillo nuevo|💫 brillo|🏆 trofeo ganador|🥇 primero oro|👑 corona rey|💎 diamante premium|🎯 objetivo|📍 ubicacion|🗓️ fecha calendario|🔒 seguro candado|🛡️ garantia escudo|♻️ reciclar|🆗 ok" },
  { key: "caras", label: "Caras", icon: "😍", list: "😀 feliz|😃 feliz|😄 feliz|😁 sonrisa|😆 risa|😂 risa llorar|🤣 risa|😊 feliz|😍 amor enamorado|🥰 amor|😘 beso|😎 chevere gafas|🤩 wow estrella|😮 sorpresa|😱 sorpresa grito|🤯 mente explota|😳 sorpresa|🥺 por favor|😢 triste|😭 llorar|😡 bravo|🤔 pensar|🤫 secreto|🤭 risa|🙄 ojos|😴 dormir|🤤 antojo|😋 rico delicioso|😜 lengua|🤗 abrazo|🫶 corazon manos|👍 bien like|👎 mal|👏 aplausos|🙌 celebrar|🙏 gracias por favor|💪 fuerza|🤝 trato acuerdo|✌️ paz|🤞 suerte|👌 perfecto|🫵 tu|👀 mirar ojos" },
  { key: "corazones", label: "Corazones", icon: "❤️", list: "❤️ corazon rojo amor|🧡 corazon naranja|💛 corazon amarillo|💚 corazon verde|💙 corazon azul|💜 corazon morado|🖤 corazon negro|🤍 corazon blanco|🤎 corazon cafe|💖 corazon brillo|💗 corazon|💓 corazon|💕 corazones|💞 corazones|💘 corazon flecha|💝 corazon regalo|❣️ corazon|💔 corazon roto|❤️‍🔥 corazon fuego|🌹 rosa flor|🌸 flor|🌷 tulipan|🌻 girasol|💐 ramo flores" },
  { key: "productos", label: "Productos", icon: "📱", list: "📱 celular|💻 computador portatil|🖥️ computador|⌚ reloj|🎧 audifonos|🔊 parlante sonido|📷 camara foto|🎮 control juego videojuego|🕹️ juego|🔋 bateria|🔌 cargador enchufe|💡 bombillo luz|🔦 linterna|📺 televisor|🧸 juguete oso peluche|🪀 juguete|🚗 carro|🛴 patineta scooter|🚲 bicicleta|🛹 patineta|⚽ futbol balon|🏀 baloncesto|🎒 morral maleta|👜 bolso cartera|👛 monedero|👗 vestido ropa|👕 camiseta|👖 jean|👟 tenis zapato|👠 tacon|👒 sombrero|🧢 gorra|🕶️ gafas|💍 anillo|💄 labial maquillaje|🧴 crema|🧼 jabon|🪥 cepillo|🍳 cocina sarten|🍽️ plato|☕ cafe taza|🥤 vaso bebida|🍼 tetero bebe|🛏️ cama|🛋️ sofa mueble|🪑 silla|🧹 escoba aseo|🧺 canasta|🔧 herramienta llave|🔨 martillo|🪛 destornillador|🧰 caja herramientas|🐶 perro mascota|🐱 gato mascota|🌿 planta|💊 pastilla salud|🩺 salud" },
  { key: "comida", label: "Comida", icon: "🍔", list: "🍔 hamburguesa|🍕 pizza|🌭 perro caliente|🍟 papas|🌮 taco|🥗 ensalada|🍗 pollo|🥩 carne|🍰 torta pastel|🎂 torta cumpleaños|🧁 ponque|🍩 dona|🍪 galleta|🍫 chocolate|🍬 dulce|🍭 colombina|🍦 helado|🍓 fresa|🍉 sandia|🍌 banano|🍍 piña|🥑 aguacate|🍹 coctel|🍺 cerveza|🥂 brindis" },
  { key: "fechas", label: "Fechas", icon: "🎄", list: "🎄 navidad arbol|🎅 papa noel navidad|🤶 navidad|⛄ muñeco nieve|❄️ nieve|🎆 año nuevo fuegos|🎇 fuegos|🎃 halloween|👻 halloween|💘 amor amistad|🎓 grado|👶 bebe|🤰 mama embarazo|👩‍👧 mama hija|👨‍👦 papa hijo|🌞 sol verano|🏖️ playa vacaciones|🌧️ lluvia|🇨🇴 colombia bandera" },
];

const ALL = CATS.flatMap((c) => c.list.split("|").map((x) => { const [e, ...w] = x.trim().split(" "); return { e, words: `${c.label} ${w.join(" ")}`.toLowerCase() }; }));
const RECENT_KEY = "remhub:emoji-recent";
const fold = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function readRecentEmojis(): string[] {
  try { return JSON.parse(window.localStorage.getItem(RECENT_KEY) ?? "[]").slice(0, 16); } catch { return []; }
}
function pushRecent(e: string) {
  try { window.localStorage.setItem(RECENT_KEY, JSON.stringify([e, ...readRecentEmojis().filter((x) => x !== e)].slice(0, 16))); } catch { /* sin almacenamiento */ }
}

export function EmojiPicker({ onPick, onClose }: { onPick: (e: string) => void; onClose: () => void }) {
  const [cat, setCat] = useState(CATS[0].key);
  const [q, setQ] = useState("");
  const [recent, setRecent] = useState<string[]>(() => (typeof window === "undefined" ? [] : readRecentEmojis()));
  const list = useMemo(() => {
    const t = fold(q.trim());
    if (t) return ALL.filter((x) => fold(x.words).includes(t)).map((x) => x.e);
    return CATS.find((c) => c.key === cat)!.list.split("|").map((x) => x.trim().split(" ")[0]);
  }, [q, cat]);
  const pick = (e: string) => { onPick(e); pushRecent(e); setRecent(readRecentEmojis()); };

  return (
    <div className="rounded-2xl border p-2 shadow-xl" style={{ borderColor: "var(--t-card-border)", background: "var(--t-bg-base)" }}>
      <div className="flex items-center gap-1.5">
        <label className="flex flex-1 items-center gap-1.5 rounded-xl border px-2" style={{ borderColor: "var(--t-card-border)" }}>
          <Search size={13} style={{ color: "var(--t-muted)" }} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar: fuego, regalo, envío…" className="w-full bg-transparent py-1.5 text-xs outline-none" autoFocus />
        </label>
        <button type="button" onClick={onClose} className="grid h-8 w-8 place-items-center rounded-lg border" style={{ borderColor: "var(--t-card-border)" }} aria-label="Cerrar emojis"><X size={13} /></button>
      </div>
      {!q ? (
        <div className="mt-1.5 flex gap-1 overflow-x-auto [scrollbar-width:none]">
          {recent.length ? <span className="shrink-0 self-center px-1 text-[10px] font-bold" style={{ color: "var(--t-muted)" }}>Recientes</span> : null}
          {recent.map((e) => <button key={`r-${e}`} type="button" onClick={() => pick(e)} className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-lg hover:bg-black/10">{e}</button>)}
        </div>
      ) : null}
      {!q ? (
        <div className="mt-1.5 flex gap-1 overflow-x-auto [scrollbar-width:none]" role="tablist">
          {CATS.map((c) => (
            <button key={c.key} type="button" role="tab" aria-selected={cat === c.key} onClick={() => setCat(c.key)} className="inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-1 text-[11px] font-bold"
              style={cat === c.key ? { borderColor: "var(--t-accent)", background: "color-mix(in oklab, var(--t-accent) 16%, transparent)" } : { borderColor: "var(--t-card-border)" }}>
              {c.icon} {c.label}
            </button>
          ))}
        </div>
      ) : null}
      <div className="mt-1.5 grid max-h-48 grid-cols-8 gap-0.5 overflow-y-auto sm:grid-cols-10">
        {list.map((e, i) => <button key={`${e}-${i}`} type="button" onClick={() => pick(e)} className="grid aspect-square place-items-center rounded-lg text-xl transition hover:scale-125 hover:bg-black/10" title={e}>{e}</button>)}
        {!list.length ? <p className="col-span-full p-2 text-center text-[11px]" style={{ color: "var(--t-muted)" }}>Sin resultados. También puedes pegar cualquier emoji en el texto.</p> : null}
      </div>
      <p className="mt-1 text-[10px]" style={{ color: "var(--t-muted)" }}>¿Otro? Usa el teclado de emojis del celular o, en Windows, la tecla ⊞ + «.».</p>
    </div>
  );
}
