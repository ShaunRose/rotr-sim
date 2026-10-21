import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ROTR / SIM - Navigation Lab",
  description: "A Vessel.js navigation sandbox for exploring two-vessel encounters.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
