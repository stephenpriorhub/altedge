# Agent notes for ShadowData

> ⚠️ **This app runs Next.js 16 + React 19 + Tailwind v4**, which are newer than
> most training data. App Router route handlers, `text/event-stream` streaming
> via `ReadableStream`, and Tailwind v4's `@theme inline` (no `tailwind.config.ts`)
> all differ from older conventions. When unsure, check `node_modules/next` and
> the existing files rather than assuming older-version behavior.

## Where things live
- Connector contract + helpers: `lib/connectors/types.ts`, `lib/connectors/http.ts`
- Connector registry + aggregator: `lib/connectors/index.ts`
- One file per source: `lib/connectors/<id>.ts`; locked stubs in `stubs.ts`
- Entity resolution: `lib/entity-resolver.ts` · Persistence: `lib/store.ts`
- Thesis synthesis: `lib/synthesis.ts` · Models: `lib/models.ts`
- Auth: `lib/hub-auth.ts` · Routes: `app/api/*` · UI: `app/page.tsx`

## Invariants (don't break)
1. Connectors never throw for expected failures — return a `SignalResult`.
2. No brain-vault writes in v1 (publisher sign-off required first).
3. No price targets / buy-sell advice anywhere — decision-support framing only.
4. LLM resolution is cached per-ticker; don't call Claude on every request.
5. Adding a source = one connector file + one line in `CONNECTORS`. If you find
   yourself editing routes/UI to add a source, you've broken the abstraction.

## Verify
`npm run build` (typechecks) then `npm run dev`; hit `/api/health`,
`/api/resolve?ticker=NVDA`, and `POST /api/signals`. Confirm inapplicable
connectors return `not-applicable` and a failing source doesn't abort the SSE run.
