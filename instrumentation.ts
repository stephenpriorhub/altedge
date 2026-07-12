export const runtime = "nodejs";

/**
 * In-process daily scheduler for the watchlist scan.
 *
 * Mirrors the mechanism iSpyEmails uses for its /api/cron/brain-sync job: the Next.js
 * `register()` instrumentation hook self-schedules a fetch of an internal cron endpoint.
 * iSpy uses plain intervals; here we pin the fire to ~06:00 America/New_York (off-peak)
 * and re-arm after each run so it stays aligned across DST.
 *
 * The scan (GET/POST /api/cron/scan) requires `x-hub-token == HUB_API_TOKEN` (or CRON_SECRET).
 * The token is read from the environment at call time and never logged.
 */
export async function register() {
  // Only run in the Node.js server runtime (not edge, not build time, not tests).
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NODE_ENV === "test") return;

  const TARGET_HOUR_ET = 6; // 06:00 America/New_York, off-peak
  const SELF_URL =
    process.env.SELF_URL ??
    process.env.NEXTAUTH_URL ??
    `http://127.0.0.1:${process.env.PORT ?? 3000}`;
  const CRON_TOKEN = process.env.HUB_API_TOKEN ?? process.env.CRON_SECRET;

  // Milliseconds until the next TARGET_HOUR_ET:00 in America/New_York (DST-aware).
  function msUntilNextRun(): number {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      hourCycle: "h23",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).formatToParts(new Date());
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
    const nowSecET = get("hour") * 3600 + get("minute") * 60 + get("second");
    let delta = TARGET_HOUR_ET * 3600 - nowSecET;
    if (delta <= 0) delta += 24 * 3600;
    return delta * 1000;
  }

  async function runScan() {
    if (!CRON_TOKEN) {
      console.error("[ShadowData] Daily scan skipped — no HUB_API_TOKEN/CRON_SECRET in env");
      return;
    }
    try {
      const res = await fetch(`${SELF_URL}/api/cron/scan`, {
        method: "POST",
        headers: { "x-hub-token": CRON_TOKEN },
      });
      const data = (await res.json()) as { scanned?: number };
      console.log(
        `[ShadowData] Daily scan complete — status ${res.status}, scanned ${data.scanned ?? "?"} ticker(s)`,
      );
    } catch (err) {
      console.error("[ShadowData] Daily scan failed:", err);
    }
  }

  function scheduleNext() {
    const delay = msUntilNextRun();
    console.log(
      `[ShadowData] Daily watchlist scan scheduled — next run in ~${Math.round(delay / 60000)} min (06:00 ET)`,
    );
    setTimeout(async () => {
      await runScan();
      scheduleNext(); // re-arm for the following day
    }, delay);
  }

  scheduleNext();
}
