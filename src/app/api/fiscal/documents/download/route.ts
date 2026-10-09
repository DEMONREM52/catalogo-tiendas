// Descarga XML/PDF de un documento fiscal: permiso «Descargar XML/PDF», alcance del punto y auditoría.
import { FISCAL_BUCKET } from "@/lib/fiscal/engine";
import { assertOk, isUuid, jsonError, requireUser, rpc, FiscalApiError } from "@/lib/fiscal/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const ctx = await requireUser(request);
    const url = new URL(request.url);
    const id = url.searchParams.get("id");
    const kind = url.searchParams.get("kind") === "pdf" ? "pdf" : "xml";
    if (!isUuid(id)) throw new FiscalApiError("Falta el documento.", 400, "INVALID");
    const access = assertOk(await rpc<{ ok: true; path: string | null; full_number: string | null; status: string }>(ctx.db, "fiscal_download_access", { p_document: id, p_kind: kind }));
    if (!access.path) {
      throw new FiscalApiError(
        kind === "pdf"
          ? "El proveedor no entregó PDF para este documento. Usa la representación impresa del POS."
          : access.status === "ACCEPTED" ? "El proveedor aún no entregó el XML de este documento." : "El documento todavía no tiene XML (no ha sido aceptado).",
        404,
        "NOT_FOUND",
      );
    }
    const { data, error } = await ctx.admin().storage.from(FISCAL_BUCKET).download(access.path);
    if (error || !data) throw new FiscalApiError("No se encontró el archivo guardado.", 404, "NOT_FOUND");
    const name = `${(access.full_number ?? id).replace(/[^A-Za-z0-9_-]/g, "")}.${kind}`;
    return new Response(data, {
      headers: {
        "Content-Type": kind === "pdf" ? "application/pdf" : "application/xml; charset=utf-8",
        "Content-Disposition": `attachment; filename="${name}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}
