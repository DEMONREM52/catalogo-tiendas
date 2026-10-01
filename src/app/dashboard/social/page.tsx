import type { Metadata } from "next";
import SocialDashboard from "./SocialDashboard";

export const metadata: Metadata = { title: "RemHub Social" };

export default function SocialPage() {
  return <SocialDashboard />;
}
