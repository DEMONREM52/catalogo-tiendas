import { test } from "node:test";
import assert from "node:assert/strict";
import { fillNotice } from "../../src/app/dashboard/clientes/notice";

test("el mensaje del aviso lleva los datos de la cuenta", () => {
  const text = fillNotice("Hola {cliente}, te saluda {tienda}. Tu cuenta {documento} por {valor} venció el {fecha} (hace {dias} días).",
    { name: "ANA PÉREZ", balance: 150000, due_date: "2026-10-20", doc_number: "REM-00012", days_left: -6 }, "La Vitrina");
  assert.match(text, /^Hola ANA PÉREZ, te saluda La Vitrina\. Tu cuenta REM-00012 por \$\s?150\.000 venció el 20\/10\/2026 \(hace 6 días\)\.$/);
  // Sin número de documento no queda un espacio doble.
  assert.match(fillNotice("Tu cuenta {documento} por {valor}", { name: "X", balance: 1000, due_date: "2026-10-20", doc_number: null, days_left: 1 }, "T"), /^Tu cuenta por \$\s?1\.000$/);
});
