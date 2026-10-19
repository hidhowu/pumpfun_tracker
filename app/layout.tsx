import type { Metadata } from "next";
import { JetBrains_Mono, Manrope } from "next/font/google";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { AppShell } from "@/components/app-shell";
import { SignedOutGate } from "@/components/auth/signed-out-gate";
import { ProfileProvider } from "@/lib/profile-context";
import { getSessionUser } from "@/lib/auth/session";
import "./globals.css";

const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["latin"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "pump.fun Trader Tracker",
  description: "Real-time tracking of pump.fun trader buy/sell activity.",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // Display only - access control is proxy.ts plus each API route's own check.
  const user = await getSessionUser();
  return (
    <html
      lang="en"
      className={`dark ${manrope.variable} ${jetbrainsMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <TooltipProvider delayDuration={150}>
          {user ? (
            <ProfileProvider>
              <AppShell username={user.username}>{children}</AppShell>
            </ProfileProvider>
          ) : (
            <SignedOutGate>{children}</SignedOutGate>
          )}
          <Toaster theme="dark" position="bottom-right" />
        </TooltipProvider>
      </body>
    </html>
  );
}
