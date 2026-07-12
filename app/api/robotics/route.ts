import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireHubUser } from "@/lib/hub-auth";
import {
  ROLE_LABEL,
  shadowdataTickerFor,
  cleanCompanyName,
  exchangeLabel,
  getAtlasCompanies,
  getAtlasFunding,
  getAtlasRelationships,
  robotName,
  type AtlasCompanyLite,
  type AtlasEntityType,
} from "@/lib/robotics-atlas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export interface RoboticsWatchItem {
  id: string;
  name: string; // clean company name
  ticker: string; // as listed (may carry exchange suffix)
  exchange: string | null; // human label for foreign listings
  shadowdataTicker: string | null; // deep-linkable ShadowData symbol, or null
  type: AtlasEntityType;
  role: string;
  country: string;
  tie: string; // one-line "how it's tied to robotics"
  valuationM: number | null;
}

const TYPE_ORDER: Record<AtlasEntityType, number> = {
  oem: 0,
  ai_compute: 1,
  component_maker: 2,
  raw_material: 3,
};

/**
 * GET /api/robotics → every publicly-traded company in the Humanoid Atlas, with a one-line
 * tie to robotics, valuation, and (when tradeable in the US) a deep-link symbol into its
 * ShadowData profile. Split client-side into US-tradeable vs global-listed.
 */
export async function GET(req: NextRequest) {
  const gate = await requireHubUser(req);
  if ("response" in gate) return gate.response;

  try {
    const [companies, relationships, funding] = await Promise.all([
      getAtlasCompanies(),
      getAtlasRelationships(),
      getAtlasFunding(),
    ]);

    // Index supply-chain edges by company for tie summaries.
    const inbound = new Map<string, typeof relationships>(); // to.id  → edges (its suppliers)
    const outbound = new Map<string, typeof relationships>(); // from.id → edges (its customers)
    const push = (m: Map<string, typeof relationships>, k: string, r: (typeof relationships)[number]) => {
      const arr = m.get(k);
      if (arr) arr.push(r);
      else m.set(k, [r]);
    };
    for (const r of relationships) {
      push(inbound, r.to.id, r);
      push(outbound, r.from.id, r);
    }

    const tieFor = (c: AtlasCompanyLite): string => {
      if (c.type === "oem") {
        const robot = robotName(c.name);
        const nSup = inbound.get(c.id)?.length ?? 0;
        return (
          `Builds the ${robot ?? "company's"} humanoid robot` +
          (nSup ? ` — ${nSup} mapped component supplier${nSup === 1 ? "" : "s"}.` : ".")
        );
      }
      const outs = outbound.get(c.id) ?? [];
      const oemNames = [...new Set(outs.map((r) => cleanCompanyName(r.to.name)))];
      const components = [...new Set(outs.map((r) => r.component).filter(Boolean) as string[])];
      if (!oemNames.length) {
        return c.description ? c.description.slice(0, 140) : `${ROLE_LABEL[c.type]} in the humanoid supply chain.`;
      }
      const compStr = components.length ? components.slice(0, 2).join(", ") : "components";
      const oemStr = oemNames.slice(0, 3).join(", ") + (oemNames.length > 3 ? `, +${oemNames.length - 3} more` : "");
      return `Supplies ${compStr} to ${oemNames.length} humanoid program${oemNames.length === 1 ? "" : "s"}: ${oemStr}.`;
    };

    const items: RoboticsWatchItem[] = companies
      .filter((c) => c.ticker)
      .map((c) => ({
        id: c.id,
        name: cleanCompanyName(c.name),
        ticker: c.ticker!.toUpperCase(),
        exchange: exchangeLabel(c.ticker!),
        shadowdataTicker: shadowdataTickerFor(c),
        type: c.type,
        role: ROLE_LABEL[c.type] ?? "Robotics company",
        country: c.country,
        tie: tieFor(c),
        valuationM: funding[c.id]?.latestValuationM ?? null,
      }))
      .sort((a, b) => {
        // Tradeable-here first, then OEM→supplier, then by valuation desc, then name.
        const link = Number(!!b.shadowdataTicker) - Number(!!a.shadowdataTicker);
        if (link) return link;
        const t = TYPE_ORDER[a.type] - TYPE_ORDER[b.type];
        if (t) return t;
        const v = (b.valuationM ?? 0) - (a.valuationM ?? 0);
        if (v) return v;
        return a.name.localeCompare(b.name);
      });

    return NextResponse.json({
      items,
      counts: {
        total: items.length,
        tradeable: items.filter((i) => i.shadowdataTicker).length,
      },
      source: "Humanoid Atlas · Humanoids.FYI",
      generatedAt: new Date().toISOString(),
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to load robotics watchlist" },
      { status: 502 }
    );
  }
}
