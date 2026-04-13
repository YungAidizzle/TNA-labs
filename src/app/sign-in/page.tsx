import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth/auth-shell";
import { SignInForm } from "@/components/auth/sign-in-form";
import { BRAND_NAME } from "@/lib/brand";
import { buildPageMetadata } from "@/lib/metadata";
import { getCurrentAuthContext } from "@/lib/supabase/auth";
import { resolveSafeRedirectTarget } from "@/lib/supabase/shared";
import { isPaidAccessState } from "@/lib/billing/shared";

export const metadata: Metadata = buildPageMetadata({
  title: "Sign In",
  description:
    "Sign in to Attentra to access your paid narrative research workflow, billing settings, and current account status.",
  path: "/sign-in",
});

type SignInPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function readQueryValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function SignInPage({ searchParams }: SignInPageProps) {
  const params = searchParams ? await searchParams : {};
  const { user, profile } = await getCurrentAuthContext();
  const next = resolveSafeRedirectTarget(readQueryValue(params.next), "/dashboard");

  if (user) {
    redirect(isPaidAccessState(profile?.access_state) ? next : "/pricing");
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
