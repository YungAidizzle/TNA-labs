export const EFFECTIVE_DATE = "2026-04-12";

export const TERMS_VERSION = "2026-04-12.1";
export const PRIVACY_VERSION = "2026-04-12.1";
export const RISK_VERSION = "2026-04-12.1";
export const BILLING_VERSION = "2026-04-12.1";

export const POLICY_VERSIONS = {
  terms: TERMS_VERSION,
  privacy: PRIVACY_VERSION,
  risk: RISK_VERSION,
  billing: BILLING_VERSION,
} as const;

export type PolicyType = keyof typeof POLICY_VERSIONS;

export const POLICY_LABELS: Record<PolicyType, string> = {
  terms: "Terms of Service",
  privacy: "Privacy Policy",
  risk: "Risk Disclosure",
  billing: "Billing and Renewal Disclosure",
};

export function getPolicyVersion(policyType: PolicyType) {
  return POLICY_VERSIONS[policyType];
}
