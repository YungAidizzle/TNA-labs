import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const getUserMock = vi.hoisted(() => vi.fn());
const maybeSingleMock = vi.hoisted(() => vi.fn());

vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: {
      getUser: getUserMock,
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: maybeSingleMock,
        }),
      }),
    }),
  }),
}));

async function loadMiddlewareModule() {
  vi.resetModules();
  return import("@/lib/supabase/middleware");
}

describe("supabase middleware dashboard gating", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    getUserMock.mockReset();
    maybeSingleMock.mockReset();
  });

  it("allows pending users through protected dashboard routes", async () => {
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
    getUserMock.mockResolvedValue({ data: { user: { id: "user_123" } } });
    maybeSingleMock.mockResolvedValue({ data: { access_state: "pending" } });

    const { updateSession } = await loadMiddlewareModule();
    const response = await updateSession(new NextRequest("http://localhost/dashboard"));

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
  });

  it("redirects inactive users out of protected dashboard routes", async () => {
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
    getUserMock.mockResolvedValue({ data: { user: { id: "user_123" } } });
    maybeSingleMock.mockResolvedValue({ data: { access_state: "inactive" } });

    const { updateSession } = await loadMiddlewareModule();
    const response = await updateSession(new NextRequest("http://localhost/dashboard"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("/pricing");
  });
});
