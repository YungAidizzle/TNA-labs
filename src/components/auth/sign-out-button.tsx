"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useRouteFeedback } from "@/components/navigation/route-feedback-provider";
import { Button } from "@/components/ui/button";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";

export function SignOutButton() {
  const router = useRouter();
  const { startNavigation } = useRouteFeedback();
  const [submitting, setSubmitting] = useState(false);
  const [isRouting, startRoutingTransition] = useTransition();
  const pending = submitting || isRouting;

  async function handleSignOut() {
    setSubmitting(true);
    let shouldReset = true;

    try {
      const supabase = getSupabaseBrowserClient();
      await supabase.auth.signOut();
      startNavigation("Signing out");
      startRoutingTransition(() => {
        router.replace("/");
        router.refresh();
      });
      shouldReset = false;
    } finally {
      if (shouldReset) {
        setSubmitting(false);
      }
    }
  }

  return (
    <Button
      type="button"
      tone="secondary"
      size="md"
      pending={pending}
      pendingLabel="Signing out"
      onClick={handleSignOut}
    >
      Sign out
    </Button>
  );
}
