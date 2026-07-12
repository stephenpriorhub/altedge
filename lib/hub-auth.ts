/**
 * OxfordHub user identification (mirrors promo-analyzer/lib/hub-auth.ts).
 *
 * Mechanism: the hub session cookie is domain-scoped to .oxfordhub.app, so the
 * browser sends it with every request to shadowdata.oxfordhub.app. We forward it
 * server-side to the hub's /api/me to resolve {id, email, name, role}.
 *
 * ShadowData is read-only decision-support with no mutations, so routes only need
 * "is this a signed-in, authorized hub user?" — enforced by requireHubUser().
 * Fail-closed: if the hub is unreachable or the cookie is invalid, access is
 * denied (reads here still cost external API calls, so we gate them).
 */

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

const HUB_PROJECT_ID = process.env.NEXT_PUBLIC_HUB_PROJECT_ID || "shadowdata";
const HUB_ME_URL =
  (process.env.HUB_URL ?? "https://oxfordhub.app") + `/api/me?projectId=${HUB_PROJECT_ID}`;

export type HubRole = "super_admin" | "exec_admin" | "admin" | "user";

export interface HubUser {
  id: string;
  email: string;
  name: string | null;
  role: HubRole;
}

/** Scripted/cron bypass: `x-hub-token: HUB_API_TOKEN` acts as an admin service identity. */
function serviceUser(req: NextRequest): HubUser | null {
  const token = req.headers.get("x-hub-token");
  const expected = process.env.HUB_API_TOKEN;
  if (!token || !expected || token !== expected) return null;
  return { id: "service", email: "service@oxfordhub.app", name: "Service", role: "admin" };
}

/** Resolve the requesting user by forwarding their hub session cookie. Null = not signed in / hub unreachable. */
export async function getHubUser(req: NextRequest): Promise<HubUser | null> {
  const svc = serviceUser(req);
  if (svc) return svc;
  const cookie = req.headers.get("cookie");
  if (!cookie) return null;
  try {
    const res = await fetch(HUB_ME_URL, {
      headers: { cookie },
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      authenticated?: boolean;
      authorized?: boolean;
      user?: HubUser;
    };
    return data.authenticated && data.authorized && data.user ? data.user : null;
  } catch {
    return null;
  }
}

/**
 * Gate helper for route handlers. On localhost we fail OPEN so the app is easy to
 * develop without a hub session; in production we fail CLOSED.
 * Returns the user (or a dev stub) on success, or a 401 NextResponse to return.
 */
export async function requireHubUser(
  req: NextRequest
): Promise<{ user: HubUser } | { response: NextResponse }> {
  const user = await getHubUser(req);
  if (user) return { user };

  const isLocalhost =
    process.env.NODE_ENV !== "production" ||
    req.nextUrl.hostname === "localhost" ||
    req.nextUrl.hostname === "127.0.0.1";
  if (isLocalhost) {
    return { user: { id: "dev", email: "dev@localhost", name: "Dev", role: "admin" } };
  }
  return {
    response: NextResponse.json(
      { error: "Sign in to OxfordHub to use ShadowData." },
      { status: 401 }
    ),
  };
}
