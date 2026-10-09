import { existsSync, statSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const SRC = new URL("../src/", import.meta.url);

function isFile(path) {
  try {
    return existsSync(path) && statSync(path).isFile();
  } catch {
    return false;
  }
}

export async function resolve(specifier, context, next) {
  let target = specifier;
  if (specifier.startsWith("@/")) target = new URL(specifier.slice(2), SRC).href;
  if (target.startsWith(".") || target.startsWith("file:")) {
    const base = target.startsWith("file:") ? new URL(target) : new URL(target, context.parentURL);
    const file = fileURLToPath(base);
    for (const candidate of [file, `${file}.ts`, `${file}.tsx`, `${file}/index.ts`]) {
      if (isFile(candidate)) return next(pathToFileURL(candidate).href, context);
    }
  }
  return next(target, context);
}
