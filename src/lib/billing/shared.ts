export type ProfileAccessState =
  | "pending_setup"
  | "trialing"
  | "active"
  | "inactive"
  | "past_due"
  | "canceled";

export type AppOnboardingState =
  | "account_created"
  | "email_verification_pending"
  | "access_pending"
  | "billing_ready"
  | "complete";

export type SubscriptionStatus =
  | "inactive"
  | "trialing"
  | "active"
  | "past_due"
  | "canceled";

const PAID_ACCESS_STATES = new Set<ProfileAccessState>(["trialing", "active"]);

export function isPaidAccessState(value: string | null | undefined): value is "trialing" | "active" {
  return PAID_ACCESS_STATES.has((value ?? "") as ProfileAccessState);
}

export function mapStripeStatusToSubscriptionStatus(
  value: string | null | undefined,
): SubscriptionStatus {
  switch ((value ?? "").toLowerCase()) {
    case "trialing":
      return "trialing";
    case "active":
      return "active";
    case "past_due":
    case "unpaid":
      return "past_due";
    case "canceled":
      return "canceled";
    case "incomplete":
    case "incomplete_expired":
    case "paused":
    default:
      return "inactive";
  }
}

export function mapSubscriptionStatusToAccessState(
  status: SubscriptionStatus,
): ProfileAccessState {
  switch (status) {
    case "trialing":
      return "trialing";
    case "active":
      return "active";
    case "past_due":
      return "past_due";
    case "canceled":
      return "canceled";
    case "inactive":
    default:
      return "inactive";
  }
}

export function deriveOnboardingState(
  accessState: ProfileAccessState,
  hasStripeCustomer: boolean,
): AppOnboardingState {
  if (isPaidAccessState(accessState)) {
    return "complete";
  }

  if (hasStripeCustomer) {
    return "billing_ready";
  }

  if (accessState === "pending_setup") {
    return "account_created";
  }

  return "access_pending";
}

export function compareSubscriptionStatusPriority(
  left: SubscriptionStatus,
  right: SubscriptionStatus,
) {
  const priority: Record<SubscriptionStatus, number> = {
    active: 0,
    trialing: 1,
    past_due: 2,
    inactive: 3,
    canceled: 4,
  };

  return priority[left] - priority[right];
}
