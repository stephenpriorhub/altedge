/**
 * Real estate / properties (free — SEC 10-K "Item 2. Properties" + EDGAR full-text search).
 * Thesis: owned facilities, land and new-facility activity are a capex/expansion signal —
 * a company building or buying is investing in future capacity. Zero new cost: uses the same
 * EDGAR source as the filings connector. The 10-K Properties section is summarized by Claude
 * (cached 90 days — 10-Ks are annual).
 *
 * Caveat surfaced in the UI: corporate real estate is often titled to LLC subsidiaries, so
 * parcel-level ownership needs a paid provider (ATTOM/Regrid/Reonomy). This is the filings view.
 */
import Anthropic from "@anthropic-ai/sdk";
import { getJson, getText, classifyFailure } from "./http";
import { getCached, setCached } from "../store";
import { SYNTH_MODEL } from "../models";
import { result, type Connector, type DetailSection, type Metric } from "./types";

const meta = { id: "realestate", label: "Real Estate / Properties", category: "realestate", tier: "free" } as const;

interface Facility {
  location: string;
  address?: string;
  lat?: number;
  lng?: number;
  purpose: string;
  tenure: string; // owned | leased | mixed | unknown
  size?: string;
}

const mapsLink = (lat?: number, lng?: number, address?: string) =>
  lat != null && lng != null
    ? `https://www.google.com/maps/@${lat},${lng},17z/data=!3m1!1e3`
    : address
      ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`
      : undefined;
interface REData {
  headquarters: string;
  ownershipSummary: string;
  facilities: Facility[];
  expansionSignals: string[];
  summary: string;
  filingUrl: string;
  filingDate: string;
}

const TOOL = {
  name: "emit_real_estate",
  description:
    "Summarize a company's real-estate footprint. First identify its real facilities from the 10-K Properties text (owned vs leased, purpose, size). Then ENRICH each facility with its actual real-world street ADDRESS and WGS84 coordinates using your own knowledge of the company — this is expected and required, because 10-Ks almost never print street addresses. Prefer specific named sites (e.g. 'Gigafactory Texas', 'Fremont Factory') over vague regions, and give each a concrete address whenever you know it. Only leave an address blank if you genuinely don't know the site's location. Don't fabricate facilities that don't exist, but DO use outside knowledge for the addresses/coordinates of real ones. Also flag expansion/new-facility/land signals.",
  input_schema: {
    type: "object" as const,
    properties: {
      headquarters: { type: "string" },
      ownershipSummary: { type: "string", description: "Owned vs leased mix in one line." },
      facilities: {
        type: "array",
        items: {
          type: "object",
          properties: {
            location: { type: "string", description: "The location as described in the 10-K (city/region)." },
            address: { type: "string", description: "Real street address of this facility from your knowledge of the company's actual sites. Fill this whenever you know the location (a city-level address is acceptable if you don't know the exact street). Leave blank only if truly unknown." },
            lat: { type: "number", description: "Approximate WGS84 latitude, if known." },
            lng: { type: "number", description: "Approximate WGS84 longitude, if known." },
            purpose: { type: "string", description: "e.g. manufacturing, R&D, data center, retail, HQ, warehouse" },
            tenure: { type: "string", enum: ["owned", "leased", "mixed", "unknown"] },
            size: { type: "string", description: "square footage / acreage if stated" },
          },
          required: ["location", "purpose", "tenure"],
        },
      },
      expansionSignals: { type: "array", items: { type: "string" }, description: "New facilities, construction, land purchases, capacity additions mentioned." },
      summary: { type: "string", description: "1-2 sentence investor-relevant read of the footprint." },
    },
    required: ["headquarters", "ownershipSummary", "facilities", "expansionSignals", "summary"],
  },
};

async function latest10K(cik: string, signal: AbortSignal): Promise<{ url: string; date: string } | null> {
  const cik10 = cik.padStart(10, "0");
  const sub = await getJson<{ filings: { recent: { form: string[]; accessionNumber: string[]; primaryDocument: string[]; filingDate: string[] } } }>(
    `https://data.sec.gov/submissions/CIK${cik10}.json`,
    { signal }
  );
  const r = sub.filings?.recent;
  if (!r) return null;
  const idx = r.form.findIndex((f) => f === "10-K");
  if (idx < 0) return null;
  const acc = r.accessionNumber[idx].replace(/-/g, "");
  return {
    url: `https://www.sec.gov/Archives/edgar/data/${parseInt(cik, 10)}/${acc}/${r.primaryDocument[idx]}`,
    date: r.filingDate[idx],
  };
}

/** Longest "Item 2 Properties" → "Item 3 Legal" slice (skips the short table-of-contents entry). */
function extractProperties(html: string): string {
  const text = html.replace(/<[^>]+>/g, " ").replace(/&#?[a-z0-9]+;/gi, " ").replace(/\s+/g, " ");
  let best = "";
  const re = /item\s*2\.?\s*[.\s]*propert/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const tail = text.slice(m.index);
    const n = tail.search(/item\s*3\.?\s*[.\s]*legal/i);
    const seg = n > 0 ? tail.slice(0, n) : tail.slice(0, 6000);
    if (seg.length > best.length) best = seg;
  }
  return best.trim().slice(0, 9000);
}

