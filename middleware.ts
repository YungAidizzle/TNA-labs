import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/alerts/:path*",
    "/api-data-export/:path*",
    "/dataset-api/:path*",
    "/historical-replay/:path*",
    "/influencer-intelligence/:path*",
    "/influencers/:path*",
    "/live-trends/:path*",
    "/memecoins/:path*",
    "/memes/:path*",
    "/momentum/:path*",
    "/narrative-explorer/:path*",
    "/overview/:path*",
    "/narratives/:path*",
    "/platform-monitor/:path*",
    "/sentiment-map/:path*",
    "/settings/:path*",
    "/sign-in/:path*",
    "/sign-up/:path*",
    "/trends/:path*",
    "/watchlist/:path*",
  ],
};
