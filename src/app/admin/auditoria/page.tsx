"use client";

import { AuditCenter } from "@/components/audit/AuditCenter";

/** Auditoría de toda la plataforma (solo el administrador global; lo valida la base de datos). */
export default function AdminAuditoriaPage() {
  return (
    <main className="mx-auto max-w-5xl px-3 py-4 sm:px-6">
      <AuditCenter storeId={null} />
    </main>
  );
}
