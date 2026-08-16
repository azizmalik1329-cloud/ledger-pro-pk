import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./audit-fixes.css";
import UIShell from "./ui-shell";
import "./polish.css";

export const metadata: Metadata = {
  title: "Ledger Pro PK",
  description: "Secure ledger, stock aur accounting app for Pakistani businesses.",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/icon.svg" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0b1730",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}<UIShell /></body></html>;
}
