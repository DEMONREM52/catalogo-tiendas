"use client";

import AdminShell, { useInsideAdminShell } from "./AdminShell";
import AdminOverview from "./AdminOverview";

export default function AdminHome() {
  const inside = useInsideAdminShell();

  if (inside) return <AdminOverview />;

  return (
    <AdminShell>
      <AdminOverview />
    </AdminShell>
  );
}
