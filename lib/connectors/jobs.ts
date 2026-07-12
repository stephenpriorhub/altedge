/**
 * Hiring signal. Thesis: open-role volume and department mix are a real-time read on
 * where a company is investing; the trend over time is a leading headcount indicator.
 *
 * Coverage strategy:
 *  1. Greenhouse + Lever public boards (free, no key) → FULL open-role counts + departments.
 *     Best data, but only companies that use these ATSes (skews startup/mid-market tech).
 *  2. Fallback: Google Jobs via SearchApi → universal coverage (Tesla, Apple, etc. that run
 *     their own ATS). Returns a SAMPLE of active roles (not a precise total).
 *
 * Hiring TREND: ShadowData snapshots every scan, so we plot the recorded role count across past
 * scans — it becomes a real time series as scans accrue. (Precise hiring-volume history for
 * own-ATS companies, and true headcount/attrition, need a paid workforce API — Coresignal/PDL/Revelio.)
 */
import { getJson, HttpError, classifyFailure } from "./http";
import { getCached, setCached, getSnapshots } from "../store";
import { result, type Connector, type DetailSection, type Evidence, type Metric, type Timeseries } from "./types";

const meta = {
  id: "jobs",
  label: "Hiring / Job Postings",
  category: "hiring",
  tier: "free",
} as const;

const DAY = 1000 * 60 * 60 * 24;
const GJ_CACHE_NS = "google-jobs";
const GJ_TTL = 1000 * 60 * 60 * 12; // 12h

interface Role {
  title: string;
  department: string;
  url?: string;
  postedAt?: string;
}

function inferDept(title: string): string {
  if (/engineer|developer|software|data|\bml\b|infra|scientist|architect/i.test(title)) return "Engineering";
  if (/sales|account|advisor|marketing|growth|revenue|delivery|customer|retail|store/i.test(title)) return "Sales & Customer";
  if (/operations|supply|logistics|manufactur|technician|production|warehouse/i.test(title)) return "Operations";
  if (/finance|legal|people|hr|recruit|talent/i.test(title)) return "G&A";
  return "Other";
}

async function greenhouse(slug: string, signal: AbortSignal): Promise<Role[]> {
  const data = await getJson<{ departments: { name: string; jobs: { title: string; absolute_url: string; updated_at: string }[] }[] }>(
    `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(slug)}/departments`,
    { signal }
  );
  const roles: Role[] = [];
  for (const d of data.departments ?? []) for (const j of d.jobs ?? []) roles.push({ title: j.title, department: d.name || "Other", url: j.absolute_url, postedAt: j.updated_at });
  return roles;
}

async function lever(slug: string, signal: AbortSignal): Promise<Role[]> {
  const data = await getJson<{ text: string; categories?: { team?: string }; hostedUrl: string; createdAt?: number }[]>(
    `https://api.lever.co/v0/postings/${encodeURIComponent(slug)}?mode=json`,
    { signal }
  );
  return (data ?? []).map((p) => ({ title: p.text, department: p.categories?.team || "Other", url: p.hostedUrl, postedAt: p.createdAt ? new Date(p.createdAt).toISOString() : undefined }));
}

interface GJob {
  title?: string;
  company_name?: string;
  location?: string;
  via?: string;
  sharing_link?: string;
  apply_link?: string;
  detected_extensions?: { posted_at?: string };
}
async function googleJobs(term: string, key: string, signal: AbortSignal): Promise<Role[]> {
  const cached = getCached<Role[]>(GJ_CACHE_NS, term, GJ_TTL);
  if (cached && cached.length) return cached;
  // Query the company name directly (adding "careers" pulls in staffing-agency spam).
  const url = `https://www.searchapi.io/api/v1/search?engine=google_jobs&q=${encodeURIComponent(term)}&api_key=${encodeURIComponent(key)}`;
  const data = await getJson<{ jobs?: GJob[] }>(url, { signal, timeoutMs: 15_000 });
  const tok = term.toLowerCase().replace(/[^a-z0-9 ]/g, "").split(" ").filter(Boolean)[0] ?? "";
  // Keep only roles actually posted by this employer (company_name contains the brand token).
  const roles: Role[] = (data.jobs ?? [])
    .filter((j) => !tok || (j.company_name ?? "").toLowerCase().includes(tok))
    .map((j) => ({ title: j.title ?? "Role", department: inferDept(j.title ?? ""), url: j.sharing_link || j.apply_link, postedAt: undefined }));
  if (roles.length) setCached(GJ_CACHE_NS, term, roles); // never cache empties
  return roles;
}

/** Build an open-roles time series from prior scan snapshots (current not yet persisted). */
function hiringTrend(ticker: string, currentCount: number, now: Date): { ts?: Timeseries; deltaVsLast?: number } {
  const points: { t: string; v: number }[] = [];
  for (const snap of getSnapshots(ticker)) {
    const jobsSig = snap.signals.find((s) => s.connectorId === "jobs" && s.status === "ok");
    const m = jobsSig?.metrics?.[0];
    if (m && typeof m.value === "number") points.push({ t: snap.takenAt.slice(0, 10), v: m.value });
  }
  points.push({ t: now.toISOString().slice(0, 10), v: currentCount });
  // keep last value per day
  const byDay = new Map<string, number>();
  for (const p of points) byDay.set(p.t, p.v);
  const merged = [...byDay.entries()].sort().map(([t, v]) => ({ t, v }));
  const deltaVsLast = merged.length >= 2 ? merged[merged.length - 1].v - merged[merged.length - 2].v : undefined;
  return { ts: merged.length >= 2 ? { name: "Open roles per scan (trend builds over time)", points: merged } : undefined, deltaVsLast };
}

