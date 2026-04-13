"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { getSupabaseBrowserClient, hasSupabaseBrowserConfig } from "@/lib/supabase/browser";

type RecoveryState = "checking" | "ready" | "invalid";

type ResetPasswordFormProps = {
  nextPath?: string | null;
  initialErrorCode?: string | null;
};

export function ResetPasswordForm({
  nextPath = null,
  initialErrorCode = null,
}: ResetPasswordFormProps) {
  const router = useRouter();
  const authConfigured = hasSupabaseBrowserConfig();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [recoveryState, setRecoveryState] = useState<RecoveryState>("checking");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const next = nextPath?.trim() ? nextPath : null;
  const signInHref = next
    ? `/sign-in?next=${encodeURIComponent(next)}`
    : "/sign-in";
  const forgotPasswordHref = next
    ? `/forgot-password?next=${encodeURIComponent(next)}`
    : "/forgot-password";
  const queryError = useMemo(() => {
    if (initialErrorCode === "invalid_link") {
      return "This reset link is missing, expired, or has already been used.";
    }

    if (initialErrorCode === "auth_not_configured") {
      return "Auth is not configured in this environment.";
    }

    return null;
  }, [initialErrorCode]);

  useEffect(() => {
    if (!authConfigured) {
      setRecoveryState("invalid");
      if (!error) {
        setError("Password recovery is not available in this deployment yet.");
      }
      return;
    }

    let isMounted = true;
    const supabase = getSupabaseBrowserClient();
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (!isMounted) {
        return;
      }

      if (event === "PASSWORD_RECOVERY" || Boolean(session)) {
        setRecoveryState("ready");
        setError((current) => current ?? null);
      }
    });

    void supabase.auth.getSession().then(({ data, error: sessionError }) => {
      if (!isMounted) {
        return;
      }

      if (sessionError) {
        setError(sessionError.message);
        setRecoveryState("invalid");
        return;
      }

      setRecoveryState(data.session ? "ready" : "invalid");
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, [authConfigured, error]);

  useEffect(() => {
    if (queryError) {
      setError(queryError);
    }
  }, [queryError]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (!authConfigured) {
      setError("Password recovery is not available in this deployment yet.");
      return;
    }

    if (recoveryState !== "ready") {
      setError("Open the reset link from your email to continue.");
      return;
    }

    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);

    try {
      const supabase = getSupabaseBrowserClient();
      const { error: updateError } = await supabase.auth.updateUser({ password });

      if (updateError) {
        setError(updateError.message);
        return;
      }

      await supabase.auth.signOut();
      const nextHref = next
        ? `/sign-in?reset=1&next=${encodeURIComponent(next)}`
        : "/sign-in?reset=1";
      router.replace(nextHref);
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  if (recoveryState === "checking") {
    return (
      <div className="space-y-4">
        <div className="border border-white/[0.08] bg-white/[0.03] px-4 py-4 text-[13px] leading-6 text-[#9cb0c7]">
          Validating your secure reset link.
        </div>
      </div>
    );
  }

  if (recoveryState === "invalid") {
    return (
      <div className="space-y-5">
        <div className="border border-amber/20 bg-amber/10 px-4 py-4 text-[13px] leading-6 text-[#f7c27b]">
          {error ?? "This password reset link is no longer valid."}
        </div>
        <div className="flex flex-wrap gap-3">
          <Link
            href={forgotPasswordHref}
            className="inline-flex h-11 items-center border border-cyan/25 bg-[linear-gradient(180deg,rgba(14,44,57,0.95),rgba(6,17,23,0.96))] px-5 text-[12px] font-semibold uppercase tracking-[0.16em] text-[#effdff]"
          >
            Request a new reset link
          </Link>
          <Link
            href={signInHref}
            className="inline-flex h-11 items-center border border-white/[0.1] bg-white/[0.02] px-5 text-[12px] font-medium uppercase tracking-[0.16em] text-[#d6e0ee]"
          >
            Return to sign in
          </Link>
        </div>
      </div>
    );
  }

  return (
    <form className="space-y-5" onSubmit={handleSubmit}>
      <div className="space-y-2">
        <label htmlFor="password" className="block text-[12px] font-medium uppercase tracking-[0.16em] text-[#8ea4bc]">
          New password
        </label>
        <input
          id="password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="h-12 w-full border border-white/[0.1] bg-[#07101a] px-4 text-[15px] text-[#eef5ff] outline-none transition-colors placeholder:text-[#5f748d] focus:border-cyan/35"
          placeholder="Minimum 8 characters"
        />
      </div>

      <div className="space-y-2">
        <label htmlFor="confirm-password" className="block text-[12px] font-medium uppercase tracking-[0.16em] text-[#8ea4bc]">
          Confirm password
        </label>
        <input
          id="confirm-password"
          type="password"
          autoComplete="new-password"
          value={confirmPassword}
          onChange={(event) => setConfirmPassword(event.target.value)}
          className="h-12 w-full border border-white/[0.1] bg-[#07101a] px-4 text-[15px] text-[#eef5ff] outline-none transition-colors placeholder:text-[#5f748d] focus:border-cyan/35"
          placeholder="Repeat password"
        />
      </div>

      {error ? (
        <div className="border border-rose/20 bg-rose/10 px-4 py-3 text-[13px] text-[#ff9b9b]">
          {error}
        </div>
      ) : null}

      <button
        type="submit"
        disabled={loading}
        className="inline-flex h-12 w-full items-center justify-center border border-cyan/25 bg-[linear-gradient(180deg,rgba(14,44,57,0.95),rgba(6,17,23,0.96))] px-5 text-[12px] font-semibold uppercase tracking-[0.16em] text-[#effdff] transition-opacity disabled:cursor-not-allowed disabled:opacity-60"
      >
        {loading ? "Updating password..." : "Update password"}
      </button>

      <p className="text-[13px] text-[#8ba1b8]">
        Need a new email?{" "}
        <Link href={forgotPasswordHref} className="text-cyan hover:text-[#b8f2ff]">
          Request another reset link
        </Link>
      </p>
    </form>
  );
}
