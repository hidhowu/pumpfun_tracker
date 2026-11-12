"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Ellipsis, ChevronRight, Keyboard, LogOut, Radar, Search, ShieldCheck, TrendingUp, UserRound, Wallet, Zap, FlaskConical } from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ProfileSwitcher } from "@/components/profile-switcher";
import { OpenTradesBanner } from "@/components/open-trades-banner";
import { CommandMenu } from "@/components/shell/command-menu";
import { ACCOUNT_ITEM, ALL_PAGES, NAV_GROUPS, SETTINGS_ITEM, isActive, type NavItem } from "@/components/shell/nav";
import { Kbd, ShortcutListener, ShortcutsDialog } from "@/components/shell/shortcuts";
import { StatusDot, TrackerHealth, TrackerStatusProvider, useTrackerStatus } from "@/components/shell/tracker-status";
import { useMediaQuery } from "@/hooks/use-media-query";
import { cn } from "@/lib/utils";

const ACCOUNT_HREF = ACCOUNT_ITEM.href;

// The five tabs on a phone; everything else lives behind "More" (the full sidebar as a drawer).
const MOBILE_TABS: NavItem[] = [
  { href: "/", label: "Traders", icon: Radar, key: "T" },
  { href: "/wallets", label: "Sim", icon: Wallet, key: "W" },
  { href: "/live-wallets", label: "Live", icon: Zap, key: "V" },
  { href: "/backtest", label: "Backtest", icon: FlaskConical, key: "B" },
];

/** Section + page name for the top bar breadcrumb, from the first path segment. */
function locate(pathname: string): { section: string; page: string } {
  const hit = ALL_PAGES.find((i) => isActive(pathname, i.href) && i.href !== "/") ?? ALL_PAGES.find((i) => i.href === "/" && pathname === "/");
  if (hit) return { section: hit.section, page: hit.label };
  // Trader pages live under /traders/<address>.
  if (pathname.startsWith("/traders/")) return { section: "Track", page: "Trader" };
  return { section: "Track", page: "Traders" };
}

async function signOut() {
  await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
  // A full load, not router.push: the root layout (signed-in shell) doesn't re-render on client navigation.
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
  window.location.assign("/login");
}

function MobileTabs({ pathname }: { pathname: string }) {
  const { setOpenMobile, openMobile } = useSidebar();
  const inTabs = MOBILE_TABS.some((t) => isActive(pathname, t.href));
  const tabCls =
    "flex min-h-11 flex-col items-center justify-center gap-1 text-[11px] font-medium text-text-3 transition-colors [&_svg]:size-5";
  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-30 grid h-[68px] grid-cols-5 border-t border-line bg-sidebar/95 px-1 backdrop-blur md:hidden"
    >
      {MOBILE_TABS.map((tab) => {
        const active = isActive(pathname, tab.href);
        return (
          <Link key={tab.href} href={tab.href} className={cn(tabCls, active && "text-primary")} aria-current={active ? "page" : undefined}>
            <tab.icon />
            {tab.label}
          </Link>
        );
      })}
      <button
        type="button"
        onClick={() => setOpenMobile(true)}
        aria-label="More"
        aria-expanded={openMobile}
        className={cn(tabCls, (openMobile || !inTabs) && "text-primary")}
      >
        <Ellipsis />
        More
      </button>
    </nav>
  );
}

