const baseUrl = (process.env.DASHBOARD_BASE_URL ?? "http://localhost:3000").trim().replace(/\/+$/, "");
const force = process.argv.includes("--force");

const url = new URL("/api/cron/gpt-trends", `${baseUrl}/`);
if (force) {
  url.searchParams.set("force", "true");
}

const headers = new Headers();
const cronSecret = (process.env.CRON_SECRET ?? "").trim();
if (cronSecret) {
  headers.set("Authorization", `Bearer ${cronSecret}`);
}

const response = await fetch(url, {
  method: "POST",
  headers,
});

const payload = await response.json().catch(() => null);
if (!response.ok) {
  console.error("[run-gpt-trends] request failed", {
    status: response.status,
    payload,
  });
  process.exit(1);
}

console.info("[run-gpt-trends] completed", payload);
