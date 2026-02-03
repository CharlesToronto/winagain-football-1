import "./globals.css";
import Sidebar from "./components/layout/Sidebar";
import MobileNav from "./components/layout/MobileNav";
import CibleFab from "./components/cible/CibleFab";
import AppShell from "./components/layout/AppShell";
import { ReactNode } from "react";

export const metadata = {
  title: "WinAgain",
  description: "Football analytics",
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fr">
      <body className="min-h-screen text-white">

        {/* Sidebar */}
        <div
          className="
    hidden md:flex mobile-hide fixed left-0 top-0 h-full w-64 
    bg-transparent 
    backdrop-blur-xl 
    border-r border-white/10 
    text-white
    flex-col
  "
        >
          <Sidebar />
        </div>

        {/* Contenu */}
        <AppShell>{children}</AppShell>

        <MobileNav />
        <CibleFab />
      </body>
    </html>
  );
}
