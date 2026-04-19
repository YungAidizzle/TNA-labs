import fs from "node:fs";
import path from "node:path";

function loadRepoEnv() {
  const candidates = [".env.local", ".env"];

  for (const relativePath of candidates) {
    const targetPath = path.join(process.cwd(), relativePath);
    if (!fs.existsSync(targetPath)) {
      continue;
    }

    const contents = fs.readFileSync(targetPath, "utf8");
    for (const line of contents.split(/\r?\n/)) {
      if (!line || line.trim().startsWith("#")) {
        continue;
      }

      const separatorIndex = line.indexOf("=");
      if (separatorIndex <= 0) {
        continue;
      }

      const key = line.slice(0, separatorIndex).trim();
      let value = line.slice(separatorIndex + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (!(key in process.env)) {
        process.env[key] = value;
      }
    }
  }
}

function parseArgs() {
  const args = process.argv.slice(2);
  return {
    force: args.includes("--force"),
    baseUrl:
      args.find((value) => value.startsWith("--base-url="))?.slice("--base-url=".length) ||
      process.env.AI_NATIVE_NARRATIVE_BASE_URL ||
      "http://localhost:3000",
  };
}

async function main() {
  loadRepoEnv();
  const args = parseArgs();
  const url = new URL("/api/cron/ai-native-narratives", args.baseUrl);
  if (args.force) {
    url.searchParams.set("force", "true");
  }

  const headers = {};
  if ((process.env.CRON_SECRET || "").trim()) {
    headers.authorization = `Bearer ${process.env.CRON_SECRET.trim()}`;
  }

  const response = await fetch(url, {
    method: "POST",
    headers,
  });
  const body = await response.text();
  process.stdout.write(`${body}\n`);
  process.exit(response.ok ? 0 : 1);
}

main().catch((error) => {
  console.error("[ai-native-narrative-refresh] failed", error);
  process.exit(1);
});
