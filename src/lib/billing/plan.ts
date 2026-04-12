import "server-only";

import Stripe from "stripe";
import { getStripePriceId, getStripeServerClient, hasStripeServerConfig } from "@/lib/stripe/server";

export type BillingPlanSummary = {
  productName: string;
  amount: number | null;
  currency: string;
  interval: string;
  intervalCount: number;
  displayPrice: string;
};

function formatCurrency(amountMinor: number, currency: string) {
  const formatter = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });

  return formatter.format(amountMinor / 100);
}

function formatInterval(interval: Stripe.Price.Recurring.Interval, intervalCount: number) {
  if (intervalCount <= 1) {
    return interval;
  }

  return `${intervalCount} ${interval}s`;
}

export async function getConfiguredBillingPlanSummary() {
  if (!hasStripeServerConfig()) {
    return null;
  }

  try {
    const stripe = getStripeServerClient();
    const price = await stripe.prices.retrieve(getStripePriceId(), {
      expand: ["product"],
    });

    const product =
      typeof price.product === "string" || !price.product ? null : price.product;
    const recurring = price.recurring;

    if (!recurring) {
      return null;
    }

    const amount = typeof price.unit_amount === "number" ? price.unit_amount : null;
    const currency = price.currency.toUpperCase();
    const intervalCount = recurring.interval_count ?? 1;

    return {
      productName:
        product && !("deleted" in product && product.deleted) ? product.name : "Subscription",
      amount,
      currency,
      interval: recurring.interval,
      intervalCount,
      displayPrice: amount !== null ? formatCurrency(amount, currency) : currency,
    } satisfies BillingPlanSummary;
  } catch (error) {
    console.warn("[billing] failed to resolve configured plan summary", {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

export function formatBillingIntervalLabel(plan: BillingPlanSummary | null) {
  if (!plan) {
    return "Recurring";
  }

  return formatInterval(plan.interval as Stripe.Price.Recurring.Interval, plan.intervalCount);
}
