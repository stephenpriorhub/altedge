/**
 * Workforce / headcount (People Data Labs Company Enrichment API). Thesis: total
 * headcount and its trend are a core fundamental — sustained growth signals expansion,
 * contraction signals cost-cutting/trouble. The geographic split shows where a company
 * is actually scaling.
 *
 * PDL returns the CURRENT employee_count + employee_count_by_country (this plan has no
 * built-in history), so the headcount TREND is accrued from AltEdge's per-scan snapshots
 * — it fills in as the ticker is re-scanned over time. Credit-metered → cached 7 days.
 */
import { getJson, classifyFailure } from "./http";
import { getCached, setCached, getSnapshots } from "../store";
import { result, type Connector, type DetailSection, type Metric, type Timeseries } from "./types";

const meta = {
  id: "workforce",
  label: "Workforce / Headcount",
  category: "hiring",
  tier: "premium",
} as const;

const CACHE_NS = "workforce";
const CACHE_TTL = 1000 * 60 * 60 * 24 * 7; // 7 days

interface PDLCompany {
  name?: string;
  display_name?: string;
  employee_count?: number;
  employee_count_by_country?: Record<string, number>;
  size?: string;
  industry?: string;
  founded?: number;
  linkedin_url?: string;
  total_funding_raised?: number;
}

async function enrich(params: Record<string, string>, key: string, signal: AbortSignal): Promise<PDLCompany | null> {
  const q = new URLSearchParams({ ...params, min_likelihood: "2" }).toString();
  const data = await getJson<{ status?: number; employee_count?: number } & PDLCompany>(
    `https://api.peopledatalabs.com/v5/company/enrich?${q}`,
    { signal, headers: { "X-Api-Key": key }, timeoutMs: 15_000 }
  );
  return data && (data.employee_count || data.name) ? data : null;
}

/** Headcount time series from prior scan snapshots (current not yet persisted). */
function headcountTrend(ticker: string, current: number, now: Date): { ts?: Timeseries; delta?: number } {
  const points: { t: string; v: number }[] = [];
  for (const snap of getSnapshots(ticker)) {
    const sig = snap.signals.find((s) => s.connectorId === "workforce" && s.status === "ok");
    const m = sig?.metrics?.[0];
    if (m && typeof m.value === "number") points.push({ t: snap.takenAt.slice(0, 10), v: m.value });
  }
  points.push({ t: now.toISOString().slice(0, 10), v: current });
  const byDay = new Map<string, number>();
  for (const p of points) byDay.set(p.t, p.v);
  const merged = [...byDay.entries()].sort().map(([t, v]) => ({ t, v }));
  const delta = merged.length >= 2 ? merged[merged.length - 1].v - merged[merged.length - 2].v : undefined;
  return { ts: merged.length >= 2 ? { name: "Headcount per scan (trend builds over time)", points: merged } : undefined, delta };
}

export const workforceConnector: Connector = {
  ...meta,
  enabled: true,
  description: "Total employee headcount, geographic distribution and headcount trend (People Data Labs).",
  requiredIdentifiers: [],
  async fetch(entity, ctx) {
    const start = Date.now();
    const key = process.env.PDL_API_KEY;
    if (!key) {
      return result(meta, { status: "no-data", note: "Set PDL_API_KEY (People Data Labs) to enable headcount data.", tookMs: Date.now() - start });
    }
    try {
      let company = getCached<PDLCompany>(CACHE_NS, entity.ticker, CACHE_TTL);
      if (!company) {
        const params: Record<string, string> = { ticker: entity.ticker };
        if (entity.identifiers.domain) params.website = entity.identifiers.domain;
        if (entity.companyName) params.name = entity.companyName;
        company = await enrich(params, key, ctx.signal);
        if (company) setCached(CACHE_NS, entity.ticker, company);
      }
      if (!company || !company.employee_count) {
        return result(meta, { status: "no-data", note: `No headcount record matched ${entity.ticker}.`, tookMs: Date.now() - start });
      }

      const headcount = company.employee_count;
      const byCountry = company.employee_count_by_country ?? {};
      const countries = Object.entries(byCountry).sort((a, b) => b[1] - a[1]);
      const { ts, delta } = headcountTrend(entity.ticker, headcount, ctx.now);

      const metrics: Metric[] = [{ name: "Headcount", value: headcount }];
      if (delta !== undefined) metrics.push({ name: "vs last scan", value: `${delta >= 0 ? "+" : ""}${delta.toLocaleString()}`, trend: delta > 0 ? "up" : delta < 0 ? "down" : "flat" });
      if (countries[0]) metrics.push({ name: "Top country", value: `${countries[0][0]} (${((countries[0][1] / headcount) * 100).toFixed(0)}%)` });
      if (countries.length) metrics.push({ name: "Countries", value: countries.length });

      const detail: DetailSection[] = [];
      if (ts) detail.push({ kind: "timeseries", title: "Headcount trend", series: ts, note: "Builds as you re-scan this ticker (PDL gives current headcount; AltEdge accrues the history)." });
      if (countries.length)
        detail.push({
          kind: "bars",
          title: "Headcount by country",
          unit: "employees",
          items: countries.slice(0, 12).map(([c, n]) => ({ label: c.replace(/\b\w/g, (m) => m.toUpperCase()), value: n })),
          note: "Where the workforce actually sits — shifts here reveal where the company is scaling.",
        });
      detail.push({
        kind: "keyvals",
        title: "Company",
        items: [
          { label: "Industry", value: company.industry ?? "—" },
          { label: "Size bucket", value: company.size ?? "—" },
          { label: "Founded", value: company.founded ?? "—" },
          ...(company.total_funding_raised ? [{ label: "Funding raised", value: `$${(company.total_funding_raised / 1e6).toFixed(0)}M` }] : []),
        ],
      });
      if (company.linkedin_url) detail.push({ kind: "links", title: "Source", links: [{ label: "LinkedIn company page", url: company.linkedin_url.startsWith("http") ? company.linkedin_url : `https://${company.linkedin_url}` }] });

      return result(meta, {
        status: "ok",
        headline:
          delta !== undefined
            ? `${headcount.toLocaleString()} employees (${delta >= 0 ? "+" : ""}${delta.toLocaleString()} vs last scan)${countries[0] ? `; largest in ${countries[0][0]}` : ""}.`
            : `${headcount.toLocaleString()} employees${countries[0] ? `, largest presence in ${countries[0][0]}` : ""}.`,
        metrics,
        timeseries: ts ? [ts] : undefined,
        evidence: countries.slice(0, 5).map(([c, n]) => ({ summary: `${c.replace(/\b\w/g, (m) => m.toUpperCase())}: ${n.toLocaleString()} employees` })),
        detail,
        primaryLink: company.linkedin_url ? { label: "LinkedIn company page", url: company.linkedin_url.startsWith("http") ? company.linkedin_url : `https://${company.linkedin_url}` } : undefined,
        tookMs: Date.now() - start,
      });
    } catch (e) {
      return result(meta, { ...classifyFailure(e), tookMs: Date.now() - start });
    }
  },
};
