import { NextResponse } from "next/server";
import { getCurrentAuthContext } from "@/lib/supabase/auth";
import { recordPolicyAcceptance } from "@/lib/legal/policy-acceptances";
import { getPolicyVersion, type PolicyType } from "@/lib/legal/policy-versions";
import { readRequestIpAddress, readRequestUserAgent } from "@/lib/legal/request-metadata";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type AcceptanceRequestBody = {
  policyType?: PolicyType;
  context?: string;
};

export async function POST(request: Request) {
  const { user } = await getCurrentAuthContext();
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

  const body = (await request.json().catch(() => null)) as AcceptanceRequestBody | null;
  const policyType = body?.policyType;
  const context = body?.context?.trim() || "dashboard";

  if (!policyType || !["terms", "privacy", "billing", "risk"].includes(policyType)) {
    return NextResponse.json(
      {
        error: {
          code: "INVALID_POLICY_TYPE",
          message: "A valid policy type is required.",
        },
      },
      { status: 400 },
    );
  }

  try {
    await recordPolicyAcceptance({
      userId: user.id,
      policyType,
      policyVersion: getPolicyVersion(policyType),
      context,
      ipAddress: readRequestIpAddress(request),
      userAgent: readRequestUserAgent(request),
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[legal] failed to record policy acceptance", {
      userId: user.id,
      policyType,
      context,
      error: error instanceof Error ? error.message : String(error),
    });

    return NextResponse.json(
      {
        error: {
          code: "POLICY_ACCEPTANCE_FAILED",
          message: "Unable to save policy acceptance.",
        },
      },
      { status: 500 },
    );
  }
}
