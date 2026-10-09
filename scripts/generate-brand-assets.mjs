// Genera, desde el logo oficial de RemHub (sin textos), todo lo que sale de él:
// vista previa de enlaces (cuadrada, para que WhatsApp la muestre completa) e iconos de la app.
// Parte de public/remhub-icon-1024.png (no se modifica). Uso: node scripts/generate-brand-assets.mjs
import sharp from "sharp";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const pub = (...p) => path.join(root, "public", ...p);
const S = 1024;

// 1) Logo oficial tal cual (sin textos): es el que se usa en todo (iconos, vista previa, tarjetas).
const logo = await sharp(pub("remhub-icon-1024.png")).png({ compressionLevel: 9 }).toBuffer();
await sharp(logo).toFile(pub("remhub-logo.png"));

// 2) Vista previa de enlaces: cuadrada (WhatsApp recorta las anchas en el cuadrito).
const BG = { r: 38, g: 38, b: 38, alpha: 1 };
async function square(size, logoSize, file, format = "png") {
  const l = await sharp(logo).resize(logoSize, logoSize).toBuffer();
  let img = sharp({ create: { width: size, height: size, channels: 4, background: BG } }).composite([{ input: l, gravity: "center" }]);
  img = format === "jpg" ? img.jpeg({ quality: 88, mozjpeg: true }) : img.png({ compressionLevel: 9, palette: true, quality: 92 });
  await img.toFile(file);
}
await square(1200, 960, pub("og-image.png"));
await square(1200, 960, pub("og-default.png"));

// 3) Iconos de la app.
fs.mkdirSync(pub("icons"), { recursive: true });
for (const size of [192, 512]) {
  await sharp(logo).resize(size, size).png({ compressionLevel: 9 }).toFile(pub("icons", `remhub-${size}.png`));
}
const DARK = { r: 11, g: 11, b: 11, alpha: 1 };
async function onBg(size, scale, file) {
  const l = await sharp(logo).resize(Math.round(size * scale), Math.round(size * scale)).toBuffer();
  await sharp({ create: { width: size, height: size, channels: 4, background: DARK } }).composite([{ input: l, gravity: "center" }]).png({ compressionLevel: 9 }).toFile(file);
}
await onBg(512, 0.78, pub("icons", "remhub-maskable-512.png"));
await onBg(192, 0.78, pub("icons", "remhub-maskable-192.png"));
await onBg(180, 0.92, pub("apple-touch-icon.png"));

for (const f of ["remhub-logo.png", "og-image.png", "icons/remhub-512.png", "apple-touch-icon.png"]) {
  console.log(f, Math.round(fs.statSync(pub(f)).size / 1024) + " KB");
}
