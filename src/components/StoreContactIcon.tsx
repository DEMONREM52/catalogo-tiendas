"use client";

import { Headphones, Smartphone } from "lucide-react";
import { STORE_CONTACT_ICONS, type StoreContactIcon as StoreContactIconType } from "@/lib/store-contacts";

export function StoreContactIcon({
  icon,
  size = 18,
  className,
}: {
  icon: StoreContactIconType;
  size?: number;
  className?: string;
}) {
  const option = STORE_CONTACT_ICONS.find((item) => item.value === icon)
    ?? STORE_CONTACT_ICONS.find((item) => item.value === "other")!;
  const Accessory = option.accessory === "headset" ? Headphones : option.accessory === "phone" ? Smartphone : null;
  return (
    <span
      className={className}
      aria-hidden="true"
      style={{
        position: "relative",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: size,
        height: size,
        maxWidth: size,
        maxHeight: size,
        overflow: "hidden",
        borderRadius: "50%",
        fontSize: size * 0.94,
        lineHeight: 1,
        flexShrink: 0,
        background: option.tone,
      }}
    >
      <span style={{ position: "absolute", inset: 0, display: "flex", width: "100%", height: "100%", alignItems: "center", justifyContent: "center", overflow: "hidden", textAlign: "center", lineHeight: 1 }}>
        {option.emoji}
      </span>
      {Accessory ? (
        <span
          style={{
            position: "absolute",
            right: 0,
            bottom: 0,
            display: "grid",
            width: Math.max(10, size * 0.38),
            height: Math.max(10, size * 0.38),
            placeItems: "center",
            overflow: "hidden",
            border: "1px solid white",
            borderRadius: "50%",
            background: option.group === "woman" ? "#db2777" : "#0284c7",
            color: "white",
          }}
        >
          <Accessory size={Math.max(7, size * 0.25)} strokeWidth={2.8} />
        </span>
      ) : null}
    </span>
  );
}
