import { ReactNode } from "react";
import { DashboardLegalShell } from "@/components/legal/dashboard-legal-shell";
import { getCurrentPolicyAcceptanceMap } from "@/lib/legal/policy-acceptances";
import { requirePaidUser } from "@/lib/supabase/auth";

export default async function DashboardLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  const { user } = await requirePaidUser();
  const acceptanceMap = await getCurrentPolicyAcceptanceMap(user.id);

  return (
    <DashboardLegalShell needsRiskAcceptance={!acceptanceMap.hasCurrentRisk}>
      {children}
    </DashboardLegalShell>
  );
}
