import type { Metadata } from "next";
import { AuthShell } from "@/components/auth/auth-shell";
import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";
import { BRAND_NAME } from "@/lib/brand";
import { buildPageMetadata } from "@/lib/metadata";

export const metadata: Metadata = buildPageMetadata({
  title: "Reset Password",
  description:
    "Request a secure Attentra password reset email to regain account access without contacting support.",
  path: "/forgot-password",
});

type ForgotPasswordPageProps = {
  searchParams?: Promise<{
    next?: string;
  }>;
};

export default async function ForgotPasswordPage({
  searchParams,
}: ForgotPasswordPageProps) {
  const params = searchParams ? await searchParams : {};
  const nextPath = typeof params.next === "string" ? params.next : null;

  return (
    <AuthShell
      eyebrow="Password recovery"
      title="Reset your password"
      description={`Enter the email address used for ${BRAND_NAME} and we will send a secure reset link.`}
    >
      <ForgotPasswordForm nextPath={nextPath} />
    </AuthShell>
  );
}
