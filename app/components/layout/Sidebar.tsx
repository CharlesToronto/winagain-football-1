"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { navItems } from "./navItems";
import CiblePanel from "@/app/components/cible/CiblePanel";
import { CIBLE_ACTIVE_EVENT, CIBLE_ACTIVE_KEY } from "@/lib/cible";

export default function Sidebar() {
  const pathname = usePathname();
  const [cibleActive, setCibleActive] = useState(false);
  const [usersOpen, setUsersOpen] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const readActive = () => {
      try {
        return localStorage.getItem(CIBLE_ACTIVE_KEY) === "true";
      } catch {
        return false;
      }
    };
    setCibleActive(readActive());

    const handleUpdated = () => setCibleActive(readActive());
    const handleStorage = (event: StorageEvent) => {
      if (event.key === CIBLE_ACTIVE_KEY) {
        setCibleActive(readActive());
      }
    };

    window.addEventListener(CIBLE_ACTIVE_EVENT, handleUpdated as EventListener);
    window.addEventListener("storage", handleStorage);
    return () => {
      window.removeEventListener(CIBLE_ACTIVE_EVENT, handleUpdated as EventListener);
      window.removeEventListener("storage", handleStorage);
    };
  }, []);

  useEffect(() => {
    if (pathname.startsWith("/users") || pathname.startsWith("/admin-data")) {
      setUsersOpen(true);
    }
  }, [pathname]);

  return (
    <div
      className="
    h-full w-64
    bg-transparent
    backdrop-blur-xl
    border-r border-white/10
    text-white
    flex flex-col
    p-6
    overflow-y-auto
    no-scrollbar
  "
    >
      <nav className="flex flex-col gap-1.5">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isUsers = item.href === "/users" && item.children?.length;
          const childActive = item.children?.some((child) =>
            pathname.startsWith(child.href)
          );
          const active = pathname.startsWith(item.href) || Boolean(childActive);

          if (isUsers) {
            return (
              <div key={item.href} className="space-y-1">
                <button
                  type="button"
                  onClick={() => setUsersOpen((prev) => !prev)}
                  className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm w-full ${
                    active
                      ? "bg-white/20 text-white"
                      : "text-white/80 hover:bg-white/10"
                  }`}
                  aria-expanded={usersOpen}
                >
                  <Icon size={18} />
                  <span className="flex-1 text-left">{item.name}</span>
                  <svg
                    viewBox="0 0 24 24"
                    width={16}
                    height={16}
                    className={`transition-transform ${usersOpen ? "rotate-180" : ""}`}
                    aria-hidden
                  >
                    <path
                      d="M6 9l6 6 6-6"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
                {usersOpen ? (
                  <div className="ml-8 flex flex-col gap-1">
                    {item.children?.map((child) => {
                      const childIsActive = pathname.startsWith(child.href);
                      return (
                        <Link
                          key={child.href}
                          href={child.href}
                          className={`px-2 py-1 rounded-md text-xs ${
                            childIsActive
                              ? "bg-white/15 text-white"
                              : "text-white/70 hover:bg-white/10"
                          }`}
                        >
                          {child.name}
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
              className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm ${
                active ? "bg-white/20 text-white" : "text-white/80 hover:bg-white/10"
              }`}
            >
              <Icon size={18} />
              {item.name}
            </Link>
          );
        })}
      </nav>
      {cibleActive ? (
        <div className="mt-6">
          <CiblePanel />
        </div>
      ) : null}
      <div className="mt-auto pt-6">
        <div id="sidebar-tools" />
      </div>
    </div>
  );
}
