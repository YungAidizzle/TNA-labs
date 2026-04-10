import { ReactNode } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { requirePaidUser } from "@/lib/supabase/auth";

export default async function DashboardLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  await requirePaidUser();
  return <AppShell>{children}</AppShell>;
}
