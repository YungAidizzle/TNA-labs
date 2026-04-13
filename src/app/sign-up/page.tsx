import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth/auth-shell";
import { SignUpForm } from "@/components/auth/sign-up-form";
import { BRAND_NAME } from "@/lib/brand";
import { buildPageMetadata } from "@/lib/metadata";
import { getCurrentAuthContext } from "@/lib/supabase/auth";
import { resolveSafeRedirectTarget } from "@/lib/supabase/shared";
import { isPaidAccessState } from "@/lib/billing/shared";

export const metadata: Metadata = buildPageMetadata({
  title: "Create Account",
  description:
    "Create your Attentra account, accept the current legal terms, and continue into subscription checkout or live access.",
  path: "/sign-up",
});

type SignUpPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function readQueryValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function SignUpPage({ searchParams }: SignUpPageProps) {
  const params = searchParams ? await searchParams : {};
  const { user, profile } = await getCurrentAuthContext();
  const next = resolveSafeRedirectTarget(readQueryValue(params.next), "/dashboard");

  if (user) {
    redirect(isPaidAccessState(profile?.access_state) ? next : "/pricing");
  }

  return (
    <AuthShell
      eyebrow="Create account"
      title="Get access"
      description={`Create an account to continue into ${BRAND_NAME}. Terms and privacy acceptance are required before access can be activated.`}
    >
      <SignUpForm />
    </AuthShell>
  );
}
