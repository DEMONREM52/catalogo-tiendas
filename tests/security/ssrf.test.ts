import { test } from "node:test";
import assert from "node:assert/strict";
import { publicImageUrl } from "@/lib/share/identity";

// El servidor descarga el logo que escribe cada tienda: nunca debe pedir direcciones internas.
test("logos: solo https a dominios públicos", () => {
  const cases: Array<[string, boolean]> = [
    ["https://xyz.supabase.co/storage/v1/object/public/logos/a.png", true],
    ["https://cdn.example.com/logo.webp", true],
    ["http://cdn.example.com/logo.png", false],
    ["https://127.0.0.1/x.png", false],
    ["https://169.254.169.254/latest/meta-data", false],
    ["https://[::1]/x", false],
    ["https://2130706433/x", false],
    ["https://0x7f000001/x", false],
    ["https://localhost/x", false],
    ["https://db.internal/x", false],
    ["https://metadata.google.internal/x", false],
    ["https://user:pass@cdn.example.com/x", false],
    ["https://cdn.example.com:8443/x", false],
    ["file:///etc/passwd", false],
    ["javascript:alert(1)", false],
    ["", false],
  ];
  for (const [url, ok] of cases) assert.equal(publicImageUrl(url) !== null, ok, url);
});
