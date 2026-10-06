"use client";

import { useParams } from "next/navigation";
import StaffLogin from "@/components/StaffLogin";

export default function StoreAccessPage() {
  const params = useParams<{ slug: string }>();
  return <StaffLogin storeSlug={params.slug} />;
}
