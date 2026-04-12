import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

function parseEnvLine(line) {
  const stripped = line.trim();
  if (!stripped || stripped.startsWith("#") || !stripped.includes("=")) {
    return null;
  }

  const separatorIndex = stripped.indexOf("=");
  const key = stripped.slice(0, separatorIndex).trim();
  let value = stripped.slice(separatorIndex + 1).trim();
  if (!key) {
    return null;
  }

  if (
    value.length >= 2 &&
    value[0] === value.at(-1) &&
    (value[0] === "'" || value[0] === '"')
  ) {
    value = value.slice(1, -1);
  }

  return { key, value };
}

function loadRepoEnv() {
  for (const filename of [".env.local", ".env"]) {
    const filePath = path.join(process.cwd(), filename);
    if (!existsSync(filePath)) {
      continue;
    }

    for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
      const parsed = parseEnvLine(line);
      if (!parsed || process.env[parsed.key] !== undefined) {
        continue;
      }

      process.env[parsed.key] = parsed.value;
    }
  }
}

function parseEnabledFlag(name) {
  return !["0", "false", "no", "off"].includes(
    String(process.env[name] ?? "1").trim().toLowerCase(),
  );
}

loadRepoEnv();

const isWindows = process.platform === "win32";
const pnpmCommand = "pnpm";
const runningChildren = new Set();
const restartTimers = new Set();
let shuttingDown = false;
const redditEnabled = parseEnabledFlag("REDDIT_ENABLED");
const blueskyEnabled = parseEnabledFlag("BLUESKY_ENABLED");
const blueskyFirehoseEnabled = parseEnabledFlag("BLUESKY_FIREHOSE_ENABLED");
const blueskyWorkerMode = String(process.env.BLUESKY_LIVE_WORKER_MODE ?? "authoritative")
  .trim()
  .toLowerCase();

function terminateChild(child) {
  if (!child || child.exitCode !== null || child.killed) {
    return;
  }

  if (isWindows) {
    const killer = spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
      stdio: "ignore",
    });
    killer.on("error", () => {
      child.kill("SIGTERM");
    });
    return;
  }

  child.kill("SIGTERM");
}

function runOneShot(label, args) {
  return new Promise((resolve) => {
    const child = spawn(pnpmCommand, args, {
      cwd: process.cwd(),
      stdio: "inherit",
      shell: isWindows,
    });

    child.on("exit", (code, signal) => {
      if (code || signal) {
        console.error(`[${label}] exited`, { code, signal });
      }
      resolve();
    });

    child.on("error", (error) => {
      console.error(`[${label}] failed to start`, error);
      resolve();
    });
  });
}

function shutdown(exitCode = 0) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  for (const timer of restartTimers) {
    clearTimeout(timer);
  }
  restartTimers.clear();
  for (const child of runningChildren) {
    terminateChild(child);
  }

  setTimeout(() => {
    process.exit(exitCode);
  }, 750);
}

function spawnProcess(label, args, options = {}) {
  const { restartOnExit = false, restartDelayMs = 5000, cleanupArgs = null } = options;
  const child = spawn(pnpmCommand, args, {
    cwd: process.cwd(),
    stdio: "inherit",
    shell: isWindows,
  });

  runningChildren.add(child);

  child.on("exit", (code, signal) => {
    runningChildren.delete(child);
    if (shuttingDown) {
      return;
    }

    const normalizedCode = code ?? (signal ? 1 : 0);
    console.error(`[${label}] exited`, { code, signal });
    if (restartOnExit) {
      const timer = setTimeout(() => {
        restartTimers.delete(timer);
        if (shuttingDown) {
          return;
        }
        console.error(`[${label}] restarting`, { delayMs: restartDelayMs });
        const restart = async () => {
          if (cleanupArgs) {
            await runOneShot(`${label}-cleanup`, cleanupArgs);
          }
          if (!shuttingDown) {
            spawnProcess(label, args, options);
          }
        };
        void restart();
      }, restartDelayMs);
      restartTimers.add(timer);
      return;
    }
    shutdown(normalizedCode);
  });

  child.on("error", (error) => {
    if (shuttingDown) {
      return;
    }

    console.error(`[${label}] failed to start`, error);
    shutdown(1);
  });

  return child;
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

console.info("[dev-live] resolved source flags", {
  redditEnabled,
  blueskyEnabled,
  blueskyFirehoseEnabled,
  blueskyWorkerMode,
});

spawnProcess("next-dev", ["dev"]);
if (blueskyEnabled && blueskyFirehoseEnabled) {
  if (blueskyWorkerMode === "legacy") {
    spawnProcess("bluesky-firehose", ["fetch:bluesky:firehose:live"], {
      restartOnExit: true,
      restartDelayMs: 3000,
    });
  } else {
    spawnProcess("bluesky-worker", ["worker:bluesky"], {
      restartOnExit: true,
      restartDelayMs: 3000,
    });
  }
} else {
  console.info(
    "[dev-live] skipping Bluesky worker because BLUESKY_ENABLED=0 or BLUESKY_FIREHOSE_ENABLED=0",
  );
}
if (redditEnabled) {
  spawnProcess("reddit-rotation", ["fetch:reddit:rotate"], {
    restartOnExit: true,
    restartDelayMs: 5000,
    cleanupArgs: ["exec", "python", "scripts/fetch_reddit_rotation.py", "--reconcile-state"],
  });
} else {
  console.info("[dev-live] skipping reddit rotation because REDDIT_ENABLED=0");
}
