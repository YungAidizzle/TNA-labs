const PROTECTED_PATH_PREFIXES = [
  "/dashboard",
  "/overview",
  "/trends",
  "/settings",
] as const;

export function isProtectedPathname(pathname: string) {
  return PROTECTED_PATH_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export function buildAuthRedirectPath(pathname: string, search = "") {
  const next = `${pathname}${search}`.trim();
  if (!next || next === "/") {
    return "/sign-in";
  }

  return `/sign-in?next=${encodeURIComponent(next)}`;
}

export function resolveSafeRedirectTarget(
  value: string | null | undefined,
  fallback = "/dashboard",
) {
  if (!value) {
    return fallback;
  }

  if (!value.startsWith("/") || value.startsWith("//")) {
    return fallback;
  }

  return value;
}
