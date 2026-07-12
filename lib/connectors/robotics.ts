/**
 * Humanoid Robotics (free — Humanoid Atlas / Humanoids.FYI).
 * Thesis: exposure to the humanoid-robot supply chain is a structural, alt-data growth
 * signal that never shows up in fundamentals. For any ticker that maps to a company in the
 * Atlas we surface its role (OEM vs component/AI/raw-material supplier), the actual
 * supply-chain edges (who it buys from / sells to, and for which component), robot specs
 * for OEMs, and funding/production — with each mapped counterparty deep-linked to its own
 * ShadowData profile when it's tradeable in the US.
 *
 * Zero new cost: the Atlas API is free and all list calls are cached 24h on the volume.
 * Matching is conservative (see lib/robotics-atlas.ts) so a symbol collision never attaches
 * robotics data to the wrong company.
 */
import { classifyFailure } from "./http";
import { result, type Connector, type DetailSection, type Metric } from "./types";
import {
  ATLAS_SITE,
  ROLE_LABEL,
  shadowdataTickerFor,
  cleanCompanyName,
  getAtlasCompanies,
  getAtlasProfile,
  matchAtlasCompany,
  robotName,
  type AtlasCompanyLite,
  type AtlasProfile,
  type AtlasRelationship,
} from "../robotics-atlas";

const meta = { id: "robotics", label: "Humanoid Robotics", category: "robotics", tier: "free" } as const;

const spec = (v: unknown): string | undefined => {
  if (v == null) return undefined;
  const s = String(v).trim();
  return s && s !== "—" ? s : undefined;
};

const fmtM = (m?: number | null): string | undefined => {
  if (m == null) return undefined;
  return m >= 1_000_000 ? `$${(m / 1_000_000).toFixed(2)}T` : m >= 1000 ? `$${(m / 1000).toFixed(1)}B` : `$${m}M`;
};

/** Build a "counterparty" table where tradeable counterparties link to their ShadowData profile. */
function relationshipTable(
  title: string,
  rels: AtlasRelationship[],
  side: "from" | "to",
  companyById: Map<string, AtlasCompanyLite>,
  note?: string
): DetailSection {
  const rows = rels.map((r) => {
    const node = r[side];
    const lite = companyById.get(node.id);
    const altTicker = lite ? shadowdataTickerFor(lite) : null;
    return {
      cells: [cleanCompanyName(node.name), r.component ?? "—", node.country ?? "—"],
      href: altTicker ? `/?ticker=${altTicker}` : undefined,
      hrefLabel: altTicker ? `${altTicker} ↗` : undefined,
    };
  });
  return {
    kind: "table",
    title,
    columns: [{ label: "Company" }, { label: "Component" }, { label: "Country" }],
    rows,
    note,
  };
}

