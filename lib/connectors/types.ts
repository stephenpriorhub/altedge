/**
 * The pluggable connector contract. Every alternative-data source implements
 * `Connector`. Adding a source = add one file that exports a Connector and
 * register it in ./index.ts. Nothing else in the app changes.
 */

export type SignalCategory =
  | "identity"
  | "filings"
  | "oss"
  | "dev-chatter"
  | "patents"
  | "hiring"
  | "web"
  | "apps"
  | "supply"
  | "geo"
  | "options"
  | "realestate";

export type SignalStatus = "ok" | "no-data" | "not-applicable" | "error";

export type Direction = "bull" | "bear" | "neutral";
export type Horizon = "short-term" | "long-term";

/** One identifier bundle resolved from a ticker — see lib/entity-resolver.ts. */
export interface EntityIdentifiers {
  domain?: string;
  githubOrg?: string;
  iosAppIds?: string[]; // numeric App Store track IDs
  androidPackages?: string[]; // e.g. com.company.app
  subreddits?: string[];
  greenhouseSlug?: string; // boards.greenhouse.io/<slug>
  leverSlug?: string; // jobs.lever.co/<slug>
  importYetiSlug?: string; // importyeti.com/company/<slug>
  patentAssignees?: string[]; // legal assignee names to search
  wikipediaTitle?: string; // en.wikipedia article title
  brandTerms?: string[]; // free-text search terms (HN, Reddit)
}

export interface ResolvedEntity {
  ticker: string;
  companyName: string;
  cik?: string; // zero-padded 10-digit
  sector?: string;
  marketCap?: number;
  description?: string;
  homepageUrl?: string;
  logoUrl?: string;
  identifiers: EntityIdentifiers;
  resolvedAt: string;
  source: { edgar: boolean; polygon: boolean; llm: boolean };
}

export interface Metric {
  name: string;
  value: number | string;
  unit?: string;
  trend?: "up" | "down" | "flat"; // visual arrow only — bull/bear read left to synthesis
  changePct?: number; // vs previous comparable period, if known
}

export interface TimeseriesPoint {
  t: string; // ISO date
  v: number;
}
export interface Timeseries {
  name: string;
  points: TimeseriesPoint[];
}

export interface Evidence {
  summary: string;
  url?: string;
  sourceDate?: string; // ISO
}

export interface SignalResult {
  connectorId: string;
  label: string;
  category: SignalCategory;
  tier: ConnectorTier;
  status: SignalStatus;
  headline?: string; // one-line human takeaway
  note?: string; // e.g. why no-data / what would unlock it
  metrics: Metric[];
  timeseries?: Timeseries[];
  evidence: Evidence[];
  /** Optional prominent "view source" button (e.g. the company's ImportYeti/GitHub page). */
  primaryLink?: { label: string; url: string };
  /** Optional rich sections rendered on the source's dedicated detail page. */
  detail?: DetailSection[];
  error?: string;
  fetchedAt: string;
  tookMs?: number;
}

/** Declarative rich-detail sections a connector can emit for its detail page. */
export type DetailSection =
  | { kind: "timeseries"; title: string; series: Timeseries; note?: string }
  | {
      kind: "table";
      title: string;
      columns: { label: string; align?: "left" | "right" }[];
      rows: { cells: (string | number)[]; href?: string; hrefLabel?: string }[];
      note?: string;
    }
  | { kind: "bars"; title: string; unit?: string; items: { label: string; value: number; sublabel?: string; url?: string }[]; note?: string }
  | { kind: "monthly"; title: string; months: { label: string; value: number }[]; note?: string }
  | { kind: "links"; title: string; links: { label: string; url: string; sublabel?: string }[] }
  | { kind: "keyvals"; title: string; items: { label: string; value: string | number }[] };

export type ConnectorTier = "free" | "premium" | "roadmap";

export interface FetchCtx {
  signal: AbortSignal;
  now: Date;
}

export interface Connector {
  id: string;
  label: string;
  category: SignalCategory;
  tier: ConnectorTier;
  /** Disabled connectors never run; they render as locked "coming soon" cards. */
  enabled: boolean;
  /** Short description shown on locked cards / tooltips. */
  description: string;
  /** Identifiers that must be present for this connector to run. */
  requiredIdentifiers: (keyof EntityIdentifiers)[];
  /** Optional per-connector timeout override (ms). LLM-backed connectors need more than the default. */
  timeoutMs?: number;
  fetch(entity: ResolvedEntity, ctx: FetchCtx): Promise<SignalResult>;
}

/** Helper so connectors can return a consistent shape with less boilerplate. */
export function result(
  c: Pick<Connector, "id" | "label" | "category" | "tier">,
  partial: Partial<SignalResult> & { status: SignalStatus }
): SignalResult {
  return {
    connectorId: c.id,
    label: c.label,
    category: c.category,
    tier: c.tier,
    metrics: [],
    evidence: [],
    fetchedAt: new Date().toISOString(),
    ...partial,
  };
}
