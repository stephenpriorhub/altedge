import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireHubUser } from "@/lib/hub-auth";
import { getFundamentals } from "@/lib/fundamentals";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/fundamentals?ticker=NVDA → key fundamentals + earnings history + next earnings date. */
export async function GET(req: NextRequest) {
  const gate = await requireHubUser(req);
  if ("response" in gate) return gate.response;
  const ticker = req.nextUrl.searchParams.get("ticker");
  if (!ticker) return NextResponse.json({ error: "Missing ?ticker=" }, { status: 400 });
  try {
    const fundamentals = await getFundamentals(ticker);
    return NextResponse.json({ fundamentals });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "failed" }, { status: 500 });
  }
}
