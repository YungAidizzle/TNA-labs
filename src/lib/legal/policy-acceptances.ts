import "server-only";

import { getSupabaseAuthServerClient } from "@/lib/supabase/auth";
import { getPolicyVersion, type PolicyType } from "@/lib/legal/policy-versions";

export type PolicyAcceptanceRecord = {
  id: string;
  user_id: string;
  policy_type: PolicyType;
  policy_version: string;
  accepted_at: string;
  ip_address: string | null;
  user_agent: string | null;
  context: string | null;
  created_at: string;
};

const POLICY_ACCEPTANCE_COLUMNS =
  "id, user_id, policy_type, policy_version, accepted_at, ip_address, user_agent, context, created_at";

export async function getPolicyAcceptancesForCurrentUser(
  userId: string,
  policyTypes?: PolicyType[],
) {
  const supabase = await getSupabaseAuthServerClient();
  if (!supabase) {
    return [] as PolicyAcceptanceRecord[];
  }

  let query = supabase
    .from("policy_acceptances")
    .select(POLICY_ACCEPTANCE_COLUMNS)
    .eq("user_id", userId)
    .order("accepted_at", { ascending: false });

  if (policyTypes && policyTypes.length > 0) {
    query = query.in("policy_type", policyTypes);
  }

  const { data, error } = await query;

  if (error) {
    console.warn("[legal] policy acceptance lookup failed", {
      userId,
      policyTypes,
      error: error.message,
    });
    return [] as PolicyAcceptanceRecord[];
  }

  return (data as PolicyAcceptanceRecord[] | null) ?? [];
}

export async function getCurrentPolicyAcceptanceMap(userId: string) {
  const records = await getPolicyAcceptancesForCurrentUser(userId);

  const acceptedPolicies = new Set<PolicyType>();
  for (const record of records) {
    if (record.policy_version === getPolicyVersion(record.policy_type)) {
      acceptedPolicies.add(record.policy_type);
    }
  }

  return {
    acceptedPolicies,
    hasCurrentTerms: acceptedPolicies.has("terms"),
    hasCurrentPrivacy: acceptedPolicies.has("privacy"),
    hasCurrentBilling: acceptedPolicies.has("billing"),
    hasCurrentRisk: acceptedPolicies.has("risk"),
  };
}

export async function recordPolicyAcceptance(params: {
  userId: string;
  policyType: PolicyType;
  policyVersion: string;
  context: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}) {
  const supabase = await getSupabaseAuthServerClient();
  if (!supabase) {
    throw new Error("Supabase auth client is not configured.");
  }

  const { data: existing, error: existingError } = await supabase
    .from("policy_acceptances")
    .select("id")
    .eq("user_id", params.userId)
    .eq("policy_type", params.policyType)
    .eq("policy_version", params.policyVersion)
    .eq("context", params.context)
    .limit(1)
    .maybeSingle<{ id: string }>();

  if (existingError) {
    throw existingError;
  }

  if (existing?.id) {
    return existing.id;
  }

  const { data, error } = await supabase
    .from("policy_acceptances")
    .insert({
      user_id: params.userId,
      policy_type: params.policyType,
      policy_version: params.policyVersion,
      context: params.context,
      ip_address: params.ipAddress ?? null,
      user_agent: params.userAgent ?? null,
    })
    .select("id")
    .maybeSingle<{ id: string }>();

  if (error) {
    throw error;
  }

  return data?.id ?? null;
}
