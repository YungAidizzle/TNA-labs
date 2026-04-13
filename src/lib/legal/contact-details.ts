import { BRAND_NAME } from "@/lib/brand";

function readPublicValue(value: string | undefined) {
  const normalized = value?.trim();
  if (!normalized || normalized.length === 0) {
    return null;
  }

  const lower = normalized.toLowerCase();
  if (
    lower.includes("example.com") ||
    lower.includes("pending founder confirmation") ||
    lower.includes("contact@example.com") ||
    lower.includes("todo") ||
    lower.includes("placeholder") ||
    lower.includes("tbd")
  ) {
    return null;
  }

  return normalized;
}

function readPublicEmail(value: string | undefined) {
  const normalized = readPublicValue(value)?.toLowerCase() ?? null;
  if (!normalized) {
    return null;
  }

  return /\S+@\S+\.\S+/.test(normalized) ? normalized : null;
}

export const LEGAL_CONTACT_REQUIREMENTS = [
  "NEXT_PUBLIC_COMPANY_LEGAL_NAME",
  "NEXT_PUBLIC_SUPPORT_EMAIL",
  "NEXT_PUBLIC_BILLING_SUPPORT_EMAIL",
  "NEXT_PUBLIC_LEGAL_EMAIL",
  "NEXT_PUBLIC_SERVICE_ADDRESS",
] as const;

export const LEGAL_CONTACT = {
  serviceName: readPublicValue(process.env.NEXT_PUBLIC_SERVICE_NAME) ?? BRAND_NAME,
  companyLegalName: readPublicValue(process.env.NEXT_PUBLIC_COMPANY_LEGAL_NAME),
  supportEmail: readPublicEmail(process.env.NEXT_PUBLIC_SUPPORT_EMAIL),
  billingSupportEmail: readPublicEmail(process.env.NEXT_PUBLIC_BILLING_SUPPORT_EMAIL),
  legalEmail: readPublicEmail(process.env.NEXT_PUBLIC_LEGAL_EMAIL),
  serviceAddress: readPublicValue(process.env.NEXT_PUBLIC_SERVICE_ADDRESS),
} as const;

export const LEGAL_CONTACT_MISSING_FIELDS = LEGAL_CONTACT_REQUIREMENTS.filter((key) => {
  const value = process.env[key];
  return !readPublicValue(value);
});

export function getPublicCompanyReference() {
  return LEGAL_CONTACT.companyLegalName ?? LEGAL_CONTACT.serviceName;
}

export function getSupportContactHref(
  kind: "support" | "billing" | "legal" = "support",
) {
  const email =
    kind === "billing"
      ? LEGAL_CONTACT.billingSupportEmail
      : kind === "legal"
        ? LEGAL_CONTACT.legalEmail
        : LEGAL_CONTACT.supportEmail;

  return email ? `mailto:${email}` : null;
}

export function getSupportContactLabel(
  kind: "support" | "billing" | "legal" = "support",
) {
  const email =
    kind === "billing"
      ? LEGAL_CONTACT.billingSupportEmail
      : kind === "legal"
        ? LEGAL_CONTACT.legalEmail
        : LEGAL_CONTACT.supportEmail;

  if (email) {
    return email;
  }

  if (kind === "billing") {
    return "Billing support is handled through the customer portal and account support.";
  }

  if (kind === "legal") {
    return "Legal notices are handled through the account support channel.";
  }

  return "Support is provided through the authenticated product experience.";
}

export function getLegalContactFooterLines() {
  const lines = [
    [getPublicCompanyReference(), LEGAL_CONTACT.serviceAddress].filter(Boolean).join(" | "),
    LEGAL_CONTACT.supportEmail ? `Support: ${LEGAL_CONTACT.supportEmail}` : null,
    LEGAL_CONTACT.billingSupportEmail ? `Billing: ${LEGAL_CONTACT.billingSupportEmail}` : null,
    LEGAL_CONTACT.legalEmail ? `Legal: ${LEGAL_CONTACT.legalEmail}` : null,
  ].filter((value): value is string => Boolean(value));

  if (lines.length > 0) {
    return lines;
  }

  return [
    "Support, billing, and legal contact channels are provided through the authenticated product experience.",
  ];
}

export function getPrivacyContactSentence() {
  const contacts = [LEGAL_CONTACT.legalEmail, LEGAL_CONTACT.supportEmail].filter(
    (value): value is string => Boolean(value),
  );

  if (contacts.length > 0) {
    return `Privacy requests can be sent to ${contacts.join(" or ")}.`;
  }

  return "Privacy requests are handled through the authenticated account support channel.";
}

export function getComplaintsContactSentence() {
  if (LEGAL_CONTACT.legalEmail) {
    return `Please contact us first at ${LEGAL_CONTACT.legalEmail} so we can investigate and respond.`;
  }

  if (LEGAL_CONTACT.supportEmail) {
    return `Please contact us first at ${LEGAL_CONTACT.supportEmail} so we can investigate and respond.`;
  }

  return "Please contact us through the authenticated account support channel first so we can investigate and respond.";
}

export function getBillingSupportSentence() {
  if (LEGAL_CONTACT.billingSupportEmail) {
    return `Billing support requests can be sent to ${LEGAL_CONTACT.billingSupportEmail}.`;
  }

  return "Billing support is handled through the Stripe customer portal and authenticated account support.";
}
