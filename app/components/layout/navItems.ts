import {
  IconHome,
  IconTrophy,
  IconCalendar,
  IconSearch,
  IconUsers,
  IconWallet,
  IconDatabase,
  IconMessage,
} from "@/app/components/icons";

export const navItems = [
  { name: "Home", href: "/home", icon: IconHome },
  { name: "Leagues", href: "/leagues", icon: IconTrophy },
  { name: "Rencontre", href: "/rencontre", icon: IconCalendar },
  { name: "Bankroll", href: "/bankroll", icon: IconWallet },
  { name: "Search", href: "/search", icon: IconSearch },
  { name: "Chat", href: "/chat", icon: IconMessage },
  {
    name: "Users",
    href: "/users",
    icon: IconUsers,
    children: [
      { name: "Profil", href: "/users", icon: IconUsers },
      { name: "Admin Data", href: "/admin-data", icon: IconDatabase },
    ],
  },
];
