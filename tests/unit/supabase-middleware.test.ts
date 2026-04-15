import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const supabaseMocks = vi.hoisted(() => ({
  createServerClient: vi.fn(),
  getUser: vi.fn(),
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: supabaseMocks.createServerClient,
}));

import { updateSession } from "@/lib/supabase/middleware";

const ORIGINAL_ENV = { ...process.env };

describe("updateSession", () => {
  beforeEach(() => {
    process.env = {
      ...ORIGINAL_ENV,
      NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
    };

    supabaseMocks.getUser.mockReset();
    supabaseMocks.getUser.mockResolvedValue({
      data: { user: null },
    });
    supabaseMocks.createServerClient.mockReset();
    supabaseMocks.createServerClient.mockReturnValue({
      auth: {
        getUser: supabaseMocks.getUser,
      },
    });
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("skips Supabase auth work for public routes", async () => {
    const response = await updateSession(new NextRequest("https://example.com/"));

    expect(response.status).toBe(200);
    expect(supabaseMocks.createServerClient).not.toHaveBeenCalled();
    expect(supabaseMocks.getUser).not.toHaveBeenCalled();
  });

  it("redirects anonymous protected requests to sign-in with the original path", async () => {
    const response = await updateSession(
      new NextRequest("https://example.com/trends?scope=memes"),
    );

    expect(supabaseMocks.createServerClient).toHaveBeenCalledTimes(1);
    expect(supabaseMocks.getUser).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://example.com/sign-in?next=%2Ftrends%3Fscope%3Dmemes",
    );
  });

  it("redirects authenticated auth-page requests without querying profile state", async () => {
    supabaseMocks.getUser.mockResolvedValue({
      data: {
        user: {
          id: "user-123",
          email: "test@example.com",
        },
      },
    });

    const response = await updateSession(
      new NextRequest("https://example.com/sign-in?next=%2Fwatchlist"),
    );

    expect(supabaseMocks.createServerClient).toHaveBeenCalledTimes(1);
    expect(supabaseMocks.getUser).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://example.com/watchlist");
  });
});
