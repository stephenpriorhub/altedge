/**
 * Options flow (Unusual Whales). Thesis: large/unusual options premium is a read on how
 * institutional "smart money" is positioning — a lean toward call premium is bullish
 * positioning, toward puts bearish. Short-term catalyst-oriented signal.
 *
 * UW is Cloudflare-fronted → requires a browser User-Agent. Env UNUSUAL_WHALES_KEY. Cached 1h.
 */
import { getJson, classifyFailure } from "./http";
import { getCached, setCached } from "../store";
import { UW_BASE, UW_UA } from "../fundamentals";
import { result, type Connector, type DetailSection, type Evidence, type Metric } from "./types";

const meta = { id: "options-flow", label: "Options Flow (Smart Money)", category: "options", tier: "premium" } as const;

interface Alert {
  type?: string;
  created_at?: string;
  price?: string;
  volume?: number;
  open_interest?: number;
  expiry?: string;
  strike?: string;
  underlying_price?: string;
  total_premium?: string;
  option_chain?: string;
}

/** Parse call/put from an OCC option symbol like AAPL270115C00300000. */
function cpOf(chain?: string): "C" | "P" | null {
  const m = (chain ?? "").match(/\d{6}([CP])\d{8}$/);
  return m ? (m[1] as "C" | "P") : null;
}

export const optionsFlowConnector: Connector = {
  ...meta,
  enabled: true,
  description: "Unusual options premium and call/put lean — how institutional flow is positioning.",
  requiredIdentifiers: [],
  async fetch(entity, ctx) {
    const start = Date.now();
    if (!process.env.UNUSUAL_WHALES_KEY) {
      return result(meta, { status: "no-data", note: "Set UNUSUAL_WHALES_KEY to enable options flow.", tookMs: Date.now() - start });
    }
    try {
      const t = entity.ticker.toUpperCase();
      let alerts = getCached<Alert[]>("uw-flow", t, 1000 * 60 * 60);
      if (!alerts) {
        const data = await getJson<{ data: Alert[] }>(`${UW_BASE}/api/stock/${t}/flow-alerts`, {
          signal: ctx.signal,
          headers: { Authorization: `Bearer ${process.env.UNUSUAL_WHALES_KEY}`, "User-Agent": UW_UA },
          timeoutMs: 15_000,
        });
        alerts = data.data ?? [];
        if (alerts.length) setCached("uw-flow", t, alerts);
      }
      if (!alerts.length) {
        return result(meta, { status: "no-data", note: "No recent unusual options flow for this ticker.", tookMs: Date.now() - start });
      }

      let callPrem = 0;
      let putPrem = 0;
      for (const a of alerts) {
        const prem = Number(a.total_premium) || 0;
        const cp = cpOf(a.option_chain);
        if (cp === "C") callPrem += prem;
        else if (cp === "P") putPrem += prem;
      }
      const totalPrem = callPrem + putPrem;
      const callPct = totalPrem > 0 ? (callPrem / totalPrem) * 100 : 50;
      const lean = callPct >= 60 ? "Bullish" : callPct <= 40 ? "Bearish" : "Mixed";

      const fmt$ = (n: number) => (n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : `$${Math.round(n).toLocaleString()}`);
      const metrics: Metric[] = [
        { name: "Flow lean", value: `${lean} (${callPct.toFixed(0)}% calls)`, trend: lean === "Bullish" ? "up" : lean === "Bearish" ? "down" : "flat" },
        { name: "Alerts", value: alerts.length },
        { name: "Total premium", value: fmt$(totalPrem) },
      ];

      const top = alerts
        .slice()
        .sort((a, b) => (Number(b.total_premium) || 0) - (Number(a.total_premium) || 0))
        .slice(0, 12);
      const detail: DetailSection[] = [
        {
          kind: "table",
          title: "Largest recent options trades",
          columns: [{ label: "Date" }, { label: "C/P" }, { label: "Strike" }, { label: "Expiry" }, { label: "Premium", align: "right" }, { label: "Vol", align: "right" }],
          rows: top.map((a) => ({
            cells: [(a.created_at ?? "").slice(0, 10), cpOf(a.option_chain) ?? "—", a.strike ?? "—", a.expiry ?? "—", fmt$(Number(a.total_premium) || 0), a.volume ?? 0],
          })),
          note: "Large call premium = bullish positioning; large put premium = hedging/bearish.",
        },
        { kind: "keyvals", title: "Premium split", items: [{ label: "Call premium", value: fmt$(callPrem) }, { label: "Put premium", value: fmt$(putPrem) }] },
      ];

      const evidence: Evidence[] = top.slice(0, 4).map((a) => ({
        summary: `${cpOf(a.option_chain) ?? "?"} $${a.strike} exp ${a.expiry} — ${fmt$(Number(a.total_premium) || 0)} premium`,
        sourceDate: a.created_at,
      }));

      return result(meta, {
        status: "ok",
        headline: `${lean} options positioning — ${callPct.toFixed(0)}% of ${fmt$(totalPrem)} premium is calls across ${alerts.length} unusual trades.`,
        metrics,
        evidence,
        detail,
        primaryLink: { label: "Unusual Whales", url: `https://unusualwhales.com/stock/${t}` },
        tookMs: Date.now() - start,
      });
    } catch (e) {
      return result(meta, { ...classifyFailure(e), tookMs: Date.now() - start });
    }
  },
};
