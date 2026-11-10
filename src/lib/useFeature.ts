"use client";

import { useEffect, useState } from "react";
import { cachedFeatures, type FeatureKey } from "./features";

/** ¿Está encendida esta función opcional en la tienda? (false mientras carga o si falta la migración). */
export function useFeature(storeId: string | null | undefined, key: FeatureKey) {
  const [on, setOn] = useState<{ id: string; on: boolean } | null>(null);
  useEffect(() => {
    if (!storeId) return;
    let alive = true;
    void cachedFeatures(storeId).then((f) => { if (alive) setOn({ id: storeId, on: Boolean(f?.[key]?.enabled) }); });
    return () => { alive = false; };
  }, [storeId, key]);
  return Boolean(storeId && on?.id === storeId && on.on);
}
