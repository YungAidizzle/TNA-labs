"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { getSupabaseBrowserClient, hasSupabaseBrowserConfig } from "@/lib/supabase/browser";

function validateEmail(email: string) {
  return /\S+@\S+\.\S+/.test(email);
}

type ForgotPasswordFormProps = {
  nextPath?: string | null;
};

export function ForgotPasswordForm({ nextPath = null }: ForgotPasswordFormProps) {
  const authConfigured = hasSupabaseBrowserConfig();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const next = nextPath?.trim() ? nextPath : null;
  const signInHref = next ? `/sign-in?next=${encodeURIComponent(next)}` : "/sign-in";

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSuccessMessage(null);

    if (!authConfigured) {
      setError("Password recovery is not available in this deployment yet.");
      return;
    }

    if (!validateEmail(email)) {
      setError("Enter a valid email address.");
      return;
    }

    setLoading(true);

    try {
      const supabase = getSupabaseBrowserClient();
      const recoveryPath = next
        ? `/reset-password?next=${encodeURIComponent(next)}`
        : "/reset-password";
      const redirectTo =
        typeof window === "undefined"
          ? undefined
          : `${window.location.origin}/auth/confirm?next=${encodeURIComponent(recoveryPath)}`;
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo,
      });

      if (resetError) {
        setError(resetError.message);
        return;
      }

      setSuccessMessage(
        "If an account exists for that email, a secure password reset link has been sent.",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <form className="space-y-5" onSubmit={handleSubmit}>
      <div className="space-y-2">
        <label htmlFor="email" className="block text-[12px] font-medium uppercase tracking-[0.16em] text-[#8ea4bc]">
          Account email
        </label>
        <input
          id="email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="h-12 w-full border border-white/[0.1] bg-[#07101a] px-4 text-[15px] text-[#eef5ff] outline-none transition-colors placeholder:text-[#5f748d] focus:border-cyan/35"
          placeholder="operator@desk.com"
        />
      </div>

      {successMessage ? (
        <div className="border border-emerald/20 bg-emerald/10 px-4 py-3 text-[13px] text-emerald">
          {successMessage}
        </div>
      ) : null}

      {error ? (
        <div className="border border-rose/20 bg-rose/10 px-4 py-3 text-[13px] text-[#ff9b9b]">
          {error}
        </div>
      ) : null}

      {!authConfigured ? (
        <div className="border border-amber/20 bg-amber/10 px-4 py-3 text-[13px] text-[#f7c27b]">
          Password recovery is not available in this deployment yet.
        </div>
      ) : null}

      <button
        type="submit"
        disabled={loading || !authConfigured}
        className="inline-flex h-12 w-full items-center justify-center border border-cyan/25 bg-[linear-gradient(180deg,rgba(14,44,57,0.95),rgba(6,17,23,0.96))] px-5 text-[12px] font-semibold uppercase tracking-[0.16em] text-[#effdff] transition-opacity disabled:cursor-not-allowed disabled:opacity-60"
      >
        {loading ? "Sending reset link..." : "Send reset link"}
      </button>

      <p className="text-[13px] text-[#8ba1b8]">
        Remembered your password?{" "}
        <Link href={signInHref} className="text-cyan hover:text-[#b8f2ff]">
          Return to sign in
        </Link>
      </p>
    </form>
  );
}
