"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, useMemo, useState, useTransition } from "react";
import { useRouteFeedback } from "@/components/navigation/route-feedback-provider";
import { Button } from "@/components/ui/button";
import { InteractiveLink } from "@/components/ui/interactive-link";
import { getSupabaseBrowserClient, hasSupabaseBrowserConfig } from "@/lib/supabase/browser";
import { resolveSafeRedirectTarget } from "@/lib/supabase/shared";

function validateEmail(email: string) {
  return /\S+@\S+\.\S+/.test(email);
}

export function SignInForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { startNavigation } = useRouteFeedback();
  const authConfigured = hasSupabaseBrowserConfig();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [isRouting, startRoutingTransition] = useTransition();
  const pending = submitting || isRouting;
  const successMessage = useMemo(() => {
    if (searchParams.get("verified") === "1") {
      return "Email confirmed. Sign in to continue.";
    }

    return null;
  }, [searchParams]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (!authConfigured) {
      setError("Account access is temporarily unavailable.");
      return;
    }

    if (!validateEmail(email)) {
      setError("Enter a valid email address.");
      return;
    }

    if (!password) {
      setError("Enter your password.");
      return;
    }

    setSubmitting(true);
    let shouldReset = true;

    try {
      const supabase = getSupabaseBrowserClient();
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (signInError) {
        setError(signInError.message);
        return;
      }

      const next = resolveSafeRedirectTarget(searchParams.get("next"), "/dashboard");
      startNavigation("Opening operator workspace");
      startRoutingTransition(() => {
        router.replace(next);
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
      <div className="status-banner border-cyan/12 bg-cyan/[0.06]">
        Use the account attached to your membership. If access is already active, you will go
        straight to the terminal after sign-in.
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
        <div className="flex items-center justify-between gap-3">
          <label htmlFor="password" className="field-label">
            Password
          </label>
          <span className="field-note">Use the password tied to this account</span>
        </div>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          disabled={pending}
          aria-invalid={error?.toLowerCase().includes("password") || undefined}
          className="field-input"
          placeholder="Enter password"
        />
      </div>

      {pending ? (
        <div className="status-banner border-cyan/12 bg-cyan/[0.06]" aria-live="polite">
          Validating credentials and loading the next surface.
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
          Account access is temporarily unavailable right now. Please try again shortly.
        </div>
      ) : null}

      <Button
        type="submit"
        tone="primary"
        size="lg"
        fullWidth
        pending={pending}
        pendingLabel="Signing in"
        disabled={!authConfigured}
      >
        Sign in
      </Button>

      <p className="text-[13px] text-[#8ba1b8]">
        Need an account?{" "}
        <InteractiveLink
          href="/sign-up"
          pendingLabel="Opening account setup"
          navigationLabel="Opening account setup"
          className="text-cyan transition-colors hover:text-[#b8f2ff]"
        >
          Create one
        </InteractiveLink>
      </p>
    </form>
  );
}
