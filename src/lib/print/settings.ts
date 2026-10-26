"use client";

import { useSyncExternalStore } from "react";
import type { CodePage } from "./escpos";

/**
 * Impresora de ESTE equipo (cada computador, celular o tablet elige la suya; no se comparte).
 *   browser   · Ventana del navegador (como siempre). Es lo predeterminado: nada cambia si no se configura.
 *   kiosk     · Chrome/Edge con impresión automática (--kiosk-printing): imprime directo en la impresora predeterminada de Windows.
 *   usb       · Térmica USB directo (WebUSB): Android, Chromebook, Linux (en Windows necesita el controlador WinUSB).
 *   serial    · Puerto COM: térmica serie, USB-serie o Bluetooth emparejada en Windows (Web Serial).
 *   bluetooth · Térmica Bluetooth BLE (Web Bluetooth): Android y computadores con Bluetooth.
 *   rawbt     · App RawBT en Android (imprime por Bluetooth, USB o red).
 */
export type PrinterMode = "browser" | "kiosk" | "usb" | "serial" | "bluetooth" | "rawbt";

export type PrinterSettings = {
  mode: PrinterMode;
  /** Letras por renglón: 32 = 58 mm, 42 o 48 = 80 mm. */
  width: 32 | 42 | 48;
  codepage: CodePage;
  cut: boolean;
  /** Abrir el cajón monedero en las ventas con efectivo. */
  drawer: boolean;
  /** Imprimir solo al cobrar (sin preguntar). */
  autoPrint: boolean;
  copies: 1 | 2;
  /** Imprimir el código QR (consulta del comprobante o el de la DIAN). */
  qr: boolean;
  baudRate: number;
  /** Aparato elegido (para reconectar sin volver a preguntar). */
  usb?: { vendorId: number; productId: number; name?: string };
  serial?: { usbVendorId?: number; usbProductId?: number };
  bluetooth?: { id?: string; name?: string };
};

export const DEFAULT_PRINTER: PrinterSettings = {
  mode: "browser", width: 48, codepage: "cp850", cut: true, drawer: false, autoPrint: true, copies: 1, qr: true, baudRate: 9600,
};

export const MODE_INFO: Record<PrinterMode, { label: string; icon: string; detail: string; escpos: boolean }> = {
  browser: { label: "Ventana del navegador", icon: "🪟", detail: "Como siempre: se abre el comprobante y eliges la impresora. Sirve con cualquier impresora.", escpos: false },
  kiosk: { label: "Directo con Chrome (Windows)", icon: "⚡", detail: "Imprime solo en la impresora predeterminada de Windows, sin ventana. Hay que abrir Chrome con un acceso directo especial.", escpos: false },
  usb: { label: "Térmica USB", icon: "🔌", detail: "Directo por USB, sin ventana. Funciona en Android, Chromebook y Linux; en Windows necesita el controlador WinUSB.", escpos: true },
  serial: { label: "Térmica por puerto COM / Bluetooth en Windows", icon: "🧷", detail: "Para impresoras serie o Bluetooth emparejadas en Windows (crean un «puerto COM»).", escpos: true },
  bluetooth: { label: "Térmica Bluetooth", icon: "📶", detail: "Impresoras portátiles Bluetooth (BLE). Se conecta una vez por sesión.", escpos: true },
  rawbt: { label: "App RawBT (Android)", icon: "🤖", detail: "En celulares o tablets Android con la app RawBT instalada y configurada con tu impresora.", escpos: true },
};

const KEY = "remhub:printer";
const listeners = new Set<() => void>();
let current: PrinterSettings | null = null;

function read(): PrinterSettings {
  if (current) return current;
  try {
    const raw = localStorage.getItem(KEY);
    current = raw ? { ...DEFAULT_PRINTER, ...(JSON.parse(raw) as Partial<PrinterSettings>) } : DEFAULT_PRINTER;
  } catch {
    current = DEFAULT_PRINTER;
  }
  return current;
}

export function getPrinterSettings(): PrinterSettings {
  return typeof window === "undefined" ? DEFAULT_PRINTER : read();
}

export function savePrinterSettings(patch: Partial<PrinterSettings>) {
  current = { ...read(), ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    // sin almacenamiento: dura mientras la página siga abierta
  }
  listeners.forEach((fn) => fn());
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) {
      current = null;
      fn();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(fn);
    window.removeEventListener("storage", onStorage);
  };
}

export function usePrinterSettings(): PrinterSettings {
  return useSyncExternalStore(subscribe, read, () => DEFAULT_PRINTER);
}

/** ¿Imprime directo (sin la ventana del navegador)? */
export const isDirect = (s: PrinterSettings) => s.mode !== "browser";
