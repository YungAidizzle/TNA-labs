"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useState, useTransition } from "react";
import { useRouteFeedback } from "@/components/navigation/route-feedback-provider";
import { Button } from "@/components/ui/button";
import { InteractiveLink } from "@/components/ui/interactive-link";
import { getSupabaseBrowserClient, hasSupabaseBrowserConfig } from "@/lib/supabase/browser";

function validateEmail(email: string) {
  return /\S+@\S+\.\S+/.test(email);
}

export function SignUpForm() {
  const router = useRouter();
  const { startNavigation } = useRouteFeedback();
  const authConfigured = hasSupabaseBrowserConfig();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [isRouting, startRoutingTransition] = useTransition();
  const pending = submitting || isRouting;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSuccessMessage(null);

    if (!authConfigured) {
      setError(
        "Supabase auth is not configured. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.",
      );
      return;
    }

    if (!validateEmail(email)) {
      setError("Enter a valid email address.");
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

    setSubmitting(true);
    let shouldReset = true;

    try {
      const supabase = getSupabaseBrowserClient();
      const emailRedirectTo =
        typeof window === "undefined"
          ? undefined
          : `${window.location.origin}/sign-in?verified=1`;
      const { data, error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo,
        },
      });

      if (signUpError) {
        setError(signUpError.message);
        return;
      }

      const mode = data.session ? "created" : "check-email";
      setSuccessMessage(
        mode === "check-email"
          ? "Account created. Confirmation email is required before sign-in."
          : "Account created. Opening access setup.",
      );
      startNavigation("Opening access setup");
      startRoutingTransition(() => {
        router.replace(`/onboarding?mode=${mode}&email=${encodeURIComponent(email)}`);
        router.refresh();
      });
      shouldReset = false;
    } finally {
      if (shouldReset) {
        setSubmitting(false);
      }
    }
  }

  return (
    <form className="space-y-5" onSubmit={handleSubmit}>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="metric-card">
          <p className="section-kicker">Account state</p>
          <p className="mt-3 text-[15px] font-semibold tracking-[-0.03em] text-[#eef5ff]">
            Production-style entry
          </p>
          <p className="mt-3 text-[13px] leading-6 text-[#8ca2ba]">
            The form is staged around account creation first, then pricing and paid access.
          </p>
        </div>
        <div className="metric-card">
          <p className="section-kicker">Continuation</p>
          <p className="mt-3 text-[15px] font-semibold tracking-[-0.03em] text-[#eef5ff]">
            Onboarding handoff
          </p>
          <p className="mt-3 text-[13px] leading-6 text-[#8ca2ba]">
            After sign-up, the user moves directly into the next access step instead of stalling on a blank success state.
          </p>
        </div>
      </div>

      <div className="space-y-2">
        <label htmlFor="email" className="field-label">
          Email
        </label>
        <input
          id="email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          disabled={pending}
          aria-invalid={error?.toLowerCase().includes("email") || undefined}
          className="field-input"
          placeholder="operator@desk.com"
        />
      </div>

      <div className="space-y-2">
        <label htmlFor="password" className="field-label">
          Password
        </label>
        <input
          id="password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          disabled={pending}
          aria-invalid={error?.toLowerCase().includes("password") || undefined}
          className="field-input"
          placeholder="Minimum 8 characters"
        />
        <p className="field-note">Use a durable password. Password reset can be layered in separately.</p>
      </div>

      <div className="space-y-2">
        <label htmlFor="confirm-password" className="field-label">
          Confirm password
        </label>
        <input
          id="confirm-password"
          type="password"
          autoComplete="new-password"
          value={confirmPassword}
          onChange={(event) => setConfirmPassword(event.target.value)}
          disabled={pending}
          aria-invalid={error?.toLowerCase().includes("match") || undefined}
          className="field-input"
          placeholder="Repeat password"
        />
      </div>

      {pending ? (
        <div className="status-banner border-cyan/12 bg-cyan/[0.06]" aria-live="polite">
          Provisioning account and preparing the next access step.
        </div>
      ) : null}

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
          Auth is not configured in the environment yet.
        </div>
      ) : null}

      <Button
        type="submit"
        tone="primary"
        size="lg"
        fullWidth
        pending={pending}
        pendingLabel="Creating account"
        disabled={!authConfigured}
      >
        Create account
      </Button>

      <p className="text-[13px] text-[#8ba1b8]">
        Already have an account?{" "}
        <InteractiveLink
          href="/sign-in"
          pendingLabel="Opening sign in"
          navigationLabel="Opening sign in"
          className="text-cyan transition-colors hover:text-[#b8f2ff]"
        >
          Sign in
        </InteractiveLink>
      </p>
    </form>
  );
}
