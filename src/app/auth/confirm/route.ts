import { type NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import type { EmailOtpType } from "@supabase/supabase-js";
import { resolveSafeRedirectTarget } from "@/lib/supabase/shared";

function getSupabaseAuthConfig() {
  const url = (process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
  const anonKey = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "").trim();

  if (!url || !anonKey) {
    return null;
  }

  return { url, anonKey };
}

export async function GET(request: NextRequest) {
  const next = resolveSafeRedirectTarget(request.nextUrl.searchParams.get("next"), "/sign-in");
  const redirectUrl = new URL(next, request.url);
  const config = getSupabaseAuthConfig();

  if (!config) {
    redirectUrl.searchParams.set("error", "auth_not_configured");
    return NextResponse.redirect(redirectUrl);
  }

  const response = NextResponse.redirect(redirectUrl);
  const supabase = createServerClient(config.url, config.anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
      },
    },
  });

  const code = request.nextUrl.searchParams.get("code");
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      redirectUrl.searchParams.set("error", "invalid_link");
      return NextResponse.redirect(redirectUrl);
    }

    return response;
  }

  const tokenHash = request.nextUrl.searchParams.get("token_hash");
  const type = request.nextUrl.searchParams.get("type") as EmailOtpType | null;
  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type,
    });
    if (error) {
      redirectUrl.searchParams.set("error", "invalid_link");
      return NextResponse.redirect(redirectUrl);
    }

    return response;
  }

  redirectUrl.searchParams.set("error", "invalid_link");
  return NextResponse.redirect(redirectUrl);
}
