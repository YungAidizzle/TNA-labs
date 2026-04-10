import { LandingPage } from "@/components/marketing/landing-page";
import { getCurrentAuthContext } from "@/lib/supabase/auth";
import { isPaidAccessState } from "@/lib/billing/shared";

export default async function Home() {
  const { user, profile } = await getCurrentAuthContext();

  return (
    <LandingPage
      isAuthenticated={Boolean(user)}
      hasPaidAccess={isPaidAccessState(profile?.access_state)}
    />
  );
}
