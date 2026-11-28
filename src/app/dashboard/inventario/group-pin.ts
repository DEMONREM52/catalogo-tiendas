/**
 * Contraseña del conteo en grupo (20261352): de 4 a 8 números (los ceros al inicio cuentan: «0482» es válida).
 * La base revisa lo mismo; esto solo avisa antes de enviar. Probado en tests/inventario/group-pin.test.ts.
 */
export function cleanPin(v: unknown): string {
  return String(v ?? "").trim();
}

export function isValidPin(v: unknown): boolean {
  return /^\d{4,8}$/.test(cleanPin(v));
}
