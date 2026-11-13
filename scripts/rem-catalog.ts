// Genera docs/REM_CAPACIDADES.md desde el catálogo de REM (src/lib/rem). Uso: npm run rem:catalog
import { writeFileSync } from "node:fs";
import { catalogMarkdown } from "@/lib/rem/catalog-doc";

writeFileSync(new URL("../docs/REM_CAPACIDADES.md", import.meta.url), catalogMarkdown() + "\n");
console.log("docs/REM_CAPACIDADES.md actualizado.");
