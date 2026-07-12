import { NextResponse } from "next/server";
import { CONNECTORS } from "@/lib/connectors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Railway healthcheck + a quick view of which capabilities are configured. */
export async function GET() {
  return NextResponse.json({
    ok: true,
    service: "shadowdata",
    env: {
      anthropic: !!process.env.ANTHROPIC_API_KEY,
      polygon: !!process.env.POLYGON_API_KEY,
      github: !!process.env.GITHUB_TOKEN,
      uspto: !!(process.env.USPTO_API_KEY || process.env.PATENTSVIEW_API_KEY),
    },
    connectors: CONNECTORS.map((c) => ({
      id: c.id,
      label: c.label,
      category: c.category,
      tier: c.tier,
      enabled: c.enabled,
    })),
  });
}
