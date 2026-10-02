export const STORE_CONTACT_ICONS = [
  { value: "other", group: "other", label: "Otro", emoji: "✨", accessory: "none", tone: "#fef3c7" },
  { value: "woman-1", group: "woman", label: "Vendedora 1", emoji: "👩🏻‍💼", accessory: "phone", tone: "#fce7f3" },
  { value: "woman-2", group: "woman", label: "Vendedora 2", emoji: "👩🏼‍💼", accessory: "headset", tone: "#fae8ff" },
  { value: "woman-3", group: "woman", label: "Vendedora 3", emoji: "👩🏽‍💼", accessory: "phone", tone: "#ffe4e6" },
  { value: "woman-4", group: "woman", label: "Vendedora 4", emoji: "👩🏾‍💼", accessory: "headset", tone: "#fce7f3" },
  { value: "woman-5", group: "woman", label: "Vendedora 5", emoji: "👩🏿‍💼", accessory: "phone", tone: "#ffedd5" },
  { value: "woman-6", group: "woman", label: "Vendedora 6", emoji: "👩🏻‍💼", accessory: "headset", tone: "#fef3c7" },
  { value: "woman-7", group: "woman", label: "Vendedora 7", emoji: "👩🏼‍💼", accessory: "phone", tone: "#e0f2fe" },
  { value: "woman-8", group: "woman", label: "Vendedora 8", emoji: "👩🏽‍💼", accessory: "headset", tone: "#f3e8ff" },
  { value: "woman-9", group: "woman", label: "Vendedora 9", emoji: "👩🏾‍💼", accessory: "phone", tone: "#dbeafe" },
  { value: "woman-10", group: "woman", label: "Vendedora 10", emoji: "👩🏿‍💼", accessory: "headset", tone: "#fce7f3" },
  { value: "man-1", group: "man", label: "Vendedor 1", emoji: "👨🏻‍💼", accessory: "phone", tone: "#dbeafe" },
  { value: "man-2", group: "man", label: "Vendedor 2", emoji: "👨🏼‍💼", accessory: "headset", tone: "#e0f2fe" },
  { value: "man-3", group: "man", label: "Vendedor 3", emoji: "👨🏽‍💼", accessory: "phone", tone: "#cffafe" },
  { value: "man-4", group: "man", label: "Vendedor 4", emoji: "👨🏾‍💼", accessory: "headset", tone: "#dbeafe" },
  { value: "man-5", group: "man", label: "Vendedor 5", emoji: "👨🏿‍💼", accessory: "phone", tone: "#ffedd5" },
  { value: "man-6", group: "man", label: "Vendedor 6", emoji: "👨🏻‍💼", accessory: "headset", tone: "#fef3c7" },
  { value: "man-7", group: "man", label: "Vendedor 7", emoji: "👨🏼‍💼", accessory: "phone", tone: "#e0f2fe" },
  { value: "man-8", group: "man", label: "Vendedor 8", emoji: "👨🏽‍💼", accessory: "headset", tone: "#f3e8ff" },
  { value: "man-9", group: "man", label: "Vendedor 9", emoji: "👨🏾‍💼", accessory: "phone", tone: "#dbeafe" },
  { value: "man-10", group: "man", label: "Vendedor 10", emoji: "👨🏿‍💼", accessory: "headset", tone: "#e0f2fe" },
] as const;

export type StoreContactIcon = (typeof STORE_CONTACT_ICONS)[number]["value"];

export type StoreContactChannel = {
  id: string;
  label: string;
  phone: string;
  icon: StoreContactIcon;
  active: boolean;
};

type StoredContactChannel = Partial<StoreContactChannel>;

export function isStoreContactIcon(value: unknown): value is StoreContactIcon {
  return STORE_CONTACT_ICONS.some((option) => option.value === value);
}

function normalizeSavedIcon(value: unknown): StoreContactIcon {
  if (isStoreContactIcon(value)) return value;
  if (value === "woman" || value === "woman-advisor" || value === "woman-support") return "woman-1";
  if (value === "man" || value === "man-advisor" || value === "man-support") return "man-1";
  return "other";
}

export function normalizeStoreContactChannels(
  value: unknown,
  primaryPhone: string,
): StoreContactChannel[] {
  const saved = Array.isArray(value) ? (value as StoredContactChannel[]) : [];
  const primary = saved.find((channel) => channel.id === "primary");
  const extras = saved
    .filter((channel) => channel.id !== "primary")
    .map((channel, index) => ({
      id: typeof channel.id === "string" && channel.id ? channel.id : `contact-${index + 1}`,
      label: typeof channel.label === "string" ? channel.label.trim() : "",
      phone: typeof channel.phone === "string" ? channel.phone.trim() : "",
      icon: normalizeSavedIcon(channel.icon),
      active: channel.active !== false,
    }))
    .filter((channel) => channel.label && channel.phone);

  return [
    {
      id: "primary",
      label: "WhatsApp principal",
      phone: primaryPhone.trim(),
      icon: normalizeSavedIcon(primary?.icon),
      active: primary?.active !== false,
    },
    ...extras,
  ].filter((channel) => channel.phone.replace(/\D/g, "").length >= 8);
}

export function whatsappUrl(phone: string, message?: string) {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 8) return null;
  const base = `https://wa.me/${digits}`;
  return message ? `${base}?text=${encodeURIComponent(message)}` : base;
}
