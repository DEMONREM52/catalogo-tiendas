"use client";

import { MODE_INFO, getPrinterSettings, savePrinterSettings, type PrinterSettings } from "./settings";
import { ticketEscpos, ticketHtml, type TicketData } from "./ticket";

/**
 * Cómo llegan los bytes a la impresora, según el modo de este equipo:
 * WebUSB, Web Serial (puerto COM), Web Bluetooth (BLE), la app RawBT de Android o una página
 * que imprime sola (Chrome con --kiosk-printing). Todo funciona sin internet (no pasa por el servidor).
 */

// ---------------------------------------------------------------- tipos mínimos (el navegador los trae)
type UsbEndpoint = { endpointNumber: number; direction: "in" | "out"; type: "bulk" | "interrupt" | "isochronous" };
type UsbInterface = { interfaceNumber: number; claimed: boolean; alternates: Array<{ interfaceClass: number; endpoints: UsbEndpoint[] }> };
type UsbDevice = {
  vendorId: number; productId: number; productName?: string; opened: boolean;
  configuration: { interfaces: UsbInterface[] } | null;
  open(): Promise<void>; close(): Promise<void>; selectConfiguration(n: number): Promise<void>;
  claimInterface(n: number): Promise<void>; transferOut(ep: number, data: BufferSource): Promise<{ status: string }>;
};
type Usb = { requestDevice(o: { filters: unknown[] }): Promise<UsbDevice>; getDevices(): Promise<UsbDevice[]> };
type SerialPort = {
  open(o: { baudRate: number }): Promise<void>; close(): Promise<void>; writable: WritableStream<Uint8Array> | null;
  getInfo(): { usbVendorId?: number; usbProductId?: number };
};
type Serial = { requestPort(): Promise<SerialPort>; getPorts(): Promise<SerialPort[]> };
type BtCharacteristic = {
  properties: { write: boolean; writeWithoutResponse: boolean };
  writeValueWithoutResponse?(v: BufferSource): Promise<void>; writeValueWithResponse?(v: BufferSource): Promise<void>; writeValue(v: BufferSource): Promise<void>;
};
type BtService = { getCharacteristics(): Promise<BtCharacteristic[]> };
type BtDevice = { id: string; name?: string; gatt?: { connected: boolean; connect(): Promise<{ getPrimaryService(u: string | number): Promise<BtService>; getPrimaryServices(): Promise<BtService[]> }> } };
type Bluetooth = { requestDevice(o: unknown): Promise<BtDevice>; getDevices?(): Promise<BtDevice[]> };

const nav = () => (typeof navigator === "undefined" ? null : (navigator as unknown as { usb?: Usb; serial?: Serial; bluetooth?: Bluetooth }));

/** ¿El navegador de este equipo tiene la tecnología de ese modo? */
export function modeSupported(mode: PrinterSettings["mode"]): { ok: boolean; why?: string } {
  const n = nav();
  if (mode === "usb" && !n?.usb) return { ok: false, why: "Este navegador no tiene USB directo (usa Chrome o Edge; en iPhone no existe)." };
  if (mode === "serial" && !n?.serial) return { ok: false, why: "Este navegador no tiene puerto serie (usa Chrome o Edge en computador)." };
  if (mode === "bluetooth" && !n?.bluetooth) return { ok: false, why: "Este navegador no tiene Bluetooth web (usa Chrome en Android o computador; en iPhone no existe)." };
  if (mode === "rawbt" && !/Android/i.test(typeof navigator === "undefined" ? "" : navigator.userAgent)) return { ok: false, why: "RawBT es una app de Android." };
  return { ok: true };
}

// Servicios BLE de las térmicas más comunes (genéricas chinas, Xprinter, MTP, Goojprt, PeriPage, ISSC…).
const BLE_SERVICES: Array<string | number> = [
  0x18f0, 0xff00, 0xffe0, 0xfff0, 0xae30,
  "e7810a71-73ae-499d-8c15-faa9aef0c3f2",
  "49535343-fe7d-4ae5-8fa9-9fafd205e455",
  "000018f0-0000-1000-8000-00805f9b34fb",
];

// ---------------------------------------------------------------- emparejar (necesitan un toque del usuario)
/** Elige la impresora USB (se recuerda para las siguientes). */
export async function pairUsb() {
  const usb = nav()?.usb;
  if (!usb) throw new Error(modeSupported("usb").why);
  const d = await usb.requestDevice({ filters: [] });
  savePrinterSettings({ usb: { vendorId: d.vendorId, productId: d.productId, name: d.productName }, mode: "usb" });
  return d.productName ?? "Impresora USB";
}

