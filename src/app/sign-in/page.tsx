import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth/auth-shell";
import { SignInForm } from "@/components/auth/sign-in-form";
import { BRAND_NAME } from "@/lib/brand";
import { getCurrentAuthContext } from "@/lib/supabase/auth";
import { isPaidAccessState } from "@/lib/billing/shared";

export default async function SignInPage() {
  const { user, profile } = await getCurrentAuthContext();

  if (user) {
    redirect(isPaidAccessState(profile?.access_state) ? "/dashboard" : "/pricing");
  }

  return (
    <AuthShell
      eyebrow="Account access"
      title="Sign in"
      description={`Access ${BRAND_NAME}, linked asset views, and validation workflows from one account.`}
    >
      <SignInForm />
    </AuthShell>
  );
}
