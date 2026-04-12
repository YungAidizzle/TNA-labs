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

const SUBSCRIPTION_COLUMNS =
  "id, user_id, stripe_customer_id, stripe_subscription_id, stripe_price_id, status, current_period_end, cancel_at_period_end, created_at, updated_at";

function normalizeEmail(value: string | null | undefined) {
  const normalized = value?.trim().toLowerCase();
  return normalized && normalized.length > 0 ? normalized : null;
}

function maskEmail(email: string | null | undefined) {
  const normalized = normalizeEmail(email);
  if (!normalized) {
    return null;
  }

  const [localPart, domain = ""] = normalized.split("@");
  const safeLocalPart = localPart.length <= 3 ? `${localPart}***` : `${localPart.slice(0, 3)}***`;
  return domain ? `${safeLocalPart}@${domain}` : safeLocalPart;
}

function logBillingEvent(event: string, details: Record<string, unknown>) {
  console.info(`[billing] ${event}`, details);
}

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
    .eq("user_id", userId);

  if (error) {
    console.warn("[billing] viewer subscription lookup failed", {
      userId,
      error: error.message,
    });
    return null;
  }

  return selectCanonicalSubscription((data as AppSubscription[] | null) ?? []);
}

export async function getSubscriptionForUser(userId: string) {
  if (!hasSupabaseServerCredentials()) {
    return null;
  }

  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("subscriptions")
    .select(SUBSCRIPTION_COLUMNS)
    .eq("user_id", userId);

  if (error) {
    console.warn("[billing] subscription lookup failed", {
      userId,
      error: error.message,
    });
    return null;
  }

  return selectCanonicalSubscription((data as AppSubscription[] | null) ?? []);
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
    if (error) {
      console.warn("[billing] subscription list lookup failed", {
        userId,
        error: error.message,
      });
    }
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

  logBillingEvent("profile_customer_synced", {
    userId,
    stripeCustomerId,
    email: maskEmail(email),
  });
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

async function resolveUserIdFromStripeCustomerMetadata(stripeCustomerId: string) {
  try {
    const stripe = getStripeServerClient();
    const customer = await stripe.customers.retrieve(stripeCustomerId);

    if ("deleted" in customer && customer.deleted) {
      return null;
    }

    return readMetadataValue(customer.metadata, "supabaseUserId");
  } catch (error) {
    console.warn("[billing] failed to resolve Stripe customer metadata", {
      stripeCustomerId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

async function resolveUserIdForStripeCustomerId(stripeCustomerId: string) {
  return (
    (await resolveUserIdByStripeCustomerId(stripeCustomerId)) ??
    (await resolveUserIdFromStripeCustomerMetadata(stripeCustomerId))
  );
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

  logBillingEvent("profile_access_refreshed", {
    userId,
    stripeCustomerId: resolvedCustomerId,
    stripeSubscriptionId: canonical?.stripe_subscription_id ?? null,
    subscriptionStatus: canonical?.status ?? null,
    accessState,
    onboardingState,
  });

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

export async function syncSubscriptionFromStripe(
  subscription: Stripe.Subscription,
  hintedUserId?: string | null,
) {
  const stripeCustomerId =
    typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id;
  const userId =
    hintedUserId ??
    readMetadataValue(subscription.metadata, "supabaseUserId") ??
    (await resolveUserIdForStripeCustomerId(stripeCustomerId));

  if (!userId) {
    throw new Error(
      `Unable to resolve Supabase user for Stripe subscription ${subscription.id}.`,
    );
  }

  logBillingEvent("subscription_sync_started", {
    userId,
    stripeCustomerId,
    stripeSubscriptionId: subscription.id,
    stripeStatus: subscription.status,
  });

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

  logBillingEvent("subscription_sync_completed", {
    userId,
    stripeCustomerId,
    stripeSubscriptionId: subscription.id,
    stripeStatus: subscription.status,
    normalizedStatus: upserted?.status ?? null,
  });

  return upserted;
}

export async function syncStripeSubscriptionById(
  stripeSubscriptionId: string,
  hintedUserId?: string | null,
) {
  const stripe = getStripeServerClient();
  const subscription = await stripe.subscriptions.retrieve(stripeSubscriptionId, {
    expand: ["items.data.price"],
  });

  return syncSubscriptionFromStripe(subscription, hintedUserId);
}

export async function syncInvoiceFromStripe(invoice: Stripe.Invoice) {
  const rawStripeSubscription =
    invoice.parent?.type === "subscription_details"
      ? invoice.parent.subscription_details?.subscription ?? null
      : null;
  const stripeSubscriptionId =
    typeof rawStripeSubscription === "string" ? rawStripeSubscription : rawStripeSubscription?.id ?? null;
  const stripeCustomerId =
    typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id ?? null;

  logBillingEvent("invoice_sync_received", {
    stripeInvoiceId: invoice.id,
    stripeCustomerId,
    stripeSubscriptionId,
    invoiceStatus: invoice.status ?? null,
    billingReason: invoice.billing_reason ?? null,
  });

  if (!stripeSubscriptionId) {
    const userId = stripeCustomerId ? await resolveUserIdForStripeCustomerId(stripeCustomerId) : null;
    if (userId) {
      await refreshProfileAccessState(userId, stripeCustomerId);
    }

    return null;
  }

  return syncStripeSubscriptionById(stripeSubscriptionId);
}

type SyncCheckoutSessionOptions = {
  hintedUserId?: string | null;
  source?: string;
};

export async function syncCheckoutSession(
  session: Stripe.Checkout.Session,
  options: SyncCheckoutSessionOptions = {},
) {
  if (session.mode !== "subscription") {
    return null;
  }

  const userId =
    options.hintedUserId ??
    session.client_reference_id ??
    readMetadataValue(session.metadata, "supabaseUserId");
  const stripeCustomerId =
    typeof session.customer === "string" ? session.customer : session.customer?.id ?? null;
  const email = session.customer_details?.email ?? session.customer_email ?? null;

  logBillingEvent("checkout_session_sync_started", {
    source: options.source ?? "unknown",
    stripeCheckoutSessionId: session.id,
    userId,
    stripeCustomerId,
    stripeSubscriptionId:
      typeof session.subscription === "string" ? session.subscription : session.subscription?.id ?? null,
    email: maskEmail(email),
    paymentStatus: session.payment_status,
  });

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

  return syncStripeSubscriptionById(stripeSubscriptionId, userId);
}

async function findExistingStripeCustomerForUser(params: {
  userId: string;
  email?: string | null;
}) {
  const normalizedEmail = normalizeEmail(params.email);
  if (!normalizedEmail) {
    return null;
  }

  const stripe = getStripeServerClient();
  const customers = await stripe.customers.list({
    email: normalizedEmail,
    limit: 20,
  });

  const matchedCustomer =
    customers.data
      .filter((customer) => readMetadataValue(customer.metadata, "supabaseUserId") === params.userId)
      .sort((left, right) => right.created - left.created)[0] ?? null;

  if (!matchedCustomer) {
    return null;
  }

  logBillingEvent("stripe_customer_reused", {
    userId: params.userId,
    stripeCustomerId: matchedCustomer.id,
    email: maskEmail(normalizedEmail),
  });

  return matchedCustomer.id;
}

type ConfirmCheckoutSessionOptions = {
  authenticatedUserId?: string | null;
  expectedEmail?: string | null;
  source?: string;
};

export async function confirmCheckoutSessionById(
  sessionId: string,
  options: ConfirmCheckoutSessionOptions = {},
) {
  const stripe = getStripeServerClient();
  const session = await stripe.checkout.sessions.retrieve(sessionId, {
    expand: ["customer", "subscription"],
  });

  const stripeCustomer =
    typeof session.customer === "string" ||
    !session.customer ||
    ("deleted" in session.customer && session.customer.deleted)
      ? null
      : session.customer;
  const stripeCustomerId =
    typeof session.customer === "string" ? session.customer : session.customer?.id ?? null;
  const sessionEmail =
    session.customer_details?.email ??
    session.customer_email ??
    stripeCustomer?.email ??
    null;
  const resolvedUserId =
    session.client_reference_id ??
    readMetadataValue(session.metadata, "supabaseUserId") ??
    readMetadataValue(stripeCustomer?.metadata, "supabaseUserId") ??
    (stripeCustomerId ? await resolveUserIdForStripeCustomerId(stripeCustomerId) : null);
  const matchedByEmail =
    !resolvedUserId &&
    Boolean(options.authenticatedUserId) &&
    Boolean(normalizeEmail(options.expectedEmail)) &&
    normalizeEmail(options.expectedEmail) === normalizeEmail(sessionEmail);
  const finalUserId = resolvedUserId ?? (matchedByEmail ? options.authenticatedUserId ?? null : null);

  logBillingEvent("checkout_session_confirm_requested", {
    source: options.source ?? "unknown",
    stripeCheckoutSessionId: session.id,
    authenticatedUserId: options.authenticatedUserId ?? null,
    resolvedUserId,
    finalUserId,
    stripeCustomerId,
    stripeSubscriptionId:
      typeof session.subscription === "string" ? session.subscription : session.subscription?.id ?? null,
    email: maskEmail(sessionEmail),
  });

  if (options.authenticatedUserId && finalUserId && finalUserId !== options.authenticatedUserId) {
    throw new Error(
      `Checkout session ${sessionId} belongs to a different authenticated user.`,
    );
  }

  if (options.authenticatedUserId && !finalUserId) {
    throw new Error(`Unable to confirm checkout session ${sessionId} for the authenticated user.`);
  }

  const syncedSubscription = await syncCheckoutSession(session, {
    hintedUserId: finalUserId ?? options.authenticatedUserId ?? null,
    source: options.source ?? "checkout_confirm",
  });
  const refreshedProfile =
    finalUserId || options.authenticatedUserId
      ? await refreshProfileAccessState(finalUserId ?? options.authenticatedUserId!)
      : null;

  const result = {
    userId: finalUserId ?? options.authenticatedUserId ?? null,
    stripeCheckoutSessionId: session.id,
    stripeCustomerId,
    stripeSubscriptionId:
      syncedSubscription?.stripe_subscription_id ??
      (typeof session.subscription === "string" ? session.subscription : session.subscription?.id ?? null),
    accessState: refreshedProfile?.accessState ?? null,
    subscriptionStatus:
      refreshedProfile?.canonicalSubscription?.status ?? syncedSubscription?.status ?? null,
  };

  logBillingEvent("checkout_session_confirm_completed", result);

  return result;
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

  const matchedCustomerId = await findExistingStripeCustomerForUser({ userId, email });
  if (matchedCustomerId) {
    await syncStripeCustomerToProfile(userId, matchedCustomerId, email);
    return matchedCustomerId;
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
