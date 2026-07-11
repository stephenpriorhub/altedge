import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getAllWatchedTickers } from "@/lib/watchlist";
import { resolveEntity } from "@/lib/entity-resolver";
import { runConnectors } from "@/lib/connectors";
import { appendSnapshot } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Scheduled scan of every watchlisted ticker → appends a fresh snapshot each, so hiring/
 * headcount/trend histories accrue automatically over time. Auth: x-hub-token == HUB_API_TOKEN
 * (or CRON_SECRET). Runs sequentially with a small delay to be gentle on metered APIs.
 */
export async function POST(req: NextRequest) {
  return run(req);
}
export async function GET(req: NextRequest) {
  return run(req);
}

async function run(req: NextRequest) {
  const token = req.headers.get("x-hub-token") || req.nextUrl.searchParams.get("token");
  const expected = process.env.HUB_API_TOKEN || process.env.CRON_SECRET;
  if (!expected || token !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const tickers = getAllWatchedTickers();
  const results: { ticker: string; ok: number; total: number; error?: string }[] = [];
  for (const t of tickers) {
    try {
      const entity = await resolveEntity(t);
      const signals = await runConnectors(entity);
      appendSnapshot(t, signals);
      results.push({ ticker: t, ok: signals.filter((s) => s.status === "ok").length, total: signals.length });
    } catch (e) {
      results.push({ ticker: t, ok: 0, total: 0, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return NextResponse.json({ scanned: tickers.length, at: new Date().toISOString(), results });
}
