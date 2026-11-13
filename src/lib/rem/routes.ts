/**
 * Páginas del panel que REM no abre por nombre, con el porqué. Toda página nueva de src/app/dashboard tiene que
 * estar en el catálogo (buscador o menú) o aquí: si no, tests/rem/catalog-sync.test.ts falla y avisa.
 */
export const EXCLUDED_ROUTES: Record<string, string> = {
  "/dashboard/pos/document/[id]": "detalle de un documento de venta; se abre desde la venta o el Centro de operaciones.",
  "/dashboard/products/[id]": "ficha de un producto; REM la abre desde Productos («abre el primero»).",
  "/dashboard/puntos/[id]": "configuración de un punto; se abre desde Puntos.",
};
