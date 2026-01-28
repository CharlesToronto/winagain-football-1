"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { navItems } from "./navItems";

export default function MobileNav() {
  const pathname = usePathname();
  const [usersOpen, setUsersOpen] = useState(false);

  useEffect(() => {
    if (pathname.startsWith("/users") || pathname.startsWith("/admin-data")) {
      setUsersOpen(true);
    }
  }, [pathname]);

  return (
    <div className="fixed bottom-0 left-0 right-0 z-40 md:hidden mobile-show">
      <div className="relative w-full border-t border-white/10 bg-gradient-to-r from-blue-900/80 via-blue-800/75 to-blue-700/80 backdrop-blur-xl">
        <nav className="flex items-center gap-2 overflow-x-auto no-scrollbar px-2 py-2">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isUsers = item.href === "/users" && item.children?.length;
            const childActive = item.children?.some((child) =>
              pathname.startsWith(child.href)
            );
            const active = pathname.startsWith(item.href) || Boolean(childActive);

            if (isUsers) {
              return (
                <div key={item.href} className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => setUsersOpen((prev) => !prev)}
                    className={`flex shrink-0 flex-col items-center justify-center gap-1 rounded-xl px-3 py-2 text-[10px] min-w-[72px] ${
                      active
                        ? "bg-white/15 text-white"
                        : "text-white/70 hover:bg-white/10"
                    }`}
                    aria-expanded={usersOpen}
                  >
                    <Icon size={18} />
                    <span className="truncate">{item.name}</span>
                  </button>
                  {usersOpen ? (
                    <div className="flex items-center gap-2">
                      {item.children?.map((child) => {
                        const ChildIcon = child.icon;
                        const childIsActive = pathname.startsWith(child.href);
                        return (
                          <Link
                            key={child.href}
                            href={child.href}
                            className={`flex shrink-0 flex-col items-center justify-center gap-1 rounded-lg px-2 py-2 text-[9px] min-w-[60px] ${
                              childIsActive
                                ? "bg-white/20 text-white"
                                : "bg-white/5 text-white/70 hover:bg-white/10"
                            }`}
                          >
                            {ChildIcon ? <ChildIcon size={14} /> : null}
                            <span className="truncate">{child.name}</span>
                          </Link>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              );
            }

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
          className="absolute left-0 right-0 bottom-full z-50 flex items-end"
        />
      </div>
    </div>
  );
}
