/**
 * Humanoid Atlas (Humanoids.FYI) client + ticker→company matching.
 *
 * Source: https://humanoid-atlas-api.vercel.app/v1 — a graph of humanoid-robot OEMs
 * and their component/AI/raw-material suppliers, with funding, production and specs.
 * We use it to answer one alt-data question per ticker: is this public company tied to
 * the humanoid-robotics supply chain, and how?
 *
 * All list calls are cached on the DATA_DIR volume (24h) so a scan never hammers the API.
 * Matching is deliberately conservative — a wrong match would attach robotics data to the
 * wrong company, which violates ShadowData's defensibility rule — so we verify every
 * ticker hit with a name-overlap check before trusting it.
 */
import { getJson } from "./connectors/http";
import { getCached, setCached } from "./store";

export const ATLAS_BASE = "https://humanoid-atlas-api.vercel.app/v1";
export const ATLAS_SITE = "https://humanoids.fyi";
const TTL_24H = 1000 * 60 * 60 * 24;

export type AtlasEntityType = "oem" | "component_maker" | "ai_compute" | "raw_material";

export interface AtlasCompanyLite {
  id: string;
  name: string;
  type: AtlasEntityType;
  country: string;
  description?: string;
  ticker?: string;
  marketShare?: string;
  _counts?: {
    suppliersInbound?: number;
    customersOutbound?: number;
    vlaModels?: number;
    simPlatforms?: number;
  };
}

export interface AtlasNodeRef {
  id: string;
  name: string;
  type: AtlasEntityType;
  country: string;
}

export interface AtlasRelationship {
  id: string;
  from: AtlasNodeRef;
  to: AtlasNodeRef;
  component?: string;
  componentCategoryId?: string;
  description?: string;
}

export interface AtlasRobotSpecs {
  status?: string;
  launchDate?: string;
  height?: string;
  mass?: string;
  speed?: string;
  totalDOF?: string;
  payloadCapacity?: string;
  price?: string;
  bom?: string;
  aiPartner?: string;
  [k: string]: unknown;
}

export interface AtlasProfile {
  company: AtlasCompanyLite & { robotSpecs?: AtlasRobotSpecs };
  suppliers: AtlasRelationship[]; // inbound: from = supplier, to = this company
  customers: AtlasRelationship[]; // outbound: from = this company, to = customer/OEM
  funding?: {
    totalRaised?: number | null;
    latestValuationM?: number | null;
    latestValuationNote?: string;
  } | null;
  production?: {
    annualCapacity?: number | null;
    shipped2025?: number | null;
    mfgModel?: string;
  } | null;
  factories?: unknown[];
  vlaModels?: unknown[];
  simPlatforms?: unknown[];
}

export interface AtlasFundingRecord {
  companyId: string;
  latestValuationM?: number | null;
  latestValuationNote?: string;
  totalRaised?: number | null;
  status?: string;
}

// ── API fetchers (24h volume cache) ──────────────────────────────────────────

export async function getAtlasCompanies(signal?: AbortSignal): Promise<AtlasCompanyLite[]> {
  const cached = getCached<AtlasCompanyLite[]>("robotics_atlas", "companies", TTL_24H);
  if (cached) return cached;
  const res = await getJson<{ data: AtlasCompanyLite[] }>(`${ATLAS_BASE}/companies?limit=500`, {
    signal,
    timeoutMs: 15_000,
  });
  const list = res.data ?? [];
  if (list.length) setCached("robotics_atlas", "companies", list);
  return list;
}

export async function getAtlasRelationships(signal?: AbortSignal): Promise<AtlasRelationship[]> {
  const cached = getCached<AtlasRelationship[]>("robotics_atlas", "relationships", TTL_24H);
  if (cached) return cached;
  const res = await getJson<{ data: AtlasRelationship[] }>(`${ATLAS_BASE}/relationships?limit=1000`, {
    signal,
    timeoutMs: 15_000,
  });
  const list = res.data ?? [];
  if (list.length) setCached("robotics_atlas", "relationships", list);
  return list;
}

export async function getAtlasFunding(signal?: AbortSignal): Promise<Record<string, AtlasFundingRecord>> {
  const cached = getCached<Record<string, AtlasFundingRecord>>("robotics_atlas", "funding", TTL_24H);
  if (cached) return cached;
  try {
    const res = await getJson<{ data: AtlasFundingRecord[] }>(`${ATLAS_BASE}/funding?sort=valuation`, {
      signal,
      timeoutMs: 15_000,
    });
    const map: Record<string, AtlasFundingRecord> = {};
    for (const f of res.data ?? []) map[f.companyId] = f;
    if (Object.keys(map).length) setCached("robotics_atlas", "funding", map);
    return map;
  } catch {
    return {};
  }
}

export async function getAtlasProfile(id: string, signal?: AbortSignal): Promise<AtlasProfile | null> {
  const cached = getCached<AtlasProfile>("robotics_atlas_profile", id, TTL_24H);
  if (cached) return cached;
  try {
    const res = await getJson<{ data: AtlasProfile }>(
      `${ATLAS_BASE}/companies/${encodeURIComponent(id)}`,
      { signal, timeoutMs: 15_000 }
    );
    if (res.data) setCached("robotics_atlas_profile", id, res.data);
    return res.data ?? null;
  } catch {
    return null;
  }
}

