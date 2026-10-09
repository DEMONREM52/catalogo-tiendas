// Genera los iconos de la app RemHub a partir del logo oficial (public/remhub-icon-1024.png).
// Los originales no se tocan; se crean variantes en public/icons y public/apple-touch-icon.png.
// Uso: node scripts/generate-pwa-icons.mjs
import sharp from "sharp";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const src = path.join(root, "public", "remhub-icon-1024.png");
const out = path.join(root, "public", "icons");
fs.mkdirSync(out, { recursive: true });

const BG = { r: 11, g: 11, b: 11, alpha: 1 }; // color de fondo oficial del panel (#0b0b0b)

async function onBackground(size, logoScale, file) {
  const logo = await sharp(src).resize(Math.round(size * logoScale), Math.round(size * logoScale), { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).toBuffer();
  await sharp({ create: { width: size, height: size, channels: 4, background: BG } })
    .composite([{ input: logo, gravity: "center" }])
    .png({ compressionLevel: 9 })
    .toFile(file);
}

// «any»: el logo tal cual (transparente).
for (const size of [192, 512]) {
  await sharp(src).resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).png({ compressionLevel: 9 }).toFile(path.join(out, `remhub-${size}.png`));
}
// «maskable»: Android recorta el icono en círculo/gota; el logo va dentro de la zona segura (80 %).
await onBackground(512, 0.72, path.join(out, "remhub-maskable-512.png"));
await onBackground(192, 0.72, path.join(out, "remhub-maskable-192.png"));
// iPhone: sin transparencia (iOS pondría fondo negro de todas formas) y con un margen pequeño.
await onBackground(180, 0.86, path.join(root, "public", "apple-touch-icon.png"));
console.log("Iconos generados en public/icons y public/apple-touch-icon.png");
