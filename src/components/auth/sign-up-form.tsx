"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { getSupabaseBrowserClient, hasSupabaseBrowserConfig } from "@/lib/supabase/browser";

function validateEmail(email: string) {
  return /\S+@\S+\.\S+/.test(email);
}

export function SignUpForm() {
  const router = useRouter();
  const authConfigured = hasSupabaseBrowserConfig();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSuccessMessage(null);

    if (!authConfigured) {
      setError("Supabase auth is not configured. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.");
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

    setLoading(true);

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

      setSuccessMessage("Account created. Preparing access setup.");
      const mode = data.session ? "created" : "check-email";
      router.replace(`/onboarding?mode=${mode}&email=${encodeURIComponent(email)}`);
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
        <label htmlFor="password" className="block text-[12px] font-medium uppercase tracking-[0.16em] text-[#8ea4bc]">
          Password
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
        {loading ? "Creating account..." : "Create account"}
      </button>

      <p className="text-[13px] text-[#8ba1b8]">
        Already have an account?{" "}
        <Link href="/sign-in" className="text-cyan hover:text-[#b8f2ff]">
          Sign in
        </Link>
      </p>
    </form>
  );
}
