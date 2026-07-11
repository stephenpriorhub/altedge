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
  purpose: string;
  tenure: string; // owned | leased | mixed | unknown
  size?: string;
}
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
    "Summarize a company's real-estate footprint from its 10-K Properties section. Extract concrete facilities (location, purpose, owned vs leased, size if given) and flag any expansion/new-facility/land-acquisition signals. Do not invent facilities not in the text.",
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
            location: { type: "string" },
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
  async fetch(entity, ctx) {
    const start = Date.now();
    if (!entity.cik) return result(meta, { status: "not-applicable", note: "No SEC CIK — not an SEC registrant." });
    if (!process.env.ANTHROPIC_API_KEY) return result(meta, { status: "no-data", note: "Property summary requires ANTHROPIC_API_KEY.", tookMs: Date.now() - start });
    try {
      let data = getCached<REData>("realestate", entity.ticker, 1000 * 60 * 60 * 24 * 90);
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
            max_tokens: 1500,
            tool_choice: { type: "tool", name: TOOL.name },
            tools: [TOOL],
            messages: [{ role: "user", content: `${entity.companyName} (${entity.ticker}) — 10-K Item 2 Properties:\n\n${section}` }],
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
        if (data.facilities.length || data.summary) setCached("realestate", entity.ticker, data);
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
          title: "Facilities (from 10-K)",
          columns: [{ label: "Location" }, { label: "Purpose" }, { label: "Tenure" }, { label: "Size" }],
          rows: data.facilities.map((f) => ({ cells: [f.location, f.purpose, f.tenure, f.size ?? "—"] })),
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
