"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Radar, ShieldBan, Settings, Activity, Trophy, ScrollText, Router, Shuffle, Wallet, Layers, UserRound, LogOut } from "lucide-react";
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
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { ProfileSwitcher } from "@/components/profile-switcher";
import { OpenTradesBanner } from "@/components/open-trades-banner";

const NAV_ITEMS = [
  { href: "/", label: "Traders", icon: Radar },
  { href: "/wallets", label: "Wallets", icon: Wallet },
  { href: "/profiles", label: "Profiles", icon: Layers },
  { href: "/leaderboard", label: "Leaderboard", icon: Trophy },
  { href: "/blacklisted", label: "Blacklisted", icon: ShieldBan },
  { href: "/rpc", label: "RPC", icon: Router },
  { href: "/proxies", label: "Proxies", icon: Shuffle },
  { href: "/logs", label: "Logs", icon: ScrollText },
  { href: "/settings", label: "Settings", icon: Settings },
];

async function signOut() {
  await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
  // A full load, not router.push: the root layout (signed-in shell) doesn't re-render on client navigation.
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
  window.location.assign("/login");
}

export function AppShell({ username, children }: { username: string; children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <SidebarProvider>
      <Sidebar>
        <SidebarHeader className="gap-0.5 px-3 py-4">
          <div className="flex items-center gap-2 px-1">
            <div className="flex size-8 items-center justify-center rounded-lg bg-primary/15 text-primary">
              <Activity className="size-4" />
            </div>
            <div className="flex flex-col leading-none">
              <span className="text-sm font-semibold tracking-tight">pump.fun tracker</span>
              <span className="text-xs text-muted-foreground">trader intelligence</span>
            </div>
          </div>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>Workspace</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {NAV_ITEMS.map((item) => {
                  const active = pathname === item.href;
                  return (
                    <SidebarMenuItem key={item.href}>
                      <SidebarMenuButton asChild isActive={active} tooltip={item.label}>
                        <Link href={item.href}>
                          <item.icon />
                          <span>{item.label}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton asChild isActive={pathname === "/account"} tooltip={`Account (${username})`}>
                <Link href="/account">
                  <UserRound />
                  <span className="truncate">{username}</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton onClick={signOut} tooltip="Sign out">
                <LogOut />
                <span>Sign out</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
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
        <header className="flex min-h-14 shrink-0 flex-wrap items-center gap-2 border-b border-border/60 px-4 py-2">
          <SidebarTrigger />
          <Separator orientation="vertical" className="h-5" />
          <span className="hidden text-sm text-muted-foreground sm:inline">Real-time pump.fun trader activity</span>
          <div className="ml-auto flex items-center gap-2">
            <OpenTradesBanner />
            <ProfileSwitcher />
          </div>
        </header>
        <div className="flex-1 overflow-auto p-4 md:p-6">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}
