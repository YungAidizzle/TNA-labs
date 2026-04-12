import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { hasDashboardAccessState } from "@/lib/billing/shared";
import {
  isProtectedPathname,
  resolveSafeRedirectTarget,
} from "@/lib/supabase/shared";

const AUTH_PATHS = new Set<string>(["/sign-in", "/sign-up"]);

function getSupabaseAuthConfig() {
  const url = (process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
  const anonKey = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "").trim();

  if (!url || !anonKey) {
    return null;
  }

  return { url, anonKey };
}

export async function updateSession(request: NextRequest) {
  const config = getSupabaseAuthConfig();

  if (!config) {
    return NextResponse.next({ request });
  }

  let response = NextResponse.next({ request });
  const supabase = createServerClient(config.url, config.anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => {
          request.cookies.set(name, value);
          response.cookies.set(name, value, options);
        });
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;
  let profile: { access_state: string | null } | null = null;

  if (user) {
    try {
      const result = await supabase
        .from("profiles")
        .select("access_state")
        .eq("id", user.id)
        .maybeSingle<{ access_state: string | null }>();
      profile = result.data ?? null;
    } catch {
      profile = null;
    }
  }

  if (isProtectedPathname(pathname) && !user) {
    const url = request.nextUrl.clone();
    url.pathname = "/sign-in";
    url.search = "";
    url.searchParams.set(
      "next",
      resolveSafeRedirectTarget(`${pathname}${request.nextUrl.search}`, "/dashboard"),
    );
    return NextResponse.redirect(url);
  }

  if (isProtectedPathname(pathname) && user && !profile) {
    const url = request.nextUrl.clone();
    url.pathname = "/onboarding";
    url.search = "";
    return NextResponse.redirect(url);
  }

  if (
    isProtectedPathname(pathname) &&
    user &&
    profile &&
    !hasDashboardAccessState(profile.access_state)
  ) {
    const url = request.nextUrl.clone();
    url.pathname = "/pricing";
    url.search = "";
    url.searchParams.set(
      "next",
      resolveSafeRedirectTarget(`${pathname}${request.nextUrl.search}`, "/dashboard"),
    );
    return NextResponse.redirect(url);
  }

  if (AUTH_PATHS.has(pathname) && user) {
    const next = request.nextUrl.searchParams.get("next");
    const fallback =
      profile && hasDashboardAccessState(profile.access_state) ? "/dashboard" : "/pricing";
    return NextResponse.redirect(new URL(resolveSafeRedirectTarget(next, fallback), request.url));
  }

  return response;
}
