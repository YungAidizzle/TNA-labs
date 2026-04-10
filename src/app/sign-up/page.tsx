import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth/auth-shell";
import { SignUpForm } from "@/components/auth/sign-up-form";
import { getCurrentAuthContext } from "@/lib/supabase/auth";
import { isPaidAccessState } from "@/lib/billing/shared";

export default async function SignUpPage() {
  const { user, profile } = await getCurrentAuthContext();

  if (user) {
    redirect(isPaidAccessState(profile?.access_state) ? "/dashboard" : "/pricing");
  }

  return (
    <AuthShell
      eyebrow="Create account"
      title="Get access"
      description="Create an account now. Subscription activation is staged next, but the access flow and account structure are already in place."
    >
      <SignUpForm />
    </AuthShell>
  );
}