export async function pairSerial() {
  const serial = nav()?.serial;
  if (!serial) throw new Error(modeSupported("serial").why);
  const port = await serial.requestPort();
  const info = port.getInfo();
  savePrinterSettings({ serial: { usbVendorId: info.usbVendorId, usbProductId: info.usbProductId }, mode: "serial" });
  return "Puerto elegido";
}

let bt: { device: BtDevice; ch: BtCharacteristic } | null = null;

async function connectBt(device: BtDevice) {
  const server = await device.gatt!.connect();
  const services: BtService[] = [];
  for (const u of BLE_SERVICES) {
    try {
      services.push(await server.getPrimaryService(u));
    } catch {
      // ese servicio no está en esta impresora
    }
  }
  if (!services.length) {
    try {
      services.push(...(await server.getPrimaryServices()));
    } catch {
      // nada más que probar
    }
  }
  for (const s of services) {
    for (const c of await s.getCharacteristics()) {
      if (c.properties.write || c.properties.writeWithoutResponse) {
        bt = { device, ch: c };
        return bt;
      }
    }
  }
  throw new Error("La impresora Bluetooth no deja escribir. Revisa que sea una térmica BLE (o usa RawBT en Android).");
}

export async function pairBluetooth() {
  const b = nav()?.bluetooth;
  if (!b) throw new Error(modeSupported("bluetooth").why);
  const device = await b.requestDevice({ acceptAllDevices: true, optionalServices: BLE_SERVICES });
  await connectBt(device);
  savePrinterSettings({ bluetooth: { id: device.id, name: device.name }, mode: "bluetooth" });
  return device.name ?? "Impresora Bluetooth";
}

/** ¿La impresora Bluetooth está conectada en esta sesión? */
export const bluetoothConnected = () => Boolean(bt?.device.gatt?.connected);

// ---------------------------------------------------------------- enviar bytes
let usbOpen: { device: UsbDevice; endpoint: number } | null = null;

async function sendUsb(bytes: Uint8Array, s: PrinterSettings) {
  const usb = nav()?.usb;
  if (!usb) throw new Error(modeSupported("usb").why);
  if (!usbOpen || !usbOpen.device.opened) {
    const devices = await usb.getDevices();
    const device = devices.find((d) => s.usb && d.vendorId === s.usb.vendorId && d.productId === s.usb.productId) ?? devices[0];
    if (!device) throw new Error("No hay impresora USB elegida: toca «Elegir impresora».");
    await device.open();
    if (!device.configuration) await device.selectConfiguration(1);
    const ifaces = device.configuration?.interfaces ?? [];
    const pick = ifaces.find((i) => i.alternates.some((a) => a.interfaceClass === 7)) ?? ifaces.find((i) => i.alternates.some((a) => a.endpoints.some((e) => e.direction === "out" && e.type === "bulk")));
    const ep = pick?.alternates.flatMap((a) => a.endpoints).find((e) => e.direction === "out" && e.type === "bulk");
    if (!pick || !ep) throw new Error("Esa impresora USB no tiene salida de datos.");
    try {
      await device.claimInterface(pick.interfaceNumber);
    } catch {
      throw new Error("Windows tiene tomada la impresora USB. Usa «Directo con Chrome» o «Puerto COM», o instala el controlador WinUSB (Zadig).");
    }
    usbOpen = { device, endpoint: ep.endpointNumber };
  }
  for (let i = 0; i < bytes.length; i += 4096) {
    const r = await usbOpen.device.transferOut(usbOpen.endpoint, bytes.slice(i, i + 4096));
    if (r.status !== "ok") throw new Error("La impresora USB no recibió los datos.");
  }
}

async function sendSerial(bytes: Uint8Array, s: PrinterSettings) {
  const serial = nav()?.serial;
  if (!serial) throw new Error(modeSupported("serial").why);
  const ports = await serial.getPorts();
  const port = ports.find((p) => {
    const info = p.getInfo();
    return s.serial?.usbVendorId !== undefined && info.usbVendorId === s.serial.usbVendorId && info.usbProductId === s.serial.usbProductId;
  }) ?? ports[0];
  if (!port) throw new Error("No hay puerto elegido: toca «Elegir impresora».");
  try {
    await port.open({ baudRate: s.baudRate || 9600 });
  } catch (e) {
    if (!/already open/i.test(String((e as Error)?.message))) throw new Error("No se pudo abrir el puerto de la impresora (¿está prendida y emparejada?).");
  }
  const writer = port.writable?.getWriter();
  if (!writer) throw new Error("El puerto de la impresora no deja escribir.");
  try {
    await writer.write(bytes);
  } finally {
    writer.releaseLock();
    await port.close().catch(() => undefined);
  }
}

