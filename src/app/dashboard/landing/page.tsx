import type { Metadata } from "next";
import LandingManager from "../social/landing/LandingManager";

export const metadata: Metadata = { title: "Landing pages" };

export default function LandingPagesPage() {
  return <LandingManager />;
}
