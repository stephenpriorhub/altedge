import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireHubUser } from "@/lib/hub-auth";
import { getWatchlist, setWatchlist, getAllWatchlists } from "@/lib/watchlist";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isSuperAdmin(role: string) {
  return role === "super_admin" || role === "exec_admin";
}

/** GET /api/watchlist → your list. GET ?scope=all → every user's list (super-admins only). */
export async function GET(req: NextRequest) {
  const gate = await requireHubUser(req);
  if ("response" in gate) return gate.response;
  const { user } = gate;
  if (req.nextUrl.searchParams.get("scope") === "all") {
    if (!isSuperAdmin(user.role)) return NextResponse.json({ error: "Super-admins only." }, { status: 403 });
    return NextResponse.json({ all: getAllWatchlists() });
  }
  return NextResponse.json({ watchlist: getWatchlist(user.id), isSuperAdmin: isSuperAdmin(user.role) });
}

/** POST /api/watchlist { ticker, action:"add"|"remove" } */
export async function POST(req: NextRequest) {
  const gate = await requireHubUser(req);
  if ("response" in gate) return gate.response;
  const body = (await req.json().catch(() => ({}))) as { ticker?: string; action?: "add" | "remove" };
  if (!body.ticker) return NextResponse.json({ error: "Missing ticker" }, { status: 400 });
  const wl = setWatchlist(gate.user, body.ticker, body.action === "remove" ? "remove" : "add");
  return NextResponse.json({ watchlist: wl });
}
