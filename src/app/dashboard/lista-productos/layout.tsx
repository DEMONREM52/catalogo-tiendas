import type { Metadata } from "next";

export const metadata: Metadata = { title: "Lista general de productos - RemHub" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
