import "server-only";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import type { User } from "@supabase/supabase-js";
import {
  isPaidAccessState,
  type AppOnboardingState,
  type ProfileAccessState,
} from "@/lib/billing/shared";

export type AppProfile = {
  id: string;
  email: string | null;
  full_name: string | null;
  avatar_url: string | null;
  stripe_customer_id: string | null;
  access_state: ProfileAccessState;
  onboarding_state: AppOnboardingState | null;
  created_at: string;
  updated_at: string;
};

function getSupabaseAuthConfig() {
  const url = (process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
  const anonKey = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "").trim();

  if (!url || !anonKey) {
    return null;
  }

  return { url, anonKey };
}

export function hasSupabaseAuthConfig() {
  return Boolean(getSupabaseAuthConfig());
}

export async function getSupabaseAuthServerClient() {
  const cookieStore = await cookies();
  const config = getSupabaseAuthConfig();

  if (!config) {
    return null;
  }

  return createServerClient(config.url, config.anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // Server components cannot always mutate cookies. Middleware covers refresh persistence.
        }
      },
    },
  });
}

export async function getCurrentUser() {
  const supabase = await getSupabaseAuthServerClient();
  if (!supabase) {
    return null;
  }
  const { data, error } = await supabase.auth.getUser();

  if (error) {
    return null;
  }

  return data.user ?? null;
}

export async function getCurrentProfile(user: User | null) {
  if (!user) {
    return null;
  }

  const supabase = await getSupabaseAuthServerClient();
  if (!supabase) {
    return null;
  }
  const { data, error } = await supabase
    .from("profiles")
    .select("id, email, full_name, avatar_url, stripe_customer_id, access_state, onboarding_state, created_at, updated_at")
    .eq("id", user.id)
    .maybeSingle<AppProfile>();

  if (error) {
    return null;
  }

  return data ?? null;
}

export async function getCurrentAuthContext() {
  const user = await getCurrentUser();
  const profile = await getCurrentProfile(user);

  return {
    user,
    profile,
  };
}

export async function requireAuthenticatedUser() {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/sign-in");
  }

  return user;
}

export async function requirePaidUser() {
  const user = await requireAuthenticatedUser();
  const profile = await getCurrentProfile(user);

  if (!profile || !isPaidAccessState(profile.access_state)) {
    redirect("/pricing");
  }

  return {
    user,
    profile,
  };
}

export async function requireApiUser() {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json(
      {
        error: {
          code: "UNAUTHORIZED",
          message: "Authentication required.",
        },
      },
      { status: 401 },
    );
  }

  return user;
}

export async function requirePaidApiUser() {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json(
      {
        error: {
          code: "UNAUTHORIZED",
          message: "Authentication required.",
        },
      },
      { status: 401 },
    );
  }

  const profile = await getCurrentProfile(user);
  if (!profile || !isPaidAccessState(profile.access_state)) {
    return NextResponse.json(
      {
        error: {
          code: "SUBSCRIPTION_REQUIRED",
          message: "An active subscription is required.",
        },
      },
      { status: 402 },
    );
  }

  return {
    user,
    profile,
  };
}
