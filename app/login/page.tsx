import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { LoginForm } from "@/components/auth/login-form";

export const metadata: Metadata = { title: "Sign in · pump.fun Trader Tracker" };

export default async function LoginPage() {
  if (await getSessionUser()) redirect("/");
  return <LoginForm />;
}