export const jobsConnector: Connector = {
  ...meta,
  enabled: true,
  description: "Open-role volume, department mix and hiring trend (Greenhouse/Lever full counts, or Google Jobs sample).",
  requiredIdentifiers: [],
  async fetch(entity, ctx) {
    const start = Date.now();
    const { greenhouseSlug, leverSlug } = entity.identifiers;
    const term = (entity.identifiers.brandTerms?.[0]?.trim() || entity.companyName)
      .replace(/,?\s*(inc|corp|corporation|ltd|plc|co|holdings|group)\.?$/i, "")
      .trim();

    // ── 1. Structured boards (full counts) ──
    const roles: Role[] = [];
    let source: "ats" | "google" | null = null;
    const softErrors: string[] = [];
    const tryBoard = async (fn: Promise<Role[]>, name: string) => {
      try {
        roles.push(...(await fn));
      } catch (e) {
        if (!(e instanceof HttpError && (e.status === 404 || e.status === 403))) softErrors.push(`${name}: ${e instanceof Error ? e.message : e}`);
      }
    };
    if (greenhouseSlug) await tryBoard(greenhouse(greenhouseSlug, ctx.signal), "greenhouse");
    if (leverSlug) await tryBoard(lever(leverSlug, ctx.signal), "lever");
    if (roles.length) source = "ats";

    // ── 2. Google Jobs fallback (universal coverage) ──
    let sampled = false;
    if (!source) {
      const key = process.env.SEARCHAPI_KEY;
      if (key) {
        try {
          const g = await googleJobs(term, key, ctx.signal);
          if (g.length) {
            roles.push(...g);
            source = "google";
            sampled = true;
          }
        } catch (e) {
          softErrors.push(`google-jobs: ${e instanceof Error ? e.message : e}`);
        }
      }
    }

    if (roles.length === 0) {
      return result(meta, {
        status: softErrors.length ? "error" : "no-data",
        error: softErrors.length ? softErrors.join("; ") : undefined,
        note: softErrors.length ? undefined : "No open roles found on Greenhouse, Lever, or Google Jobs for this company.",
        tookMs: Date.now() - start,
      });
    }

    const byDept = new Map<string, number>();
    for (const r of roles) byDept.set(r.department, (byDept.get(r.department) ?? 0) + 1);
    const topDepts = [...byDept.entries()].sort((a, b) => b[1] - a[1]);
    const eng = byDept.get("Engineering") ?? 0;
    const gtm = byDept.get("Sales & Customer") ?? 0;
    const now = ctx.now.getTime();
    const recent = roles.filter((r) => r.postedAt && now - new Date(r.postedAt).getTime() <= 30 * DAY);

    const { ts, deltaVsLast } = hiringTrend(entity.ticker, roles.length, ctx.now);

    const countLabel = sampled ? "Roles (sample)" : "Open roles";
    const metrics: Metric[] = [
      { name: countLabel, value: roles.length },
      { name: "Engineering", value: eng },
      { name: "Sales & Customer", value: gtm },
    ];
    if (deltaVsLast !== undefined)
      metrics.push({ name: "vs last scan", value: `${deltaVsLast >= 0 ? "+" : ""}${deltaVsLast}`, trend: deltaVsLast > 0 ? "up" : deltaVsLast < 0 ? "down" : "flat" });
    else if (!sampled && recent.length)
      metrics.push({ name: "Posted (30d)", value: recent.length, trend: "up" });

    const detail: DetailSection[] = [];
    if (ts) detail.push({ kind: "timeseries", title: "Hiring trend — open roles per scan", series: ts, note: "Builds as you re-scan this ticker over days/weeks." });
    detail.push({ kind: "bars", title: "Open roles by department", unit: "roles", items: topDepts.slice(0, 12).map(([d, n]) => ({ label: d, value: n })) });
    detail.push({
      kind: "links",
      title: sampled ? "Sample of active roles (via Google Jobs)" : "Sample open roles",
      links: roles.filter((r) => r.url).slice(0, 15).map((r) => ({ label: `${r.title} (${r.department})`, url: r.url!, sublabel: r.postedAt?.slice(0, 10) })),
    });
    if (sampled)
      detail.push({
        kind: "keyvals",
        title: "Note on this company's data",
        items: [
          { label: "Source", value: "Google Jobs (company not on Greenhouse/Lever)" },
          { label: "Count type", value: "Sample of active roles, not a full total" },
          { label: "For precise volume/headcount trend", value: "needs a workforce API (Coresignal / PDL / Revelio)" },
        ],
      });

    const headline = sampled
      ? `Actively hiring — sample of ${roles.length} roles via Google Jobs (heaviest in ${topDepts[0]?.[0] ?? "—"}). Not on Greenhouse/Lever.`
      : `${roles.length} open roles${deltaVsLast !== undefined ? ` (${deltaVsLast >= 0 ? "+" : ""}${deltaVsLast} vs last scan)` : ""}; heaviest in ${topDepts[0]?.[0] ?? "—"}.`;

    return result(meta, {
      status: "ok",
      headline,
      metrics,
      timeseries: ts ? [ts] : undefined,
      evidence: topDepts.slice(0, 4).map(([d, n]) => ({ summary: `${d}: ${n} role${n === 1 ? "" : "s"}` })),
      detail,
      tookMs: Date.now() - start,
    });
  },
};
