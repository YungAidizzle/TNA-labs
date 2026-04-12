import "server-only";

import Stripe from "stripe";
import { getSupabaseAuthServerClient } from "@/lib/supabase/auth";
import { getSupabaseServerClient, hasSupabaseServerCredentials } from "@/lib/supabase/server";
import {
  compareSubscriptionStatusPriority,
  deriveOnboardingState,
  isPaidAccessState,
  mapStripeStatusToSubscriptionStatus,
  mapSubscriptionStatusToAccessState,
  type ProfileAccessState,
  type SubscriptionStatus,
} from "@/lib/billing/shared";
import { getStripeServerClient } from "@/lib/stripe/server";

export type AppSubscription = {
  id: string;
  user_id: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  stripe_price_id: string | null;
  status: SubscriptionStatus;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  created_at: string;
  updated_at: string;
};

export type CheckoutSessionConfirmationResult =
  | {
      status: "access_granted" | "already_active";
      message: string;
      accessState: ProfileAccessState | null;
      stripeCustomerId: string | null;
      stripeSubscriptionId: string | null;
      subscriptionStatus: SubscriptionStatus | null;
    }
  | {
      status: "processing";
      message: string;
      accessState: ProfileAccessState | null;
      stripeCustomerId: string | null;
      stripeSubscriptionId: string | null;
      subscriptionStatus: SubscriptionStatus | null;
    }
  | {
      status: "invalid";
      message: string;
    };

const SUBSCRIPTION_COLUMNS =
  "id, user_id, stripe_customer_id, stripe_subscription_id, stripe_price_id, status, current_period_end, cancel_at_period_end, created_at, updated_at";

function toIsoFromUnixTimestamp(value: number | null | undefined) {
  if (!value || !Number.isFinite(value)) {
    return null;
  }

  return new Date(value * 1000).toISOString();
}

