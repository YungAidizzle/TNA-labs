function normalizeSiteOrigin(value: string | undefined) {
  const normalized = value?.trim();
  if (!normalized) {
    return null;
  }

  if (normalized.startsWith("http://") || normalized.startsWith("https://")) {
    return normalized.replace(/\/+$/, "");
  }

  return `https://${normalized.replace(/\/+$/, "")}`;
}

export function getSiteOrigin() {
  return (
    normalizeSiteOrigin(process.env.NEXT_PUBLIC_SITE_URL) ??
    normalizeSiteOrigin(process.env.NEXT_PUBLIC_APP_URL) ??
    normalizeSiteOrigin(process.env.VERCEL_PROJECT_PRODUCTION_URL) ??
    normalizeSiteOrigin(process.env.VERCEL_URL)
  );
}

export function getMetadataBase() {
  const origin = getSiteOrigin();
  return origin ? new URL(origin) : undefined;
}