/** The account card at the foot of the sidebar: opens a small menu (Account, Profile settings, shortcuts, Sign out). */
function AccountMenu({ username, pathname, onShortcuts }: { username: string; pathname: string; onShortcuts: () => void }) {
  const initials = username.slice(0, 2).toUpperCase();
  const [twoFactor, setTwoFactor] = useState<boolean | null>(null);
  useEffect(() => {
    fetch("/api/auth/2fa")
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => body && setTwoFactor(!!body.enabled))
      .catch(() => {});
  }, []);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Account menu (${username})`}
          className={cn(
            "flex w-full items-center gap-2.5 rounded-xl border border-line bg-surface-2 p-2 text-left transition-colors hover:border-line-2 aria-expanded:border-line-2 group-data-[collapsible=icon]:mx-auto group-data-[collapsible=icon]:size-11 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:border-transparent group-data-[collapsible=icon]:bg-transparent group-data-[collapsible=icon]:p-0",
            pathname === ACCOUNT_HREF && "border-volt-line"
          )}
        >
          <span className="flex size-7 shrink-0 items-center justify-center rounded-[9px] bg-primary font-mono text-[10px] font-semibold text-primary-foreground">{initials}</span>
          <span className="flex min-w-0 flex-1 flex-col leading-tight group-data-[collapsible=icon]:hidden">
            <span className="truncate text-[13px] font-semibold">{username}</span>
            <span className="truncate text-xs text-text-3">{twoFactor ? "2FA on · Account" : "Account"}</span>
          </span>
          <Ellipsis className="size-4 shrink-0 text-text-3 group-data-[collapsible=icon]:hidden" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-[264px] p-0">
        <div className="flex items-center gap-3 border-b border-border px-4 py-3.5">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-[11px] bg-primary font-mono text-xs font-semibold text-primary-foreground">{initials}</span>
          <div className="flex min-w-0 flex-col">
            <b className="truncate text-sm font-semibold">{username}</b>
            {twoFactor !== null ? (
              <span className={cn("flex items-center gap-1 text-xs", twoFactor ? "text-positive" : "text-text-3")}>
                <ShieldCheck className="size-3" /> {twoFactor ? "Two-factor on" : "Two-factor off"}
              </span>
            ) : null}
          </div>
        </div>
        <div className="flex flex-col p-1.5">
          <DropdownMenuItem asChild className="min-h-9">
            <Link href={ACCOUNT_HREF}>
              <UserRound /> Account &amp; security
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild className="min-h-9">
            <Link href={SETTINGS_ITEM.href}>
              <SETTINGS_ITEM.icon /> Profile settings
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem className="min-h-9" onSelect={onShortcuts}>
            <Keyboard /> Keyboard shortcuts
            <span className="ml-auto">
              <Kbd>?</Kbd>
            </span>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" className="min-h-9" onSelect={() => void signOut()}>
            <LogOut /> Sign out
          </DropdownMenuItem>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ShellFrame({ username, children }: { username: string; children: React.ReactNode }) {
  const pathname = usePathname();
  const { section, page } = locate(pathname);
  const status = useTrackerStatus();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const { setOpen } = useSidebar();
  const roomy = useMediaQuery("(min-width: 1024px)");
  // Wide screens get the full sidebar, tablets the 72px icon rail (the burger still toggles it by hand).
  useEffect(() => {
    setOpen(roomy);
  }, [roomy, setOpen]);

  /** A small count or status dot at the right of a nav row, hidden when the sidebar is a rail. */
  const rowIndicator = (href: string) => {
    if (href === "/" && status.traderCount !== null) return <SidebarMenuBadge className="text-text-3">{status.traderCount}</SidebarMenuBadge>;
    if (href === "/rpc" && status.overall.tone !== "none")
      return (
        <SidebarMenuBadge>
          <StatusDot tone={status.overall.tone} />
        </SidebarMenuBadge>
      );
    if (href === "/backtest" && status.worker?.running)
      return (
        <SidebarMenuBadge>
          <StatusDot tone="volt" />
        </SidebarMenuBadge>
      );
    return null;
  };

  return (
    <>
      <ShortcutListener onJump={() => setPaletteOpen(true)} onHelp={() => setShortcutsOpen(true)} />
      <CommandMenu open={paletteOpen} onOpenChange={setPaletteOpen} />
      <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
      <Sidebar collapsible="icon">
        <SidebarHeader className="px-3 pt-4 pb-2">
          <Link href="/" className="flex items-center gap-2.5 px-1 group-data-[collapsible=icon]:justify-center">
            <div className="flex size-[34px] shrink-0 items-center justify-center rounded-[11px] bg-primary text-primary-foreground">
              <TrendingUp className="size-[18px]" strokeWidth={2.4} />
            </div>
            <div className="flex min-w-0 flex-col leading-tight group-data-[collapsible=icon]:hidden">
              <span className="truncate text-[15px] font-semibold tracking-tight">pump.fun tracker</span>
              <span className="truncate text-xs text-text-3">Trader intelligence</span>
            </div>
          </Link>
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            aria-label="Search or jump to"
            className="mt-2 flex h-10 w-full items-center justify-between gap-2 rounded-xl border border-line-2 bg-card px-3 text-[13px] text-text-3 transition-colors group-data-[collapsible=icon]:hidden hover:border-line-3"
          >
            <span className="flex items-center gap-2">
              <Search className="size-4" /> Jump to…
            </span>
            <Kbd>⌘K</Kbd>
          </button>
        </SidebarHeader>
        <SidebarContent className="px-3">
          {NAV_GROUPS.map((group) => (
            <SidebarGroup key={group.label} className="p-0">
              <SidebarGroupLabel className="px-3 pt-3.5">{group.label}</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu className="gap-0.5">
                  {group.items.map((item) => (
                    <SidebarMenuItem key={item.href}>
                      <SidebarMenuButton asChild isActive={isActive(pathname, item.href)} tooltip={`${item.label} (G ${item.key})`}>
                        <Link href={item.href}>
                          <item.icon />
                          <span>{item.label}</span>
                        </Link>
                      </SidebarMenuButton>
                      {rowIndicator(item.href)}
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          ))}
        </SidebarContent>
        <SidebarFooter className="gap-1.5 border-t border-sidebar-border px-3 py-3">
          <SidebarMenu className="gap-0.5">
            <SidebarMenuItem>
              <SidebarMenuButton asChild isActive={pathname === SETTINGS_ITEM.href} tooltip={`${SETTINGS_ITEM.label} (G ${SETTINGS_ITEM.key})`}>
                <Link href={SETTINGS_ITEM.href}>
                  <SETTINGS_ITEM.icon />
                  <span>{SETTINGS_ITEM.label}</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
          <AccountMenu username={username} pathname={pathname} onShortcuts={() => setShortcutsOpen(true)} />
        </SidebarFooter>
      </Sidebar>
      <SidebarInset>
        {/*
          min-h + flex-wrap (instead of a fixed h-14, nowrap) is a safety
          net: the right-side group (open-trades banner + profile switcher)
          is sized to fit a ~375px phone already, but this lets the row grow
          to two lines instead of overflowing horizontally in any case that
          isn't accounted for (a very high open-trade count, a long profile
          name despite the truncate cap, an even narrower device, ...).
        */}
        <header className="sticky top-0 z-20 flex min-h-16 shrink-0 flex-wrap items-center gap-2 border-b border-border bg-background/85 px-3 py-2 backdrop-blur md:px-6 lg:px-8">
          <SidebarTrigger className="hidden md:inline-flex" />
          <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-[13px] text-text-3">
            <span className="hidden sm:inline">{section}</span>
            <ChevronRight className="hidden size-3 sm:inline" />
            <b className="truncate text-[15px] font-semibold text-foreground sm:text-[13px] sm:font-medium">{page}</b>
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPaletteOpen(true)}
              aria-label="Search traders, wallets, tokens"
              className="hidden h-9 w-[300px] items-center justify-between gap-2 rounded-[10px] border border-line-2 bg-card px-3 text-[13px] whitespace-nowrap text-text-3 transition-colors hover:border-line-3 xl:flex"
            >
              <span className="flex items-center gap-2">
                <Search className="size-4" /> Search address, wallet, token
              </span>
              <Kbd>⌘K</Kbd>
            </button>
            <button
              type="button"
              onClick={() => setPaletteOpen(true)}
              aria-label="Search traders, wallets, tokens"
              className="flex size-10 items-center justify-center rounded-full border border-line-2 bg-card text-text-2 transition-colors hover:border-line-3 hover:text-foreground sm:size-9 xl:hidden"
            >
              <Search className="size-4" />
            </button>
            <TrackerHealth />
            <OpenTradesBanner />
            <ProfileSwitcher />
          </div>
        </header>
        <div className="min-w-0 flex-1 overflow-x-clip p-4 pb-24 md:p-6 md:pb-8 lg:p-8">{children}</div>
        <MobileTabs pathname={pathname} />
      </SidebarInset>
    </>
  );
}

export function AppShell({ username, children }: { username: string; children: React.ReactNode }) {
  return (
    <SidebarProvider>
      <TrackerStatusProvider>
        <ShellFrame username={username}>{children}</ShellFrame>
      </TrackerStatusProvider>
    </SidebarProvider>
  );
}