function readMetadataValue(metadata: Stripe.Metadata | null | undefined, key: string) {
  const value = metadata?.[key];
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function compareSubscriptions(left: AppSubscription, right: AppSubscription) {
  const statusPriority = compareSubscriptionStatusPriority(left.status, right.status);
  if (statusPriority !== 0) {
    return statusPriority;
  }

  const leftPeriodEnd = Date.parse(left.current_period_end ?? "");
  const rightPeriodEnd = Date.parse(right.current_period_end ?? "");
  if (Number.isFinite(leftPeriodEnd) && Number.isFinite(rightPeriodEnd) && rightPeriodEnd !== leftPeriodEnd) {
    return rightPeriodEnd - leftPeriodEnd;
  }

  const leftUpdatedAt = Date.parse(left.updated_at ?? "");
  const rightUpdatedAt = Date.parse(right.updated_at ?? "");
  if (Number.isFinite(leftUpdatedAt) && Number.isFinite(rightUpdatedAt) && rightUpdatedAt !== leftUpdatedAt) {
    return rightUpdatedAt - leftUpdatedAt;
  }

  return 0;
}

export function selectCanonicalSubscription(subscriptions: AppSubscription[]) {
  if (subscriptions.length === 0) {
    return null;
  }

  return [...subscriptions].sort(compareSubscriptions)[0] ?? null;
}

export async function getCurrentViewerSubscription(userId: string | null | undefined) {
  if (!userId) {
    return null;
  }

  const supabase = await getSupabaseAuthServerClient();
  if (!supabase) {
    return null;
  }

  const { data, error } = await supabase
    .from("subscriptions")
    .select(SUBSCRIPTION_COLUMNS)
    .eq("user_id", userId)
    .order("current_period_end", { ascending: false, nullsFirst: false })
    .order("updated_at", { ascending: false })
    .limit(1);

  if (error) {
    return null;
  }

  return (data?.[0] as AppSubscription | undefined) ?? null;
}

export async function getSubscriptionForUser(userId: string) {
  if (!hasSupabaseServerCredentials()) {
    return null;
  }

  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("subscriptions")
    .select(SUBSCRIPTION_COLUMNS)
    .eq("user_id", userId)
    .order("current_period_end", { ascending: false, nullsFirst: false })
    .order("updated_at", { ascending: false })
    .limit(1);

  if (error) {
    return null;
  }

  return (data?.[0] as AppSubscription | undefined) ?? null;
}

async function getSubscriptionsForUser(userId: string) {
  if (!hasSupabaseServerCredentials()) {
    return [];
  }

  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("subscriptions")
    .select(SUBSCRIPTION_COLUMNS)
    .eq("user_id", userId);

  if (error || !data) {
    return [];
  }

  return data as AppSubscription[];
}

export async function syncStripeCustomerToProfile(
  userId: string,
  stripeCustomerId: string,
  email?: string | null,
) {
  if (!hasSupabaseServerCredentials()) {
    return;
  }

  const supabase = getSupabaseServerClient();
  await supabase.from("profiles").upsert(
    {
      id: userId,
      email: email ?? null,
      stripe_customer_id: stripeCustomerId,
      onboarding_state: "billing_ready",
    },
    { onConflict: "id" },
  );
}

async function resolveUserIdByStripeCustomerId(stripeCustomerId: string) {
  if (!hasSupabaseServerCredentials()) {
    return null;
  }

  const supabase = getSupabaseServerClient();
  const profileMatch = await supabase
    .from("profiles")
    .select("id")
    .eq("stripe_customer_id", stripeCustomerId)
    .limit(1)
    .maybeSingle<{ id: string }>();

  if (profileMatch.data?.id) {
    return profileMatch.data.id;
  }

  const subscriptionMatch = await supabase
    .from("subscriptions")
    .select("user_id")
    .eq("stripe_customer_id", stripeCustomerId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ user_id: string }>();

  return subscriptionMatch.data?.user_id ?? null;
}

export async function refreshProfileAccessState(userId: string, stripeCustomerId?: string | null) {
  if (!hasSupabaseServerCredentials()) {
    return null;
  }

  const supabase = getSupabaseServerClient();
  const subscriptions = await getSubscriptionsForUser(userId);
  const canonical = selectCanonicalSubscription(subscriptions);
  const accessState: ProfileAccessState = canonical
    ? mapSubscriptionStatusToAccessState(canonical.status)
    : stripeCustomerId
      ? "inactive"
      : "pending_setup";

  const { data: existingProfile } = await supabase
    .from("profiles")
    .select("stripe_customer_id")
    .eq("id", userId)
    .maybeSingle<{ stripe_customer_id: string | null }>();

  const resolvedCustomerId = stripeCustomerId ?? existingProfile?.stripe_customer_id ?? null;
  const onboardingState = deriveOnboardingState(accessState, Boolean(resolvedCustomerId));

  await supabase.from("profiles").upsert(
    {
      id: userId,
      access_state: accessState,
      onboarding_state: onboardingState,
      stripe_customer_id: resolvedCustomerId,
    },
    { onConflict: "id" },
  );

  return {
    accessState,
    canonicalSubscription: canonical,
  };
}

export async function upsertSubscriptionRecord(
  subscription: Pick<
    AppSubscription,
    | "user_id"
    | "stripe_customer_id"
    | "stripe_subscription_id"
    | "stripe_price_id"
    | "status"
    | "current_period_end"
    | "cancel_at_period_end"
  >,
) {
  if (!hasSupabaseServerCredentials()) {
    return null;
  }

  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("subscriptions")
    .upsert(subscription, { onConflict: "stripe_subscription_id" })
    .select(SUBSCRIPTION_COLUMNS)
    .maybeSingle<AppSubscription>();

  if (error) {
    throw error;
  }

  return data ?? null;
}

function getStripePriceIdFromSubscription(subscription: Stripe.Subscription) {
  return subscription.items.data[0]?.price?.id ?? null;
}

function getStripeCurrentPeriodEnd(subscription: Stripe.Subscription) {
  const periodEnds = subscription.items.data
    .map((item) => item.current_period_end)
    .filter((value): value is number => Number.isFinite(value));

  if (periodEnds.length === 0) {
    return null;
  }

  return Math.max(...periodEnds);
}

function isAccessReadyStatus(status: SubscriptionStatus) {
  return status === "active" || status === "trialing";
}

async function resolveExpandedCheckoutSubscription(session: Stripe.Checkout.Session) {
  const subscriptionValue = session.subscription;
  if (!subscriptionValue) {
    return null;
  }

  if (typeof subscriptionValue !== "string") {
    return subscriptionValue;
  }

  const stripe = getStripeServerClient();
  return stripe.subscriptions.retrieve(subscriptionValue, {
    expand: ["items.data.price"],
  });
}

function resolveCheckoutSessionUserId(
  session: Stripe.Checkout.Session,
  subscription: Stripe.Subscription | null,
) {
  const expandedCustomer =
    session.customer &&
    typeof session.customer !== "string" &&
    !("deleted" in session.customer && session.customer.deleted)
      ? session.customer
      : null;

  return (
    session.client_reference_id ??
    readMetadataValue(session.metadata, "supabaseUserId") ??
    readMetadataValue(subscription?.metadata, "supabaseUserId") ??
    readMetadataValue(expandedCustomer?.metadata, "supabaseUserId") ??
    null
  );
}

export async function syncSubscriptionFromStripe(
  subscription: Stripe.Subscription,
  hintedUserId?: string | null,
) {
  const stripeCustomerId =
    typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id;
  const userId =
    hintedUserId ??
    readMetadataValue(subscription.metadata, "supabaseUserId") ??
    (await resolveUserIdByStripeCustomerId(stripeCustomerId));

  if (!userId) {
    throw new Error(
      `Unable to resolve Supabase user for Stripe subscription ${subscription.id}.`,
    );
  }

  await syncStripeCustomerToProfile(userId, stripeCustomerId);

  const upserted = await upsertSubscriptionRecord({
    user_id: userId,
    stripe_customer_id: stripeCustomerId,
    stripe_subscription_id: subscription.id,
    stripe_price_id: getStripePriceIdFromSubscription(subscription),
    status: mapStripeStatusToSubscriptionStatus(subscription.status),
    current_period_end: toIsoFromUnixTimestamp(getStripeCurrentPeriodEnd(subscription)),
    cancel_at_period_end: Boolean(subscription.cancel_at_period_end),
  });

  await refreshProfileAccessState(userId, stripeCustomerId);

  return upserted;
}

export async function syncCheckoutSession(session: Stripe.Checkout.Session) {
  if (session.mode !== "subscription") {
    return null;
  }

  const userId =
    session.client_reference_id ??
    readMetadataValue(session.metadata, "supabaseUserId");
  const stripeCustomerId =
    typeof session.customer === "string" ? session.customer : session.customer?.id ?? null;
  const email = session.customer_details?.email ?? session.customer_email ?? null;

  if (userId && stripeCustomerId) {
    await syncStripeCustomerToProfile(userId, stripeCustomerId, email);
  }

  const stripeSubscriptionId =
    typeof session.subscription === "string"
      ? session.subscription
      : session.subscription?.id ?? null;

  if (!stripeSubscriptionId) {
    if (userId && stripeCustomerId) {
      await refreshProfileAccessState(userId, stripeCustomerId);
    }
    return null;
  }

  const stripe = getStripeServerClient();
  const subscription = await stripe.subscriptions.retrieve(stripeSubscriptionId, {
    expand: ["items.data.price"],
  });

  return syncSubscriptionFromStripe(subscription, userId);
}

export async function confirmCheckoutSessionForUser(params: {
  sessionId: string;
  userId: string;
  currentAccessState?: ProfileAccessState | null;
  expectedStripeCustomerId?: string | null;
}): Promise<CheckoutSessionConfirmationResult> {
  const { sessionId, userId, currentAccessState, expectedStripeCustomerId } = params;

  if (isPaidAccessState(currentAccessState)) {
    return {
      status: "already_active",
      message: "Access is already active on this account.",
      accessState: currentAccessState,
      stripeCustomerId: expectedStripeCustomerId ?? null,
      stripeSubscriptionId: null,
      subscriptionStatus: null,
    };
  }

  const stripe = getStripeServerClient();
  const session = await stripe.checkout.sessions.retrieve(sessionId, {
    expand: ["customer", "subscription", "subscription.items.data.price"],
  });

  if (session.mode !== "subscription") {
    return {
      status: "invalid",
      message: "This checkout session is not a subscription session.",
    };
  }

  const stripeCustomerId =
    typeof session.customer === "string" ? session.customer : session.customer?.id ?? null;
  const subscription = await resolveExpandedCheckoutSubscription(session);
  const stripeSubscriptionId = subscription?.id ?? null;
  const resolvedSessionUserId = resolveCheckoutSessionUserId(session, subscription);
  const resolvedProfileUserId = stripeCustomerId
    ? await resolveUserIdByStripeCustomerId(stripeCustomerId)
    : null;
  const belongsToUser =
    resolvedSessionUserId === userId ||
    resolvedProfileUserId === userId ||
    Boolean(expectedStripeCustomerId && stripeCustomerId && expectedStripeCustomerId === stripeCustomerId);

  if (!belongsToUser) {
    return {
      status: "invalid",
      message: "This checkout session does not belong to the current account.",
    };
  }

  if (!stripeCustomerId) {
    return {
      status: "invalid",
      message: "Stripe did not return a customer for this checkout session.",
    };
  }

  if (session.status !== "complete") {
    return {
      status: "processing",
      message: "Checkout is still being completed in Stripe.",
      accessState: currentAccessState ?? null,
      stripeCustomerId,
      stripeSubscriptionId,
      subscriptionStatus: null,
    };
  }

  if (session.payment_status !== "paid") {
    return {
      status: "processing",
      message: "Payment is still being confirmed. Access will open as soon as Stripe marks it paid.",
      accessState: currentAccessState ?? null,
      stripeCustomerId,
      stripeSubscriptionId,
      subscriptionStatus: subscription
        ? mapStripeStatusToSubscriptionStatus(subscription.status)
        : null,
    };
  }

  if (!subscription) {
    return {
      status: "processing",
      message: "Stripe is still finalizing the subscription record. Retry in a moment.",
      accessState: currentAccessState ?? null,
      stripeCustomerId,
      stripeSubscriptionId,
      subscriptionStatus: null,
    };
  }

  const subscriptionStatus = mapStripeStatusToSubscriptionStatus(subscription.status);
  if (!isAccessReadyStatus(subscriptionStatus)) {
    return {
      status: "processing",
      message: "Payment succeeded, but subscription activation is still in progress.",
      accessState: currentAccessState ?? null,
      stripeCustomerId,
      stripeSubscriptionId,
      subscriptionStatus,
    };
  }

  await syncStripeCustomerToProfile(
    userId,
    stripeCustomerId,
    session.customer_details?.email ?? session.customer_email ?? null,
  );

  await upsertSubscriptionRecord({
    user_id: userId,
    stripe_customer_id: stripeCustomerId,
    stripe_subscription_id: subscription.id,
    stripe_price_id: getStripePriceIdFromSubscription(subscription),
    status: subscriptionStatus,
    current_period_end: toIsoFromUnixTimestamp(getStripeCurrentPeriodEnd(subscription)),
    cancel_at_period_end: Boolean(subscription.cancel_at_period_end),
  });

  const refreshed = await refreshProfileAccessState(userId, stripeCustomerId);
  const accessState = refreshed?.accessState ?? null;

  return {
    status: isPaidAccessState(accessState) ? "access_granted" : "processing",
    message: isPaidAccessState(accessState)
      ? "Access confirmed. Redirecting to the terminal."
      : "Subscription synced, but access is still updating. Retry in a moment.",
    accessState,
    stripeCustomerId,
    stripeSubscriptionId: subscription.id,
    subscriptionStatus,
  };
}

export async function getOrCreateStripeCustomerForUser(params: {
  userId: string;
  email?: string | null;
  existingCustomerId?: string | null;
}) {
  const { userId, email, existingCustomerId } = params;
  if (existingCustomerId) {
    return existingCustomerId;
  }

  const existingSubscription = await getSubscriptionForUser(userId);
  if (existingSubscription?.stripe_customer_id) {
    return existingSubscription.stripe_customer_id;
  }

  const stripe = getStripeServerClient();
  const customer = await stripe.customers.create({
    email: email ?? undefined,
    metadata: {
      supabaseUserId: userId,
    },
  });

  await syncStripeCustomerToProfile(userId, customer.id, email);
  return customer.id;
}

export function shouldAllowPaidAccess(accessState: string | null | undefined) {
  return isPaidAccessState(accessState);
}
