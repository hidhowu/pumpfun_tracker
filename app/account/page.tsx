import { redirect } from "next/navigation";
import { UserRound } from "lucide-react";
import { getSessionUser } from "@/lib/auth/session";
import { ChangePasswordForm } from "@/components/auth/change-password-form";
import { TwoFactorCard } from "@/components/auth/two-factor-card";
import { DialogIcon } from "@/components/ui/dialog-parts";

export default async function AccountPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  return (
    <div className="mx-auto flex w-full min-w-0 max-w-[760px] flex-col gap-4 pb-16 md:gap-6">
      <div className="flex min-w-0 items-center gap-3">
        <DialogIcon>
          <UserRound className="size-5" />
        </DialogIcon>
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="text-[22px] leading-7 font-semibold tracking-[-0.02em] md:text-[28px] md:leading-[34px] md:tracking-[-0.025em]">Account</h1>
          <p className="text-sm text-text-2">
            Signed in as <b className="font-semibold text-foreground">{user.username}</b>. Accounts are created and reset from the server shell - see <code className="font-mono text-xs">npm run user</code>.
          </p>
        </div>
      </div>
      <TwoFactorCard />
      <ChangePasswordForm username={user.username} />
    </div>
  );
}
