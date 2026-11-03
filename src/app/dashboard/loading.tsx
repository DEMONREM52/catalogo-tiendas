import { SkeletonDashboard } from "@/components/ui/Skeleton";

// Mientras llega una pantalla del panel: la forma del contenido (cifras y tarjetas), no una pantalla en blanco.
export default function DashboardLoading() {
  return <SkeletonDashboard label="Cargando…" />;
}
