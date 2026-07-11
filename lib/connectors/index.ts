/**
 * Connector registry + aggregator.
 *
 * To add a data source: implement a Connector in its own file and add it to
 * CONNECTORS below. Everything else — eligibility gating, parallel fetching,
 * timeouts, graceful failure, the UI card — is handled generically.
 */
import type { Connector, ResolvedEntity, SignalResult } from "./types";
import { result } from "./types";

import { githubConnector } from "./github";
import { filingsConnector } from "./filings";
import { hackernewsConnector } from "./hackernews";
import { redditConnector } from "./reddit";
import { patentsConnector } from "./patents";
import { jobsConnector } from "./jobs";
import { webConnector } from "./web";
import { trendsConnector } from "./trends";
import { appsConnector } from "./apps";
import { importYetiConnector } from "./importyeti";
import { workforceConnector } from "./workforce";
import { optionsFlowConnector } from "./unusualwhales";
import { satelliteConnector } from "./satellite";
import { stubConnectors } from "./stubs";

export const CONNECTORS: Connector[] = [
  githubConnector,
  filingsConnector,
  jobsConnector,
  workforceConnector,
  optionsFlowConnector,
  trendsConnector,
  webConnector,
  appsConnector,
  importYetiConnector,
  hackernewsConnector,
  redditConnector,
  patentsConnector,
  satelliteConnector,
  ...stubConnectors,
];

/** Per-connector hard ceiling so one slow source can't stall the whole run. */
const CONNECTOR_TIMEOUT_MS = 18_000;

/** Enabled connectors whose required identifiers are all present on the entity. */
export function eligibleConnectors(entity: ResolvedEntity): Connector[] {
  return CONNECTORS.filter((c) => c.enabled).filter((c) =>
    c.requiredIdentifiers.every((k) => {
      const v = entity.identifiers[k];
      return Array.isArray(v) ? v.length > 0 : v != null && v !== "";
    })
  );
}

/**
 * Run one connector with its own timeout, converting any thrown error or timeout
 * into an "error" SignalResult. Never rejects.
 */
async function runOne(c: Connector, entity: ResolvedEntity): Promise<SignalResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CONNECTOR_TIMEOUT_MS);
  const start = Date.now();
  try {
    return await c.fetch(entity, { signal: controller.signal, now: new Date() });
  } catch (e) {
    return result(c, {
      status: "error",
      error: e instanceof Error ? e.message : String(e),
      tookMs: Date.now() - start,
    });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Run all eligible connectors in parallel. `onResult` fires as each settles so the
 * caller can stream cards to the client; the returned array is the full set once
 * everything has settled.
 */
export async function runConnectors(
  entity: ResolvedEntity,
  onResult?: (r: SignalResult) => void
): Promise<SignalResult[]> {
  const eligible = eligibleConnectors(entity);
  const results: SignalResult[] = [];
  await Promise.all(
    eligible.map(async (c) => {
      const r = await runOne(c, entity);
      results.push(r);
      onResult?.(r);
    })
  );
  return results;
}

/** Locked (disabled) connectors, surfaced to the UI as "coming soon" cards. */
export function lockedConnectorsInfo() {
  return CONNECTORS.filter((c) => !c.enabled).map((c) => ({
    id: c.id,
    label: c.label,
    category: c.category,
    tier: c.tier,
    description: c.description,
  }));
}
