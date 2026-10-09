// Registro único de proveedores tecnológicos. Este es el ÚNICO lugar que relaciona un código
// ('sandbox', 'alegra', …) con su implementación; el resto del sistema usa la interfaz.
import type { ElectronicInvoicingProvider } from "../provider";
import { AlegraProvider } from "./alegra";
import { SandboxProvider } from "./sandbox";

const FACTORIES: Record<string, () => ElectronicInvoicingProvider> = {
  sandbox: () => new SandboxProvider(),
  alegra: () => new AlegraProvider(),
  // TODO: 'siigo', 'thefactoryhka', 'carvajal' cuando se implementen sus adaptadores.
};

export function getProvider(code: string): ElectronicInvoicingProvider | null {
  const factory = FACTORIES[code];
  return factory ? factory() : null;
}

export function implementedProviders(): string[] {
  return Object.keys(FACTORIES);
}
