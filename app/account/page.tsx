import { redirect } from "next/navigation";
import { UserRound } from "lucide-react";
import { getSessionUser } from "@/lib/auth/session";
import { ChangePasswordForm } from "@/components/auth/change-password-form";

export default async function AccountPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 pb-16">
      <div className="flex min-w-0 items-center gap-2">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
          <UserRound className="size-4.5" />
        </div>
        <div className="min-w-0">
          <h1 className="text-lg font-semibold tracking-tight">Account</h1>
          <p className="text-sm text-muted-foreground">
            Signed in as <span className="font-medium text-foreground">{user.username}</span>. Accounts are created and
            reset from the server shell - see <code className="font-mono text-xs">npm run user</code>.
          </p>
        </div>
      </div>
      <ChangePasswordForm username={user.username} />
    </div>
  );
}
