import {
  IconTrophy,
  IconCalendar,
  IconSearch,
  IconUsers,
  IconWallet,
  IconDatabase,
  IconChart,
  IconMessage,
  IconSettings,
} from "@/app/components/icons";

export const navItems = [
  { name: "Leagues", href: "/leagues", icon: IconTrophy },
  { name: "Rencontre", href: "/rencontre", icon: IconCalendar },
  { name: "Search", href: "/search", icon: IconSearch },
  {
    name: "Historique Algo",
    href: "/picks",
    icon: IconChart,
    children: [
      { name: "Matchs simples", href: "/picks", icon: IconChart },
      { name: "Combinés", href: "/combos", icon: IconChart },
    ],
  },
  { name: "Chat", href: "/chat", icon: IconMessage },
  {
    name: "Admin",
    href: "/admin",
    icon: IconSettings,
    children: [
      { name: "Dashboard", href: "/admin", icon: IconSettings },
      { name: "Admin Data", href: "/admin-data", icon: IconDatabase },
    ],
  },
  {
    name: "Users",
    href: "/users",
    icon: IconUsers,
    children: [
      { name: "Profil", href: "/users", icon: IconUsers },
      { name: "Bankroll", href: "/bankroll", icon: IconWallet },
    ],
  },
];