export const realEstateConnector: Connector = {
  ...meta,
  enabled: true,
  description: "Owned/leased facilities, land and expansion signals from the company's SEC 10-K Properties section.",
  requiredIdentifiers: [],
  timeoutMs: 45_000, // 10-K fetch + Claude summary needs more than the default 18s
  async fetch(entity, ctx) {
    const start = Date.now();
    if (!entity.cik) return result(meta, { status: "not-applicable", note: "No SEC CIK — not an SEC registrant." });
    if (!process.env.ANTHROPIC_API_KEY) return result(meta, { status: "no-data", note: "Property summary requires ANTHROPIC_API_KEY.", tookMs: Date.now() - start });
    try {
      let data = getCached<REData>("realestate3", entity.ticker, 1000 * 60 * 60 * 24 * 90);
      if (!data) {
        const filing = await latest10K(entity.cik, ctx.signal);
        if (!filing) return result(meta, { status: "no-data", note: "No 10-K on file (may be a foreign filer with 20-F).", tookMs: Date.now() - start });
        const html = await getText(filing.url, { signal: ctx.signal, timeoutMs: 25_000 });
        const section = extractProperties(html);
        if (section.length < 60) return result(meta, { status: "no-data", note: "Could not locate the Properties section in the latest 10-K.", tookMs: Date.now() - start });

        const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
        const msg = await client.messages.create(
          {
            model: SYNTH_MODEL,
            max_tokens: 2500,
            tool_choice: { type: "tool", name: TOOL.name },
            tools: [TOOL],
            messages: [
              {
                role: "user",
                content: `Company: ${entity.companyName} (${entity.ticker}).\n\n10-K Item 2 Properties (source of which facilities exist):\n${section}\n\nList the company's real facilities from this text, then enrich EACH with its real street address and WGS84 lat/lng from your knowledge of ${entity.companyName}'s actual sites (HQ, plants, gigafactories, major offices, DCs). Fill the address field wherever you know the location.`,
              },
            ],
          },
          { signal: ctx.signal }
        );
        const tool = msg.content.find((b) => b.type === "tool_use");
        const out = (tool && "input" in tool ? tool.input : {}) as Partial<REData>;
        data = {
          headquarters: out.headquarters ?? "—",
          ownershipSummary: out.ownershipSummary ?? "",
          facilities: Array.isArray(out.facilities) ? out.facilities : [],
          expansionSignals: Array.isArray(out.expansionSignals) ? out.expansionSignals : [],
          summary: out.summary ?? "",
          filingUrl: filing.url,
          filingDate: filing.date,
        };
        if (data.facilities.length || data.summary) setCached("realestate3", entity.ticker, data);
      }

      const owned = data.facilities.filter((f) => f.tenure === "owned").length;
      const leased = data.facilities.filter((f) => f.tenure === "leased").length;

      const metrics: Metric[] = [
        { name: "Headquarters", value: data.headquarters },
        { name: "Facilities cited", value: data.facilities.length },
        { name: "Owned / Leased", value: `${owned} / ${leased}` },
        { name: "Expansion flags", value: data.expansionSignals.length, trend: data.expansionSignals.length ? "up" : undefined },
      ];

      const detail: DetailSection[] = [];
      if (data.facilities.length)
        detail.push({
          kind: "table",
          title: "Facilities (from 10-K, addresses best-effort)",
          columns: [{ label: "Location" }, { label: "Address" }, { label: "Purpose" }, { label: "Tenure" }, { label: "Size" }],
          rows: data.facilities.map((f) => ({
            cells: [f.location, f.address ?? "—", f.purpose, f.tenure, f.size ?? "—"],
            href: mapsLink(f.lat, f.lng, f.address),
            hrefLabel: "🛰 View",
          })),
          note: "10-Ks describe locations broadly; addresses/coordinates are best-known enrichments (reliable for HQs & major plants). Parcel-level ownership needs ATTOM/Regrid/Reonomy.",
        });
      if (data.expansionSignals.length)
        detail.push({ kind: "keyvals", title: "Expansion / new-facility signals", items: data.expansionSignals.map((s, i) => ({ label: `#${i + 1}`, value: s })) });
      detail.push({
        kind: "keyvals",
        title: "Footprint",
        items: [
          { label: "HQ", value: data.headquarters },
          { label: "Ownership", value: data.ownershipSummary || "—" },
          { label: "Source", value: `10-K filed ${data.filingDate}` },
        ],
      });
      detail.push({
        kind: "keyvals",
        title: "Parcel-level ownership (not in this view)",
        items: [
          { label: "Note", value: "Corporate property is often titled to LLC subsidiaries." },
          { label: "For parcels/new deeds", value: "wire ATTOM / Regrid / Reonomy (paid)" },
        ],
      });
      detail.push({ kind: "links", title: "Source filing", links: [{ label: `10-K (${data.filingDate})`, url: data.filingUrl }] });

      return result(meta, {
        status: "ok",
        headline: data.summary || `${data.facilities.length} facilities cited in the latest 10-K; ${data.expansionSignals.length} expansion signal(s).`,
        metrics,
        evidence: data.expansionSignals.slice(0, 3).map((s) => ({ summary: s })),
        detail,
        primaryLink: { label: `Latest 10-K (${data.filingDate})`, url: data.filingUrl },
        tookMs: Date.now() - start,
      });
    } catch (e) {
      return result(meta, { ...classifyFailure(e), tookMs: Date.now() - start });
    }
  },
};
