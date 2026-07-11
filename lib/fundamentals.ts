/**
 * Key fundamentals + earnings for the ticker home page (Unusual Whales).
 * UW /stock/{t}/info → market cap, beta, sector, NEXT earnings date.
 * UW /stock/{t}/earnings → historical quarters (estimated vs reported EPS, surprise).
 * Cached 1 day per ticker (UW is metered). UW is Cloudflare-fronted → needs a browser UA.
 */
import { getJson } from "./connectors/http";
import { getCached, setCached } from "./store";

export const UW_BASE = "https://api.unusualwhales.com";
export const UW_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36";

export interface EarningsRow {
  reportDate: string;
  fiscalPeriod: string;
  estimatedEps: number | null;
  reportedEps: number | null;
  surprisePct: number | null;
  reportTime: string | null;
}
export interface Fundamentals {
  marketCap?: number;
  beta?: number;
  sector?: string;
  nextEarningsDate?: string;
  announceTime?: string;
  sharesOutstanding?: number;
  avg30Volume?: number;
  history: EarningsRow[];
}

const num = (v: unknown): number | undefined => {
  if (v == null || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

function uwHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${process.env.UNUSUAL_WHALES_KEY}`, "User-Agent": UW_UA };
}

export async function getFundamentals(ticker: string): Promise<Fundamentals | null> {
  if (!process.env.UNUSUAL_WHALES_KEY) return null;
  const t = ticker.toUpperCase();
  const cached = getCached<Fundamentals>("fundamentals", t, 1000 * 60 * 60 * 24);
  if (cached) return cached;

  const signal = AbortSignal.timeout(15_000);
  const [info, earnings] = await Promise.allSettled([
    getJson<{ data: Record<string, string> }>(`${UW_BASE}/api/stock/${t}/info`, { headers: uwHeaders(), signal }),
    getJson<{ data: Record<string, unknown>[] }>(`${UW_BASE}/api/stock/${t}/earnings`, { headers: uwHeaders(), signal }),
  ]);
  if (info.status !== "fulfilled" && earnings.status !== "fulfilled") return null;

  const d = info.status === "fulfilled" ? info.value.data : {};
  const rows = earnings.status === "fulfilled" ? earnings.value.data ?? [] : [];

  const history: EarningsRow[] = rows
    .map((r) => ({
      reportDate: String(r.report_date ?? ""),
      fiscalPeriod: String(r.fiscal_date_ending ?? ""),
      estimatedEps: num(r.estimated_eps) ?? null,
      reportedEps: num(r.reported_eps) ?? null,
      surprisePct: num(r.surprise_percentage) ?? null,
      reportTime: (r.report_time as string) ?? null,
    }))
    .filter((r) => r.reportDate && r.reportedEps != null)
    .sort((a, b) => b.reportDate.localeCompare(a.reportDate))
    .slice(0, 8);

  const result: Fundamentals = {
    marketCap: num(d.marketcap),
    beta: num(d.beta),
    sector: d.sector || undefined,
    nextEarningsDate: d.next_earnings_date || undefined,
    announceTime: d.announce_time || undefined,
    sharesOutstanding: num(d.outstanding),
    avg30Volume: num(d.avg30_volume),
    history,
  };
  setCached("fundamentals", t, result);
  return result;
}
