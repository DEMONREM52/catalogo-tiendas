// Lector mínimo de ZIP (solo servidor) para sacar el XML y el PDF que entrega el proveedor en un .zip.
// Soporta archivos guardados sin comprimir (0) o con deflate (8), que es lo que usan estos proveedores.
import { inflateRawSync } from "node:zlib";

export type ZipEntry = { name: string; data: Uint8Array };

export function readZip(buf: Uint8Array): ZipEntry[] {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  // Fin del directorio central: firma 0x06054b50, buscada desde el final (puede haber comentario).
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("El archivo ZIP no es válido.");
  const count = view.getUint16(eocd + 10, true);
  let ptr = view.getUint32(eocd + 16, true);
  const out: ZipEntry[] = [];
  const dec = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (view.getUint32(ptr, true) !== 0x02014b50) break;
    const method = view.getUint16(ptr + 10, true);
    const compSize = view.getUint32(ptr + 20, true);
    const nameLen = view.getUint16(ptr + 28, true);
    const extraLen = view.getUint16(ptr + 30, true);
    const commentLen = view.getUint16(ptr + 32, true);
    const localOffset = view.getUint32(ptr + 42, true);
    const name = dec.decode(buf.subarray(ptr + 46, ptr + 46 + nameLen));
    ptr += 46 + nameLen + extraLen + commentLen;
    const lNameLen = view.getUint16(localOffset + 26, true);
    const lExtraLen = view.getUint16(localOffset + 28, true);
    const start = localOffset + 30 + lNameLen + lExtraLen;
    const raw = buf.subarray(start, start + compSize);
    if (name.endsWith("/")) continue;
    if (method === 0) out.push({ name, data: raw });
    else if (method === 8) out.push({ name, data: new Uint8Array(inflateRawSync(raw)) });
  }
  return out;
}
