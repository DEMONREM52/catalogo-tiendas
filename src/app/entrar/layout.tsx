import type { Metadata } from "next";

export const metadata: Metadata = { title: "Entrando · RemHub", robots: { index: false, follow: false } };

export default function EnterLayout({ children }: { children: React.ReactNode }) {
  return children;
}
