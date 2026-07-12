# ShadowData — Alternative Data Terminal (OxfordHub app)

Search a stock ticker → pull live **alternative data** (non-financial-statement
signals) and an evidence-backed, defensible investment thesis (short-term vs
long-term, bull/bear, cited). Lives at `shadowdata.oxfordhub.app`.

## Stack
Next.js 16 (App Router, Turbopack) · React 19 · TypeScript · Tailwind v4 ·
JSON-on-`DATA_DIR`-volume storage · Railway (Nixpacks). Auth via the shared
`hub-nav.js` embed + `lib/hub-auth.ts` cookie-forward to the hub `/api/me`.

## The core idea: a pluggable connector layer
Every data source implements the `Connector` interface in
[`lib/connectors/types.ts`](lib/connectors/types.ts) and self-registers in
[`lib/connectors/index.ts`](lib/connectors/index.ts).

**To add a source:** create `lib/connectors/<id>.ts` exporting a `Connector`, add
it to `CONNECTORS`. The aggregator handles eligibility (does the entity have the
`requiredIdentifiers`?), parallel fetch, per-connector timeout, and graceful
failure. Nothing else changes. Premium/roadmap sources are registered with
`enabled: false` → they render as locked "coming soon" cards.

**Connector rule (non-negotiable):** never throw for an expected failure. Return a
`SignalResult` with status `ok | no-data | not-applicable | error`. One dead
source must never break the response (same graceful-degradation principle as the
brain writers in promo-analyzer).

### v1 connectors (all free / near-free)
`identity` (SEC EDGAR + Polygon, in `lib/entity-resolver.ts`), `filings` (EDGAR),
`github`, `hackernews`, `reddit`, `patents` (PatentsView, needs free key),
`jobs` (Greenhouse + Lever), `web` (Wikipedia pageviews), `appstore` (iTunes).
Locked stubs: SimilarWeb, Sensor Tower, Google Play, Google Trends, ImportYeti,
Coresignal (premium) + Satellite, Mobile-location (roadmap).

## Entity resolution
`lib/entity-resolver.ts`: SEC `company_tickers.json` → CIK + name (authoritative,
free); Polygon `/v3/reference/tickers` → sector/market-cap/homepage (if key);
Claude (cheap model) → the fuzzy identifiers (GitHub org, app IDs, subreddits,
careers slug, patent assignee, Wikipedia title). **Cached per-ticker** in
`DATA_DIR` so LLM resolution is paid once. Without `ANTHROPIC_API_KEY` it falls
back to brand-term/company-name identifiers (many connectors then correctly
report `not-applicable`).

## The "smart" layer
`lib/synthesis.ts`: one Claude call (Sonnet) turns the raw signals into structured
thesis cards — direction (bull/bear/neutral), horizon (short/long), confidence,
and cited evidence. **No price targets, no buy/sell calls** — decision-support
only, to stay defensible (Claims Integrity standard).

## Routes
`GET /api/resolve?ticker=` · `POST /api/signals` (SSE, cards stream as sources
land) · `POST /api/synthesize` · `GET /api/health`. All gated by `requireHubUser`
(fails open on localhost, closed in prod).

## Brain vault
**v1 writes NOTHING to the brain** (decision 2026-07-09; trading/market apps need
publisher sign-off per the 2026-07-01 rule). App-side snapshots accrue in
`DATA_DIR/snapshots/<TICKER>.json` and are shaped to be brain-ready for a future
phase (a `kind:"shadowdata-snapshot"` in brain-map's `/api/intelligence`).

## Env
Reused (Railway project level): `ANTHROPIC_API_KEY`, `POLYGON_API_KEY`,
`GITHUB_TOKEN`, `HUB_API_TOKEN`. App: `NEXT_PUBLIC_HUB_PROJECT_ID=shadowdata`,
`HUB_URL`, `DATA_DIR`, `SEC_USER_AGENT`. Optional free: `PATENTSVIEW_API_KEY`,
`REDDIT_CLIENT_ID/SECRET`. See `.env.example`.

## Local dev
`npm install && npm run dev` (port 3007). Works with zero keys — SEC identity +
filings/HN connectors run; keyless fallbacks and error paths degrade gracefully.
Auth fails open on localhost.