async function sendBluetooth(bytes: Uint8Array, s: PrinterSettings) {
  if (!bt || !bt.device.gatt?.connected) {
    // Reconectar al aparato de antes (si el navegador lo permite sin volver a preguntar).
    const b = nav()?.bluetooth;
    const known = bt?.device ?? (b?.getDevices ? (await b.getDevices()).find((d) => d.id === s.bluetooth?.id) : undefined);
    if (!known) throw new Error("Conecta la impresora Bluetooth: toca «Elegir impresora» (una vez por sesión).");
    await connectBt(known);
  }
  const ch = bt!.ch;
  for (let i = 0; i < bytes.length; i += 100) {
    const chunk = bytes.slice(i, i + 100);
    if (ch.properties.writeWithoutResponse && ch.writeValueWithoutResponse) await ch.writeValueWithoutResponse(chunk);
    else if (ch.writeValueWithResponse) await ch.writeValueWithResponse(chunk);
    else await ch.writeValue(chunk);
    await new Promise((r) => setTimeout(r, 15));
  }
}

function base64(bytes: Uint8Array) {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** RawBT (Android): la app recibe los bytes por un enlace y los imprime. Si no está instalada, se abre su página en Play Store. */
function sendRawbt(bytes: Uint8Array) {
  window.location.href = `intent:base64,${base64(bytes)}#Intent;scheme=rawbt;package=ru.a402d.rawbtprinter;end;`;
}

/** Imprime una página en un marco oculto (con Chrome --kiosk-printing no aparece ninguna ventana). */
export function printHtmlSilently(html: string) {
  const frame = document.createElement("iframe");
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
  frame.srcdoc = html.replace("<script>window.onload", "<script>window.onload_disabled");
  frame.onload = () => {
    try {
      frame.contentWindow?.focus();
      frame.contentWindow?.print();
    } finally {
      window.setTimeout(() => frame.remove(), 60_000);
    }
  };
  document.body.appendChild(frame);
}

/** Abre la página del comprobante en otra ventana (modo navegador). Debe llamarse justo después de un toque. */
export function printHtmlWindow(html: string) {
  const w = window.open("", "_blank", "width=420,height=640");
  if (w) {
    w.document.open();
    w.document.write(html);
    w.document.close();
    return true;
  }
  printHtmlSilently(html);
  return false;
}

async function qrImage(t: TicketData) {
  if (!t.qr?.data) return null;
  try {
    const QR = (await import("qrcode")).default;
    return await QR.toDataURL(t.qr.data, { errorCorrectionLevel: "M", margin: 1, width: 280 });
  } catch {
    return null;
  }
}

export type PrintResult = { ok: boolean; message?: string };

/**
 * Imprime un tiquete con el modo de este equipo. En modo navegador abre la ventana de siempre;
 * en los modos directos no abre nada. Nunca lanza error: devuelve qué pasó para avisarlo.
 */
export async function printTicket(t: TicketData, size: "tirilla" | "carta", settings: PrinterSettings = getPrinterSettings()): Promise<PrintResult> {
  try {
    if (settings.mode === "browser" || settings.mode === "kiosk") {
      const html = ticketHtml(t, size, settings.qr ? await qrImage(t) : null);
      if (settings.mode === "kiosk") printHtmlSilently(html);
      else printHtmlWindow(html);
      return { ok: true };
    }
    const bytes = ticketEscpos(t, settings);
    if (settings.mode === "usb") await sendUsb(bytes, settings);
    else if (settings.mode === "serial") await sendSerial(bytes, settings);
    else if (settings.mode === "bluetooth") await sendBluetooth(bytes, settings);
    else sendRawbt(bytes);
    return { ok: true };
  } catch (e) {
    usbOpen = null;
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

/** Manda bytes ESC/POS ya armados (etiquetas, rótulos) a la térmica conectada directo. Nunca lanza error. */
export async function sendEscpos(bytes: Uint8Array, settings: PrinterSettings = getPrinterSettings()): Promise<PrintResult> {
  try {
    if (settings.mode === "usb") await sendUsb(bytes, settings);
    else if (settings.mode === "serial") await sendSerial(bytes, settings);
    else if (settings.mode === "bluetooth") await sendBluetooth(bytes, settings);
    else if (settings.mode === "rawbt") sendRawbt(bytes);
    else return { ok: false, message: "Esto se imprime directo solo con una térmica conectada (USB, COM, Bluetooth o RawBT)." };
    return { ok: true };
  } catch (e) {
    usbOpen = null;
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

/** Abre el cajón monedero (solo térmicas ESC/POS con cajón conectado). */
export async function openDrawer(settings: PrinterSettings = getPrinterSettings()): Promise<PrintResult> {
  if (!MODE_INFO[settings.mode].escpos) return { ok: false, message: "El cajón se abre solo con una térmica conectada directo (USB, COM, Bluetooth o RawBT)." };
  return sendEscpos(Uint8Array.from([0x1b, 0x40, 0x1b, 0x70, 0x00, 0x19, 0xfa]), settings);
}
