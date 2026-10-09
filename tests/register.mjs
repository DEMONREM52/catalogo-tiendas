// Permite que `node --test` cargue los módulos TypeScript del proyecto tal como los resuelve Next
// (alias «@/» → src/ e importaciones sin extensión). Node 22.18+/24 ejecuta TypeScript nativamente.
import { register } from "node:module";

register("./resolve-hook.mjs", import.meta.url);
