import {
  FlaskConical,
  Layers,
  ListChecks,
  Radar,
  ScrollText,
  Server,
  ShieldBan,
  Shuffle,
  SlidersHorizontal,
  Trophy,
  UserRound,
  Wallet,
  Zap,
  type LucideIcon,
} from "lucide-react";

export type NavItem = { href: string; label: string; icon: LucideIcon; /** The key after "G" that jumps here (G then B = Backtest). */ key: string };

export const NAV_GROUPS: { label: string; items: NavItem[] }[] = [
  {
    label: "Track",
    items: [
      { href: "/", label: "Traders", icon: Radar, key: "T" },
      { href: "/leaderboard", label: "Leaderboard", icon: Trophy, key: "L" },
      { href: "/lists", label: "Lists", icon: ListChecks, key: "I" },
      { href: "/blacklisted", label: "Blacklisted", icon: ShieldBan, key: "K" },
    ],
  },
  {
    label: "Simulate",
    items: [
      { href: "/profiles", label: "Profiles", icon: Layers, key: "P" },
      { href: "/wallets", label: "Sim wallets", icon: Wallet, key: "W" },
      { href: "/backtest", label: "Backtest", icon: FlaskConical, key: "B" },
    ],
  },
  {
    label: "Trade live",
    items: [{ href: "/live-wallets", label: "Live wallets", icon: Zap, key: "V" }],
  },
  {
    label: "System",
    items: [
      { href: "/rpc", label: "RPC", icon: Server, key: "R" },
      { href: "/proxies", label: "Proxies", icon: Shuffle, key: "X" },
      { href: "/logs", label: "Logs", icon: ScrollText, key: "O" },
    ],
  },
];

export const SETTINGS_ITEM: NavItem = { href: "/settings", label: "Profile settings", icon: SlidersHorizontal, key: "S" };
export const ACCOUNT_ITEM: NavItem = { href: "/account", label: "Account", icon: UserRound, key: "A" };

/** Every page you can jump to, with the section it sits under. */
export const ALL_PAGES: (NavItem & { section: string })[] = [
  ...NAV_GROUPS.flatMap((g) => g.items.map((i) => ({ ...i, section: g.label }))),
  { ...SETTINGS_ITEM, section: "System" },
  { ...ACCOUNT_ITEM, section: "System" },
];

export function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}
