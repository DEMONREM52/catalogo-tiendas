import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  reactCompiler: true,
  // Los metadatos (manifest, icono de iPhone, vista previa) van completos en el <head> para todos los
  // navegadores, no al final de la página: Safari los toma de ahí al «Agregar a pantalla de inicio».
  htmlLimitedBots: /.*/,
};

export default nextConfig;
