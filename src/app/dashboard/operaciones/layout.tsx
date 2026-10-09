import type { Metadata } from "next";

export const metadata: Metadata = { title: "Centro de operaciones - RemHub" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