// ── Ticker → company matching ────────────────────────────────────────────────

/**
 * Atlas tickers that are factually wrong or collide with an unrelated public company.
 * MBLY is tagged to "Mentee Robotics" (a private Israeli company), but MBLY is Mobileye's
 * symbol — matching it would show robotics data on the wrong company. Excluded until fixed
 * upstream. Add here if other collisions surface.
 */
export const UNVERIFIED_TICKERS = new Set<string>(["MBLY"]);

/**
 * Holding-company / brand bridges where the tradeable ticker and the Atlas company name
 * legitimately share no word (e.g. Alphabet trades as GOOGL but the Atlas entry is
 * "Google DeepMind"). Ticker → Atlas company id.
 */
const NAME_ALIASES: Record<string, string> = {
  GOOGL: "google_deepmind",
  GOOG: "google_deepmind",
};

const NAME_STOPWORDS = new Set([
  "inc", "corp", "ltd", "plc", "the", "and", "co", "group", "holdings", "global",
  "technologies", "technology", "systems", "system", "semiconductor", "company",
  "limited", "international", "electronics", "industries", "solution", "solutions",
]);

/** Distinctive lowercase word tokens from a company name, minus corporate boilerplate. */
function nameTokens(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/\([^)]*\)/g, " ") // drop "(Optimus)" style robot names
      .replace(/[^a-z0-9 ]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length >= 3 && !NAME_STOPWORDS.has(w))
  );
}

/** The tradeable symbol without an exchange suffix, e.g. "6324.T" → "6324", "IFX.DE" → "IFX". */
export function baseTicker(t: string): string {
  return t.toUpperCase().trim().split(".")[0];
}

function buildTickerIndex(companies: AtlasCompanyLite[]): Map<string, AtlasCompanyLite> {
  const idx = new Map<string, AtlasCompanyLite>();
  for (const c of companies) {
    if (!c.ticker) continue;
    const full = c.ticker.toUpperCase().trim();
    // Full ticker wins over base so "IFX" (base) can't shadow a real "IFX" listing.
    if (!idx.has(full)) idx.set(full, c);
    const base = baseTicker(c.ticker);
    if (!idx.has(base)) idx.set(base, c);
  }
  return idx;
}

/**
 * Resolve an ShadowData-resolved company (ticker + name) to an Atlas company, or null.
 * A ticker hit is only trusted if the two company names share a distinctive word, or the
 * pair is in the curated alias bridge — this rejects symbol collisions like MBLY.
 */
export function matchAtlasCompany(
  ticker: string,
  companyName: string,
  companies: AtlasCompanyLite[]
): AtlasCompanyLite | null {
  const T = ticker.toUpperCase().trim();
  if (UNVERIFIED_TICKERS.has(T)) return null;
  const idx = buildTickerIndex(companies);
  const cand = idx.get(T) ?? idx.get(baseTicker(T));
  if (!cand) return null;

  if (NAME_ALIASES[T] === cand.id) return cand;

  const a = nameTokens(companyName);
  const b = nameTokens(cand.name);
  for (const w of a) if (b.has(w)) return cand;
  return null;
}

/**
 * The ShadowData-searchable symbol for an Atlas company, or null if it can't be looked up here.
 * ShadowData resolves via SEC/Polygon (US registrants + ADRs), so foreign exchange listings
 * (dotted tickers like 6324.T) and unverified symbols aren't deep-linkable to a profile.
 */
export function shadowdataTickerFor(c: AtlasCompanyLite): string | null {
  if (!c.ticker) return null;
  const t = c.ticker.toUpperCase().trim();
  if (t.includes(".")) return null; // foreign exchange listing
  if (UNVERIFIED_TICKERS.has(t)) return null;
  if (!/^[A-Z]{1,5}$/.test(t)) return null;
  return t;
}

// ── Presentation helpers ─────────────────────────────────────────────────────

export const ROLE_LABEL: Record<AtlasEntityType, string> = {
  oem: "Humanoid OEM",
  component_maker: "Component supplier",
  ai_compute: "AI / compute supplier",
  raw_material: "Raw-material supplier",
};

/** The robot brand name from a company label, e.g. "Tesla (Optimus)" → "Optimus". */
export function robotName(name: string): string | null {
  const m = name.match(/\(([^)]+)\)/);
  return m ? m[1].trim() : null;
}

/** The clean company name without its "(Robot)" suffix. */
export function cleanCompanyName(name: string): string {
  return name.replace(/\s*\([^)]*\)\s*$/, "").trim();
}

/** Human exchange label from a ticker suffix, e.g. "6324.T" → "Tokyo". */
export function exchangeLabel(ticker: string): string | null {
  const suffix = ticker.toUpperCase().includes(".") ? ticker.toUpperCase().split(".")[1] : "";
  const map: Record<string, string> = {
    HK: "Hong Kong",
    T: "Tokyo",
    DE: "Frankfurt",
    SZ: "Shenzhen",
    SS: "Shanghai",
    KS: "Korea (KOSPI)",
    KQ: "Korea (KOSDAQ)",
    AX: "Australia (ASX)",
    ST: "Stockholm",
    L: "London",
    PA: "Paris",
    WA: "Warsaw",
    TW: "Taiwan",
    SW: "Switzerland",
  };
  return suffix ? map[suffix] ?? suffix : null;
}
