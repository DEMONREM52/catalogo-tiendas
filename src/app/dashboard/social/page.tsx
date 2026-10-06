import type { Metadata } from "next";
import SocialHub from "./SocialHub";

export const metadata: Metadata = { title: "RemHub Social" };

export default function SocialPage() {
  return <SocialHub />;
}
