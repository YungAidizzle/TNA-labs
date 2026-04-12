export type ProfileAccessState =
  | "pending_setup"
  | "pending"
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
  | "pending"
  | "inactive"
  | "trialing"
  | "active"
  | "past_due"
  | "canceled";

const PAID_ACCESS_STATES = new Set<ProfileAccessState>(["trialing", "active"]);
const DASHBOARD_ACCESS_STATES = new Set<ProfileAccessState>(["pending", "trialing", "active"]);

export function isPaidAccessState(value: string | null | undefined): value is "trialing" | "active" {
  return PAID_ACCESS_STATES.has((value ?? "") as ProfileAccessState);
}

export function hasDashboardAccessState(
  value: string | null | undefined,
): value is "pending" | "trialing" | "active" {
  return DASHBOARD_ACCESS_STATES.has((value ?? "") as ProfileAccessState);
}

export function mapStripeStatusToSubscriptionStatus(
  value: string | null | undefined,
): SubscriptionStatus {
  switch ((value ?? "").toLowerCase()) {
    case "incomplete":
      return "pending";
    case "trialing":
      return "trialing";
    case "active":
      return "active";
    case "past_due":
      return "past_due";
    case "unpaid":
      return "inactive";
    case "canceled":
      return "canceled";
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
    case "pending":
      return "pending";
    case "trialing":
      return "trialing";
    case "active":
      return "active";
    case "past_due":
      return "inactive";
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
  if (hasDashboardAccessState(accessState)) {
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
    pending: 2,
    past_due: 3,
    inactive: 4,
    canceled: 5,
  };

  return priority[left] - priority[right];
}