export const roboticsConnector: Connector = {
  ...meta,
  enabled: true,
  description:
    "Humanoid-robot supply-chain ties from the Humanoid Atlas (Humanoids.FYI): OEM/supplier role, component relationships, robot specs, funding & production.",
  requiredIdentifiers: [],
  timeoutMs: 20_000,
  async fetch(entity, ctx) {
    const start = Date.now();
    try {
      const companies = await getAtlasCompanies(ctx.signal);
      const match = matchAtlasCompany(entity.ticker, entity.companyName, companies);
      if (!match) {
        return result(meta, {
          status: "not-applicable",
          note: "No humanoid-robotics supply-chain ties found in the Humanoid Atlas (Humanoids.FYI).",
          tookMs: Date.now() - start,
        });
      }

      const profile = await getAtlasProfile(match.id, ctx.signal);
      const company: AtlasProfile["company"] = profile?.company ?? match;
      const suppliers = profile?.suppliers ?? []; // inbound (this company buys from `from`)
      const customers = profile?.customers ?? []; // outbound (this company sells to `to`)
      const isOem = company.type === "oem";
      const roleLabel = ROLE_LABEL[company.type] ?? "Robotics company";
      const companyById = new Map(companies.map((c) => [c.id, c]));

      // ── metrics + headline ──
      const metrics: Metric[] = [{ name: "Role", value: roleLabel }];
      let headline: string;

      if (isOem) {
        const robot = robotName(company.name);
        const specs = company.robotSpecs ?? {};
        const status = spec(specs.status);
        metrics.push({ name: "Component suppliers", value: suppliers.length, trend: suppliers.length ? "up" : undefined });
        if (status) metrics.push({ name: "Robot status", value: status });
        if (spec(specs.launchDate)) metrics.push({ name: "Launch", value: spec(specs.launchDate)! });
        headline =
          `${cleanCompanyName(company.name)} is a humanoid-robot OEM` +
          (robot ? ` (${robot})` : "") +
          `. ${suppliers.length} mapped component suppliers` +
          (status ? `; robot status: ${status}.` : ".");
      } else {
        const oemNames = [...new Set(customers.map((c) => cleanCompanyName(c.to.name)))];
        const components = [...new Set(customers.map((c) => c.component).filter(Boolean) as string[])];
        metrics.push({ name: "Humanoid OEM customers", value: oemNames.length, trend: oemNames.length ? "up" : undefined });
        if (components.length) metrics.push({ name: "Components supplied", value: components.length });
        if (spec(company.marketShare)) metrics.push({ name: "Market share", value: spec(company.marketShare)! });
        headline =
          `${cleanCompanyName(company.name)} supplies ` +
          (components.length ? `${components.slice(0, 2).join(", ")} ` : "components ") +
          `to ${oemNames.length} humanoid-robot program${oemNames.length === 1 ? "" : "s"}` +
          (oemNames.length ? ` (${oemNames.slice(0, 3).join(", ")}${oemNames.length > 3 ? "…" : ""}).` : ".");
      }

      // ── detail sections ──
      const detail: DetailSection[] = [];

      const profileItems: { label: string; value: string | number }[] = [
        { label: "Role", value: roleLabel },
        { label: "Country", value: company.country ?? "—" },
      ];
      if (isOem && company.robotSpecs) {
        const s = company.robotSpecs;
        const robot = robotName(company.name);
        const add = (label: string, v?: string) => v && profileItems.push({ label, value: v });
        if (robot) profileItems.push({ label: "Robot", value: robot });
        add("Status", spec(s.status));
        add("Launch", spec(s.launchDate));
        add("Height", spec(s.height));
        add("Mass", spec(s.mass));
        add("Speed", spec(s.speed));
        add("Total DOF", spec(s.totalDOF));
        add("Payload", spec(s.payloadCapacity));
        add("Target price", spec(s.price));
        add("BOM", spec(s.bom));
        add("AI partner", spec(s.aiPartner));
      } else if (spec(company.marketShare)) {
        profileItems.push({ label: "Market share", value: spec(company.marketShare)! });
      }
      detail.push({ kind: "keyvals", title: "Robotics profile", items: profileItems });

      if (customers.length)
        detail.push(
          relationshipTable(
            "Supplies to humanoid-robot OEMs",
            customers,
            "to",
            companyById,
            "Each row is a mapped supply relationship. Tradeable customers link to their ShadowData profile."
          )
        );
      if (suppliers.length)
        detail.push(
          relationshipTable(
            "Component suppliers (upstream)",
            suppliers,
            "from",
            companyById,
            "Who this OEM sources humanoid components from. Tradeable suppliers link to their ShadowData profile."
          )
        );

      const fundingItems: { label: string; value: string | number }[] = [];
      if (profile?.funding?.latestValuationM != null)
        fundingItems.push({ label: "Latest valuation", value: fmtM(profile.funding.latestValuationM) ?? "—" });
      if (profile?.funding?.totalRaised != null)
        fundingItems.push({ label: "Total raised", value: fmtM(profile.funding.totalRaised) ?? "—" });
      if (profile?.production?.annualCapacity != null)
        fundingItems.push({ label: "Annual capacity", value: profile.production.annualCapacity.toLocaleString() });
      if (profile?.production?.shipped2025 != null)
        fundingItems.push({ label: "Shipped 2025", value: profile.production.shipped2025.toLocaleString() });
      if (fundingItems.length) detail.push({ kind: "keyvals", title: "Funding & production", items: fundingItems });

      if (spec(company.description))
        detail.push({
          kind: "keyvals",
          title: "Why it matters",
          items: [{ label: "Atlas note", value: spec(company.description)!.slice(0, 600) }],
        });

      detail.push({
        kind: "links",
        title: "Source",
        links: [
          { label: "Explore the Humanoid Atlas", url: ATLAS_SITE, sublabel: "Humanoids.FYI" },
          { label: "ShadowData Robotics Watchlist", url: "/robotics", sublabel: "all publicly-traded robotics names" },
        ],
      });

      return result(meta, {
        status: "ok",
        headline,
        metrics,
        detail,
        evidence: spec(company.description) ? [{ summary: spec(company.description)!.slice(0, 280) }] : [],
        primaryLink: { label: "View on Humanoids.FYI", url: ATLAS_SITE },
        tookMs: Date.now() - start,
      });
    } catch (e) {
      return result(meta, { ...classifyFailure(e), tookMs: Date.now() - start });
    }
  },
};
