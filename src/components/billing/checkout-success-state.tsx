"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { CheckCircle2, CircleAlert, LoaderCircle, RefreshCcw } from "lucide-react";
import { useRouteFeedback } from "@/components/navigation/route-feedback-provider";
import { Button, buttonClassName } from "@/components/ui/button";
import { InteractiveLink } from "@/components/ui/interactive-link";

type CheckoutSuccessStateProps = {
  sessionId: string | null;
  initialHasPaidAccess: boolean;
  initialAccessState: string | null | undefined;
  userEmail: string | null | undefined;
};

type ConfirmationState =
  | {
      phase: "finalizing";
      message: string;
    }
  | {
      phase: "redirecting";
      message: string;
    }
  | {
      phase: "processing";
      message: string;
    }
  | {
      phase: "error";
      message: string;
    };

type ConfirmCheckoutResponse = {
  status: "access_granted" | "already_active" | "processing";
  message: string;
  accessState: string | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  subscriptionStatus: string | null;
};

function truncateSessionId(value: string | null) {
  if (!value) {
    return "Unavailable";
  }

  if (value.length <= 18) {
    return value;
  }

  return `${value.slice(0, 10)}...${value.slice(-6)}`;
}

export function CheckoutSuccessState({
  sessionId,
  initialHasPaidAccess,
  initialAccessState,
  userEmail,
}: CheckoutSuccessStateProps) {
  const router = useRouter();
  const { startNavigation } = useRouteFeedback();
  const [isRouting, startRoutingTransition] = useTransition();
  const startedRef = useRef(false);
  const [state, setState] = useState<ConfirmationState>(() => {
    if (initialHasPaidAccess) {
      return {
        phase: "redirecting",
        message: "Access is already active. Opening the terminal.",
      };
    }

    if (!sessionId) {
      return {
        phase: "error",
        message: "Missing checkout session ID. Return to pricing and try the access flow again.",
      };
    }

    return {
      phase: "finalizing",
      message: "Finalizing access with Stripe and updating your account.",
    };
  });

  const canRetry = state.phase === "processing" || state.phase === "error";
  const statusLabel = useMemo(() => {
    if (state.phase === "redirecting") {
      return "Access confirmed";
    }

    if (state.phase === "processing") {
      return "Still processing";
    }

    if (state.phase === "error") {
      return "Confirmation failed";
    }

    return "Finalizing access";
  }, [state.phase]);

  function redirectToDashboard() {
    startNavigation("Opening terminal");
    startRoutingTransition(() => {
      router.replace("/dashboard");
      router.refresh();
    });
  }

  async function confirmAccess() {
    if (!sessionId) {
      setState({
        phase: "error",
        message: "Missing checkout session ID. Return to pricing and try again.",
      });
      return;
    }

    setState({
      phase: "finalizing",
      message: "Finalizing access with Stripe and updating your account.",
    });

    try {
      const response = await fetch("/api/stripe/checkout/confirm", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        cache: "no-store",
        body: JSON.stringify({ sessionId }),
      });

      const body = (await response.json()) as
        | ConfirmCheckoutResponse
        | { error?: { message?: string } };

      if (!response.ok) {
        const errorMessage =
          "error" in body ? body.error?.message : undefined;
        setState({
          phase: "error",
          message: errorMessage ?? "We could not confirm access right now.",
        });
        return;
      }

      if (!("status" in body)) {
        setState({
          phase: "error",
          message: "Stripe confirmation returned an unexpected response.",
        });
        return;
      }

      if (body.status === "processing") {
        setState({
          phase: "processing",
          message: body.message,
        });
        return;
      }

      setState({
        phase: "redirecting",
        message: body.message,
      });

      redirectToDashboard();
    } catch {
      setState({
        phase: "error",
        message: "We could not reach Stripe confirmation right now. Retry to continue.",
      });
    }
  }

  useEffect(() => {
    if (startedRef.current) {
      return;
    }

    startedRef.current = true;

    if (initialHasPaidAccess) {
      redirectToDashboard();
      return;
    }

    void confirmAccess();
  }, [initialHasPaidAccess, sessionId]);

  return (
    <div className="surface-panel mt-8 border border-white/[0.08] p-6 sm:p-8 lg:p-10">
      <div className="mt-1 flex items-center gap-3">
        {state.phase === "redirecting" ? (
          <CheckCircle2 className="h-5 w-5 text-emerald" />
        ) : state.phase === "error" ? (
          <CircleAlert className="h-5 w-5 text-rose" />
        ) : (
          <LoaderCircle className="h-5 w-5 animate-spin text-cyan" />
        )}
        <p className="text-[11px] uppercase tracking-[0.16em] text-[#6e8299]">{statusLabel}</p>
      </div>

      <h1 className="mt-4 text-[34px] font-semibold tracking-[-0.05em] text-[#f3f8ff] sm:text-[40px]">
        {state.phase === "redirecting"
          ? "Access confirmed. Opening the terminal."
          : state.phase === "processing"
            ? "Payment received. Access is still being finalized."
            : state.phase === "error"
              ? "We could not confirm access yet."
              : "Finalizing your access now."}
      </h1>

      <p className="mt-4 max-w-[760px] text-[15px] leading-8 text-[#92a7bf]">{state.message}</p>

      <div className="mt-8 grid gap-3 md:grid-cols-3">
        <div className="metric-card">
          <p className="section-kicker">Account</p>
          <p className="mt-3 text-[14px] text-[#e9f1fb]">{userEmail ?? "Unavailable"}</p>
        </div>
        <div className="metric-card">
          <p className="section-kicker">Current access</p>
          <p className="mt-3 text-[14px] capitalize text-[#e9f1fb]">
            {initialAccessState ?? "pending"}
          </p>
        </div>
        <div className="metric-card">
          <p className="section-kicker">Session</p>
          <p className="mt-3 text-[14px] text-[#e9f1fb]">{truncateSessionId(sessionId)}</p>
        </div>
      </div>

      {state.phase === "processing" ? (
        <div className="mt-6 status-banner border-amber/20 bg-amber/10 text-[#f7c27b]">
          Stripe has the checkout session, but the subscription is still finalizing. This can happen
          with delayed payment confirmation methods.
        </div>
      ) : null}

      {state.phase === "error" ? (
        <div className="mt-6 status-banner border-rose/20 bg-rose/10 text-[#ffb0b0]">
          If Stripe already shows a successful payment, retry once from here. The webhook will still
          reconcile the subscription state afterward.
        </div>
      ) : null}

      <div className="mt-8 flex flex-wrap gap-3">
        {canRetry ? (
          <Button
            tone="primary"
            size="lg"
            pending={isRouting}
            pendingLabel="Finalizing access"
            onClick={() => void confirmAccess()}
            trailingAdornment={<RefreshCcw className="h-4 w-4" />}
          >
            Retry confirmation
          </Button>
        ) : null}

        <InteractiveLink
          href="/pricing"
          pendingLabel="Opening pricing"
          navigationLabel="Opening pricing"
          className={buttonClassName({ tone: canRetry ? "secondary" : "quiet", size: "lg" })}
        >
          Back to pricing
        </InteractiveLink>
      </div>
    </div>
  );
}
