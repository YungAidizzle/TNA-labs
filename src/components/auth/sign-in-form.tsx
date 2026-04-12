"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, useMemo, useState } from "react";
import { getSupabaseBrowserClient, hasSupabaseBrowserConfig } from "@/lib/supabase/browser";
import { resolveSafeRedirectTarget } from "@/lib/supabase/shared";

function validateEmail(email: string) {
  return /\S+@\S+\.\S+/.test(email);
}

export function SignInForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const authConfigured = hasSupabaseBrowserConfig();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
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
      setError("Supabase auth is not configured. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.");
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

    setLoading(true);

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
      router.replace(next);
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <form className="space-y-5" onSubmit={handleSubmit}>
      <div className="space-y-2">
        <label htmlFor="email" className="block text-[12px] font-medium uppercase tracking-[0.16em] text-[#8ea4bc]">
          Email
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

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <label htmlFor="password" className="block text-[12px] font-medium uppercase tracking-[0.16em] text-[#8ea4bc]">
            Password
          </label>
          <span className="text-[12px] text-[#6f86a1]">Forgot password coming soon</span>
        </div>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="h-12 w-full border border-white/[0.1] bg-[#07101a] px-4 text-[15px] text-[#eef5ff] outline-none transition-colors placeholder:text-[#5f748d] focus:border-cyan/35"
          placeholder="Enter password"
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
          Auth is not configured in the environment yet.
        </div>
      ) : null}

      <button
        type="submit"
        disabled={loading || !authConfigured}
        className="inline-flex h-12 w-full items-center justify-center border border-cyan/25 bg-[linear-gradient(180deg,rgba(14,44,57,0.95),rgba(6,17,23,0.96))] px-5 text-[12px] font-semibold uppercase tracking-[0.16em] text-[#effdff] transition-opacity disabled:cursor-not-allowed disabled:opacity-60"
      >
        {loading ? "Signing in..." : "Sign in"}
      </button>

      <p className="text-[13px] text-[#8ba1b8]">
        Need an account?{" "}
        <Link href="/sign-up" className="text-cyan hover:text-[#b8f2ff]">
          Create one
        </Link>
      </p>
    </form>
  );
}
