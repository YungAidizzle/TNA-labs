/*
  TODO(founder): replace the fallback values below with the actual operating entity,
  support inboxes, and service address before broad commercial rollout.
*/

function readPublicValue(value: string | undefined, fallback: string) {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : fallback;
}

export const LEGAL_CONTACT = {
  serviceName: readPublicValue(process.env.NEXT_PUBLIC_SERVICE_NAME, "Narrative To Asset"),
  companyLegalName: readPublicValue(
    process.env.NEXT_PUBLIC_COMPANY_LEGAL_NAME,
    "Narrative To Asset",
  ),
  supportEmail: readPublicValue(process.env.NEXT_PUBLIC_SUPPORT_EMAIL, "contact@example.com"),
  billingSupportEmail: readPublicValue(
    process.env.NEXT_PUBLIC_BILLING_SUPPORT_EMAIL,
    "contact@example.com",
  ),
  legalEmail: readPublicValue(process.env.NEXT_PUBLIC_LEGAL_EMAIL, "contact@example.com"),
  serviceAddress: readPublicValue(
    process.env.NEXT_PUBLIC_SERVICE_ADDRESS,
    "Australia-based service address pending founder confirmation",
  ),
} as const;
