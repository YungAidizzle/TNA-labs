import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
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
  const requestHeaders = new Headers(request.headers);
  const pathname = request.nextUrl.pathname;
  const isProtectedPath = isProtectedPathname(pathname);
  const isAuthPath = AUTH_PATHS.has(pathname);

  requestHeaders.set("x-attentra-pathname", pathname);
  requestHeaders.set("x-attentra-search", request.nextUrl.search);

  if (!config) {
    return NextResponse.next({
      request: {
        headers: requestHeaders,
      },
    });
  }

  const response = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });

  if (!isProtectedPath && !isAuthPath) {
    return response;
  }

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

  if (isProtectedPath && !user) {
    const url = request.nextUrl.clone();
    url.pathname = "/sign-in";
    url.search = "";
    url.searchParams.set(
      "next",
      resolveSafeRedirectTarget(`${pathname}${request.nextUrl.search}`, "/dashboard"),
    );
    return NextResponse.redirect(url);
  }

  if (isAuthPath && user) {
    const next = request.nextUrl.searchParams.get("next");
    return NextResponse.redirect(
      new URL(resolveSafeRedirectTarget(next, "/dashboard"), request.url),
    );
  }

  return response;
}
