"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { navItems } from "./navItems";

export default function MobileNav() {
  const pathname = usePathname();

  return (
    <div className="fixed bottom-0 left-0 right-0 z-40 md:hidden mobile-show">
      <div className="relative w-full border-t border-white/10 bg-gradient-to-r from-blue-900/80 via-blue-800/75 to-blue-700/80 backdrop-blur-xl">
        <nav className="flex items-center gap-2 overflow-x-auto no-scrollbar px-2 py-2">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = pathname.startsWith(item.href);

            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex shrink-0 flex-col items-center justify-center gap-1 rounded-xl px-3 py-2 text-[10px] min-w-[72px] ${
                  active ? "bg-white/15 text-white" : "text-white/70 hover:bg-white/10"
                }`}
              >
                <Icon size={18} />
                <span className="truncate">{item.name}</span>
              </Link>
            );
          })}
        </nav>
        <div
          id="mobile-tools-anchor"
          className="absolute right-3 bottom-full z-50 flex items-end"
        />
      </div>
    </div>
  );
}
