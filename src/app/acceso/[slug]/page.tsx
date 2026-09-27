"use client";

import { useParams } from "next/navigation";
import StoreLogin from "@/components/StoreLogin";

export default function StoreAccessPage() {
  const params = useParams<{ slug: string }>();
  return <StoreLogin storeSlug={params.slug} />;
}
