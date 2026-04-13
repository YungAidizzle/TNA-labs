import type { Metadata } from "next";
import { AuthShell } from "@/components/auth/auth-shell";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";
import { BRAND_NAME } from "@/lib/brand";
import { buildPageMetadata } from "@/lib/metadata";

export const metadata: Metadata = buildPageMetadata({
  title: "Choose New Password",
  description:
    "Set a new Attentra password after opening the secure recovery link from your email.",
  path: "/reset-password",
  robots: {
    index: false,
    follow: false,
  },
});

type ResetPasswordPageProps = {
  searchParams?: Promise<{
    next?: string;
    error?: string;
  }>;
};

export default async function ResetPasswordPage({
  searchParams,
}: ResetPasswordPageProps) {
  const params = searchParams ? await searchParams : {};
  const nextPath = typeof params.next === "string" ? params.next : null;
  const initialErrorCode = typeof params.error === "string" ? params.error : null;

  return (
    <AuthShell
      eyebrow="Password recovery"
      title="Choose a new password"
      description={`Open the secure recovery link from your email, then set a new password for ${BRAND_NAME}.`}
    >
      <ResetPasswordForm nextPath={nextPath} initialErrorCode={initialErrorCode} />
    </AuthShell>
  );
}
