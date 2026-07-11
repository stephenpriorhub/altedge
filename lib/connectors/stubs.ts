/**
 * Premium + roadmap connectors. These are REAL registry entries with enabled:false
 * so the UI renders them as locked "coming soon" cards and the architecture is
 * proven to accept them — wiring one up later is: flip enabled, implement fetch(),
 * add the API key. No other part of the app changes.
 *
 * v1 decision (2026-07-09): free sources only; satellite + mobile-location are
 * roadmap, not built.
 */
import { result, type Connector, type ConnectorTier, type SignalCategory } from "./types";

function lockedConnector(cfg: {
  id: string;
  label: string;
  category: SignalCategory;
  tier: ConnectorTier;
  description: string;
}): Connector {
  const meta = { id: cfg.id, label: cfg.label, category: cfg.category, tier: cfg.tier } as const;
  return {
    ...meta,
    enabled: false,
    description: cfg.description,
    requiredIdentifiers: [],
    async fetch() {
      return result(meta, {
        status: "not-applicable",
        note: "Connector not enabled in this build.",
      });
    },
  };
}

export const stubConnectors: Connector[] = [
  // ── Premium: paid API, drop-in when budget approved ──
  lockedConnector({
    id: "similarweb",
    label: "Web Traffic (SimilarWeb)",
    category: "web",
    tier: "premium",
    description: "Precise site visits, engagement and channel mix. Requires a SimilarWeb API plan.",
  }),
  lockedConnector({
    id: "sensortower",
    label: "App Downloads (Sensor Tower)",
    category: "apps",
    tier: "premium",
    description: "True install & DAU estimates across iOS + Android. Requires a Sensor Tower plan.",
  }),
  lockedConnector({
    id: "playstore",
    label: "Google Play Signal",
    category: "apps",
    tier: "premium",
    description: "Android install & rating momentum. No free official API — needs a third-party provider.",
  }),
  lockedConnector({
    id: "revelio",
    label: "Attrition & Flows",
    category: "hiring",
    tier: "premium",
    description: "Employee inflows/outflows and attrition by role & geo (beyond headcount level). Requires Revelio Labs.",
  }),

  // ── Roadmap: expensive + hard to make defensible; deprioritized in v1 ──
  lockedConnector({
    id: "satellite",
    label: "Satellite Imagery",
    category: "geo",
    tier: "roadmap",
    description: "Parking-lot / construction / storage-tank change detection. Heavy ML + costly imagery.",
  }),
  lockedConnector({
    id: "mobile-location",
    label: "Foot Traffic (Mobile Location)",
    category: "geo",
    tier: "roadmap",
    description: "Store-visit trends from mobile-location panels. Costly and privacy-sensitive.",
  }),
];
