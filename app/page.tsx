"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  ResolvedEntity,
  SignalResult,
  Timeseries,
  Synthesis,
  ThesisCard,
  LockedInfo,
  DetailSection,
} from "@/lib/ui-types";
import type { Fundamentals } from "@/lib/fundamentals";
import type { Watchlist } from "@/lib/watchlist";

const CATEGORY_ICON: Record<string, string> = {
  identity: "🏷️",
  filings: "📄",
  oss: "🐙",
  "dev-chatter": "💬",
  patents: "⚗️",
  hiring: "🧑‍💼",
  web: "🌐",
  apps: "📱",
  supply: "🚢",
  geo: "🛰️",
  options: "🐋",
  realestate: "🏢",
};
const TIER_LABEL: Record<string, string> = { free: "Free", premium: "Premium", roadmap: "Roadmap" };

function Sparkline({ series, w = 140, h = 36 }: { series: Timeseries; w?: number; h?: number }) {
  const points = series?.points ?? [];
  if (points.length < 2) return null;
  const pad = 3;
  const vals = points.map((p) => p.v);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const range = max - min || 1;
  const step = (w - 2 * pad) / (points.length - 1);
  const coords = points.map((p, i) => [pad + i * step, h - pad - ((p.v - min) / range) * (h - 2 * pad)] as const);
  const line = coords.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${line} L${coords[coords.length - 1][0].toFixed(1)},${h - pad} L${coords[0][0].toFixed(1)},${h - pad} Z`;
  const rising = points[points.length - 1].v >= points[0].v;
  const color = rising ? "var(--bull)" : "var(--bear)";
  return (
    <svg width={w} height={h} className="overflow-visible" aria-hidden>
      <path d={area} fill={color} opacity={0.12} />
      <path d={line} fill="none" stroke={color} strokeWidth={1.5} />
    </svg>
  );
}

function TrendArrow({ trend }: { trend?: "up" | "down" | "flat" }) {
  if (!trend) return null;
  const map = { up: ["▲", "text-bull"], down: ["▼", "text-bear"], flat: ["▬", "text-muted"] } as const;
  const [glyph, cls] = map[trend];
  return <span className={`ml-1 text-[10px] ${cls}`}>{glyph}</span>;
}

function StatusPill({ status }: { status: SignalResult["status"] }) {
  const map: Record<SignalResult["status"], [string, string]> = {
    ok: ["live", "bg-bull/15 text-bull"],
    "no-data": ["no data", "bg-neutral/15 text-neutral"],
    "not-applicable": ["n/a", "bg-muted/15 text-muted"],
    error: ["error", "bg-bear/15 text-bear"],
  };
  const [label, cls] = map[status] ?? ["", "bg-surface-2 text-muted"];
  return <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${cls}`}>{label}</span>;
}

function LinkButton({ link }: { link?: { label: string; url: string } }) {
  if (!link) return null;
  return (
    <a href={link.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-lg border border-accent/50 bg-accent/10 px-3 py-1.5 text-xs font-medium text-accent hover:bg-accent/20">
      {link.label} ↗
    </a>
  );
}

// ── Detail-section renderers ──────────────────────────────────────────────
function BarsSection({ items, unit }: { items: { label: string; value: number; sublabel?: string; url?: string }[]; unit?: string }) {
  const max = Math.max(...items.map((i) => i.value), 1);
  return (
    <div className="space-y-1.5">
      {items.map((it, i) => (
        <div key={i}>
          <div className="flex items-baseline justify-between gap-2 text-xs">
            <span className="truncate text-foreground/85">
              {it.url ? <a href={it.url} target="_blank" rel="noreferrer" className="text-accent hover:underline">{it.label}</a> : it.label}
            </span>
            <span className="shrink-0 font-medium text-muted">{it.value.toLocaleString()}{unit ? ` ${unit}` : ""}{it.sublabel ? ` · ${it.sublabel}` : ""}</span>
          </div>
          <div className="mt-0.5 h-1.5 w-full rounded bg-surface-2">
            <div className="h-1.5 rounded bg-accent" style={{ width: `${Math.max(2, (it.value / max) * 100)}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function MonthlySection({ months }: { months: { label: string; value: number }[] }) {
  const max = Math.max(...months.map((m) => m.value), 1);
  const shade = (v: number) => {
    const r = v / max;
    if (r === 0) return "bg-surface-2 text-muted";
    if (r < 0.34) return "bg-bull/20 text-foreground";
    if (r < 0.67) return "bg-bull/40 text-foreground";
    return "bg-bull/70 text-white";
  };
  return (
    <div className="grid grid-cols-6 gap-2 sm:grid-cols-12">
      {months.map((m) => (
        <div key={m.label} className={`rounded-lg px-1 py-2 text-center ${shade(m.value)}`}>
          <div className="text-[10px] uppercase opacity-70">{m.label}</div>
          <div className="text-sm font-semibold">{m.value.toLocaleString()}</div>
        </div>
      ))}
    </div>
  );
}

function TableSection({
  columns,
  rows,
}: {
  columns: { label: string; align?: "left" | "right" }[];
  rows: { cells: (string | number)[]; href?: string; hrefLabel?: string }[];
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border text-muted">
            {columns.map((c, i) => (
              <th key={i} className={`px-2 py-1.5 font-medium ${c.align === "right" ? "text-right" : "text-left"}`}>{c.label}</th>
            ))}
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={ri} className="border-b border-border/50">
              {r.cells.map((cell, ci) => (
                <td key={ci} className={`px-2 py-1.5 ${columns[ci]?.align === "right" ? "text-right tabular-nums" : "text-left"} text-foreground/85`}>
                  {typeof cell === "number" ? cell.toLocaleString() : cell}
                </td>
              ))}
              <td className="px-2 py-1.5 text-right">
                {r.href && <a href={r.href} target="_blank" rel="noreferrer" className="whitespace-nowrap text-accent hover:underline">{r.hrefLabel ?? "Open ↗"}</a>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SectionRenderer({ section }: { section: DetailSection }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <h3 className="text-sm font-semibold">{section.title}</h3>
      {"note" in section && section.note && <p className="mb-2 mt-0.5 text-[11px] text-muted">{section.note}</p>}
      <div className="mt-2">
        {section.kind === "timeseries" && <Sparkline series={section.series} w={520} h={90} />}
        {section.kind === "bars" && <BarsSection items={section.items} unit={section.unit} />}
        {section.kind === "monthly" && <MonthlySection months={section.months} />}
        {section.kind === "table" && <TableSection columns={section.columns} rows={section.rows} />}
        {section.kind === "keyvals" && (
          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {section.items.map((it, i) => (
              <div key={i} className="rounded-lg bg-surface-2 px-3 py-2">
                <dt className="text-[10px] uppercase tracking-wide text-muted">{it.label}</dt>
                <dd className="text-sm font-semibold">{typeof it.value === "number" ? it.value.toLocaleString() : it.value}</dd>
              </div>
            ))}
          </dl>
        )}
        {section.kind === "links" && (
          <ul className="space-y-1.5">
            {section.links.map((l, i) => (
              <li key={i} className="text-xs">
                <a href={l.url} target="_blank" rel="noreferrer" className="text-accent hover:underline">{l.label} ↗</a>
                {l.sublabel && <span className="text-muted"> · {l.sublabel}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/** Compact tile for the overview grid. Clicking opens the source's detail page. */
function StatTile({ signal, onOpen }: { signal: SignalResult; onOpen: () => void }) {
  const primary = signal.metrics?.[0];
  return (
    <button onClick={onOpen} className="flex flex-col rounded-xl border border-border bg-surface p-4 text-left transition hover:border-accent/60">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-base">{CATEGORY_ICON[signal.category] ?? "•"}</span>
          <span className="text-sm font-medium">{signal.label}</span>
        </div>
        <StatusPill status={signal.status} />
      </div>
      {signal.status === "ok" ? (
        <>
          {primary && (
            <div className="mt-2 text-lg font-semibold">
              {typeof primary.value === "number" ? primary.value.toLocaleString() : primary.value}
              {primary.unit ? <span className="text-sm text-muted"> {primary.unit}</span> : null}
              <TrendArrow trend={primary.trend} />
              <span className="ml-2 text-[11px] font-normal text-muted">{primary.name}</span>
            </div>
          )}
          {signal.timeseries?.[0] && <div className="mt-1"><Sparkline series={signal.timeseries[0]} w={160} h={30} /></div>}
          {signal.headline && <p className="mt-1 line-clamp-2 text-xs text-muted">{signal.headline}</p>}
        </>
      ) : (
        <p className="mt-2 text-xs text-muted">{signal.note ?? signal.error ?? "—"}</p>
      )}
      <span className="mt-2 text-[11px] text-accent">Open details →</span>
    </button>
  );
}

/** Full dedicated detail page for one signal. */
function SourceDetailPage({
  signal,
  onBack,
  onNav,
  navInfo,
}: {
  signal: SignalResult;
  onBack: () => void;
  onNav: (dir: -1 | 1) => void;
  navInfo: { index: number; total: number };
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <button onClick={onBack} className="rounded-lg border border-border px-3 py-1.5 text-sm text-muted hover:text-foreground">← Back to results</button>
        <div className="flex items-center gap-2 text-xs text-muted">
          <button onClick={() => onNav(-1)} className="rounded border border-border px-2 py-1 hover:text-foreground">←</button>
          <span>{navInfo.index + 1} / {navInfo.total}</span>
          <button onClick={() => onNav(1)} className="rounded border border-border px-2 py-1 hover:text-foreground">→</button>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-surface p-5">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="text-2xl">{CATEGORY_ICON[signal.category] ?? "•"}</span>
            <h2 className="text-xl font-semibold">{signal.label}</h2>
          </div>
          <StatusPill status={signal.status} />
        </div>
        {signal.headline && <p className="mt-2 text-sm text-foreground/90">{signal.headline}</p>}
        {signal.note && signal.status !== "ok" && <p className="mt-2 text-xs text-muted">{signal.note}</p>}
        {signal.error && <p className="mt-2 text-xs text-bear">{signal.error}</p>}
        {signal.primaryLink && <div className="mt-3"><LinkButton link={signal.primaryLink} /></div>}

        {signal.metrics.length > 0 && (
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {signal.metrics.map((m) => (
              <div key={m.name} className="rounded-lg bg-surface-2 px-3 py-2">
                <div className="text-[10px] uppercase tracking-wide text-muted">{m.name}</div>
                <div className="text-sm font-semibold">
                  {typeof m.value === "number" ? m.value.toLocaleString() : m.value}
                  {m.unit ? <span className="text-muted"> {m.unit}</span> : null}
                  <TrendArrow trend={m.trend} />
                  {m.changePct !== undefined && (
                    <span className={`ml-1 text-[10px] ${m.changePct >= 0 ? "text-bull" : "text-bear"}`}>{m.changePct >= 0 ? "+" : ""}{m.changePct.toFixed(0)}%</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Rich detail sections from the connector */}
      {signal.detail?.map((s, i) => <SectionRenderer key={i} section={s} />)}

      {/* Fallback: connectors with no custom detail still show their timeseries + evidence links */}
      {!signal.detail?.some((s) => s.kind === "timeseries") && signal.timeseries?.[0] && (
        <div className="rounded-xl border border-border bg-surface p-4">
          <h3 className="text-sm font-semibold">{signal.timeseries[0].name}</h3>
          <div className="mt-2"><Sparkline series={signal.timeseries[0]} w={520} h={90} /></div>
        </div>
      )}
      {!signal.detail?.some((s) => s.kind === "links") && signal.evidence.length > 0 && (
        <div className="rounded-xl border border-border bg-surface p-4">
          <h3 className="text-sm font-semibold">Evidence & source links</h3>
          <ul className="mt-2 space-y-1.5">
            {signal.evidence.map((e, i) => (
              <li key={i} className="text-xs text-foreground/80">
                {e.url ? <a href={e.url} target="_blank" rel="noreferrer" className="text-accent hover:underline">{e.summary}</a> : e.summary}
                {e.sourceDate && <span className="text-muted"> · {e.sourceDate.slice(0, 10)}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function LockedCardView({ info }: { info: LockedInfo }) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-surface/40 p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-muted">
          <span className="text-lg grayscale">{CATEGORY_ICON[info.category] ?? "•"}</span>
          <h3 className="font-medium">{info.label}</h3>
        </div>
        <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[10px] text-muted">🔒 {TIER_LABEL[info.tier]}</span>
      </div>
      <p className="mt-2 text-xs text-muted">{info.description}</p>
    </div>
  );
}

function directionCls(d: ThesisCard["direction"]) {
  return d === "bull" ? "text-bull" : d === "bear" ? "text-bear" : "text-neutral";
}
function ThesisCardView({ card }: { card: ThesisCard }) {
  return (
    <div className="rounded-lg border border-border bg-surface-2 p-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium">{card.signal}</span>
        <span className={`text-xs font-semibold uppercase ${directionCls(card.direction)}`}>{card.direction}</span>
      </div>
      <p className="mt-1.5 text-sm text-foreground/90">{card.implication}</p>
      <div className="mt-2 text-[10px] text-muted">confidence: {card.confidence}</div>
      {card.evidence?.length > 0 && <ul className="mt-2 list-disc pl-4 text-[11px] text-muted">{card.evidence.map((e, i) => <li key={i}>{e}</li>)}</ul>}
    </div>
  );
}

function ThesisPanel({ synthesis, loading }: { synthesis: Synthesis | null; loading: boolean }) {
  if (loading) return <div className="rounded-xl border border-border bg-surface p-5 text-sm text-muted">Synthesizing an investment thesis from the signals…</div>;
  if (!synthesis) return null;
  const arr = <T,>(v: T[] | undefined): T[] => (Array.isArray(v) ? v : []);
  const cards = arr(synthesis.cards);
  const bullCase = arr(synthesis.bullCase);
  const bearCase = arr(synthesis.bearCase);
  const dataGaps = arr(synthesis.dataGaps);
  const shortTerm = cards.filter((c) => c.horizon === "short-term");
  const longTerm = cards.filter((c) => c.horizon === "long-term");
  return (
    <div className="rounded-xl border border-border bg-surface p-5">
      <h2 className="text-lg font-semibold">Investment Thesis</h2>
      <p className="mt-2 text-sm text-foreground/90">{synthesis.summary}</p>
      {(synthesis.strongestSupport || synthesis.strongestContradiction) && (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {synthesis.strongestSupport && (
            <div className="rounded-lg border border-bull/30 bg-bull/5 p-3"><div className="text-xs font-semibold text-bull">Strongest support</div><p className="mt-1 text-xs text-foreground/85">{synthesis.strongestSupport}</p></div>
          )}
          {synthesis.strongestContradiction && (
            <div className="rounded-lg border border-bear/30 bg-bear/5 p-3"><div className="text-xs font-semibold text-bear">Strongest contradiction</div><p className="mt-1 text-xs text-foreground/85">{synthesis.strongestContradiction}</p></div>
          )}
        </div>
      )}
      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <div>
          <h3 className="mb-2 text-sm font-semibold text-neutral">⚡ Short-term signals</h3>
          <div className="space-y-2">{shortTerm.length ? shortTerm.map((c, i) => <ThesisCardView key={i} card={c} />) : <p className="text-xs text-muted">None identified.</p>}</div>
        </div>
        <div>
          <h3 className="mb-2 text-sm font-semibold text-accent">📈 Long-term signals</h3>
          <div className="space-y-2">{longTerm.length ? longTerm.map((c, i) => <ThesisCardView key={i} card={c} />) : <p className="text-xs text-muted">None identified.</p>}</div>
        </div>
      </div>
      {(bullCase.length > 0 || bearCase.length > 0) && (
        <div className="mt-5 grid gap-5 sm:grid-cols-2">
          <div><h3 className="mb-2 text-sm font-semibold text-bull">Bull case</h3><ul className="list-disc space-y-1 pl-4 text-xs text-foreground/85">{bullCase.map((b, i) => <li key={i}>{b}</li>)}</ul></div>
          <div><h3 className="mb-2 text-sm font-semibold text-bear">Bear case</h3><ul className="list-disc space-y-1 pl-4 text-xs text-foreground/85">{bearCase.map((b, i) => <li key={i}>{b}</li>)}</ul></div>
        </div>
      )}
      {dataGaps.length > 0 && <p className="mt-4 text-xs text-muted"><span className="font-medium">Data gaps:</span> {dataGaps.join(", ")}.</p>}
      <p className="mt-4 border-t border-border pt-3 text-[11px] leading-relaxed text-muted">{synthesis.disclaimer}</p>
    </div>
  );
}

function CompanyHeader({ entity }: { entity: ResolvedEntity }) {
  return (
    <section className="rounded-xl border border-border bg-surface p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-xl font-semibold">{entity.companyName} <span className="text-muted">· {entity.ticker}</span></h2>
          <p className="text-xs text-muted">{entity.sector ?? "Sector n/a"}{entity.marketCap ? ` · ~$${(entity.marketCap / 1e9).toFixed(1)}B mkt cap` : ""}</p>
        </div>
        <div className="flex gap-1.5 text-[10px] text-muted">
          <span className={`rounded px-1.5 py-0.5 ${entity.source.edgar ? "bg-bull/15 text-bull" : "bg-surface-2"}`}>EDGAR</span>
          <span className={`rounded px-1.5 py-0.5 ${entity.source.polygon ? "bg-bull/15 text-bull" : "bg-surface-2"}`}>Polygon</span>
          <span className={`rounded px-1.5 py-0.5 ${entity.source.llm ? "bg-bull/15 text-bull" : "bg-surface-2"}`}>AI-resolved</span>
        </div>
      </div>
    </section>
  );
}

function FundamentalsCard({ f }: { f: Fundamentals | null }) {
  if (!f) return null;
  const fmtCap = (n?: number) => (n ? (n >= 1e12 ? `$${(n / 1e12).toFixed(2)}T` : `$${(n / 1e9).toFixed(1)}B`) : "—");
  return (
    <section className="rounded-xl border border-border bg-surface p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold">Fundamentals & Earnings</h2>
        {f.nextEarningsDate && (
          <span className="rounded-lg bg-accent/15 px-3 py-1 text-xs font-medium text-accent">
            📅 Next earnings: {f.nextEarningsDate}{f.announceTime ? ` (${f.announceTime})` : ""}
          </span>
        )}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          ["Market cap", fmtCap(f.marketCap)],
          ["Beta", f.beta?.toFixed(2) ?? "—"],
          ["Sector", f.sector ?? "—"],
          ["Avg 30d vol", f.avg30Volume ? f.avg30Volume.toLocaleString() : "—"],
        ].map(([k, v]) => (
          <div key={k} className="rounded-lg bg-surface-2 px-3 py-2">
            <div className="text-[10px] uppercase tracking-wide text-muted">{k}</div>
            <div className="truncate text-sm font-semibold">{v}</div>
          </div>
        ))}
      </div>
      {f.history.length > 0 && (
        <div className="mt-4 overflow-x-auto">
          <div className="mb-1 text-xs font-medium text-muted">Historical earnings (EPS)</div>
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border text-muted">
                <th className="px-2 py-1.5 text-left font-medium">Report date</th>
                <th className="px-2 py-1.5 text-right font-medium">Est. EPS</th>
                <th className="px-2 py-1.5 text-right font-medium">Actual EPS</th>
                <th className="px-2 py-1.5 text-right font-medium">Surprise</th>
              </tr>
            </thead>
            <tbody>
              {f.history.map((r, i) => (
                <tr key={i} className="border-b border-border/50">
                  <td className="px-2 py-1.5">{r.reportDate}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{r.estimatedEps ?? "—"}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{r.reportedEps ?? "—"}</td>
                  <td className={`px-2 py-1.5 text-right tabular-nums ${r.surprisePct == null ? "text-muted" : r.surprisePct >= 0 ? "text-bull" : "text-bear"}`}>
                    {r.surprisePct == null ? "—" : `${r.surprisePct >= 0 ? "+" : ""}${r.surprisePct.toFixed(1)}%`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function WatchlistPanel({
  tickers,
  all,
  isSuperAdmin,
  onPick,
  onRemove,
}: {
  tickers: string[];
  all: Watchlist[] | null;
  isSuperAdmin: boolean;
  onPick: (t: string) => void;
  onRemove: (t: string) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  return (
    <section className="rounded-xl border border-border bg-surface p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">★ Your watchlist</h2>
        {isSuperAdmin && <button onClick={() => setShowAll((v) => !v)} className="text-xs text-accent hover:underline">{showAll ? "Hide" : "View"} all users</button>}
      </div>
      {tickers.length === 0 ? (
        <p className="mt-2 text-xs text-muted">No tickers yet. Search one and tap ★ to follow it — followed tickers are scanned daily so trends build automatically.</p>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          {tickers.map((t) => (
            <span key={t} className="inline-flex items-center gap-1 rounded-lg border border-border bg-surface-2 px-2 py-1 text-sm">
              <button onClick={() => onPick(t)} className="font-medium text-accent hover:underline">{t}</button>
              <button onClick={() => onRemove(t)} className="text-muted hover:text-bear" aria-label={`remove ${t}`}>×</button>
            </span>
          ))}
        </div>
      )}
      {isSuperAdmin && showAll && all && (
        <div className="mt-4 border-t border-border pt-3">
          <div className="mb-2 text-xs font-medium text-muted">All users</div>
          <div className="space-y-2">
            {all.map((wl) => (
              <div key={wl.userId} className="text-xs">
                <span className="text-foreground/80">{wl.email || wl.userId}</span>
                <span className="ml-2 text-muted">{wl.tickers.length ? wl.tickers.map((t) => (
                  <button key={t} onClick={() => onPick(t)} className="mr-1 text-accent hover:underline">{t}</button>
                )) : "—"}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

export default function Home() {
  const [ticker, setTicker] = useState("");
  const [entity, setEntity] = useState<ResolvedEntity | null>(null);
  const [signals, setSignals] = useState<SignalResult[]>([]);
  const [pending, setPending] = useState<{ id: string; label: string; category: string }[]>([]);
  const [locked, setLocked] = useState<LockedInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [synthesis, setSynthesis] = useState<Synthesis | null>(null);
  const [synthLoading, setSynthLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [fundamentals, setFundamentals] = useState<Fundamentals | null>(null);
  const [watchTickers, setWatchTickers] = useState<string[]>([]);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [allWatchlists, setAllWatchlists] = useState<Watchlist[] | null>(null);
  const runId = useRef(0);

  // Load the user's watchlist (+ all users if super-admin) once.
  useEffect(() => {
    fetch("/api/watchlist")
      .then((r) => r.json())
      .then((d) => {
        if (d.watchlist) setWatchTickers(d.watchlist.tickers ?? []);
        setIsSuperAdmin(!!d.isSuperAdmin);
        if (d.isSuperAdmin) fetch("/api/watchlist?scope=all").then((r) => r.json()).then((a) => setAllWatchlists(a.all ?? null)).catch(() => {});
      })
      .catch(() => {});
  }, []);

  const toggleWatch = useCallback((t: string, add: boolean) => {
    setWatchTickers((prev) => (add ? [...new Set([...prev, t])].sort() : prev.filter((x) => x !== t)));
    fetch("/api/watchlist", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ticker: t, action: add ? "add" : "remove" }) })
      .then((r) => r.json())
      .then((d) => d.watchlist && setWatchTickers(d.watchlist.tickers ?? []))
      .catch(() => {});
  }, []);

  const runSynthesis = useCallback(async (tk: string, sigs: SignalResult[]) => {
    setSynthLoading(true);
    try {
      const res = await fetch("/api/synthesize", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ticker: tk, signals: sigs }) });
      const json = await res.json();
      if (res.ok) setSynthesis(json.synthesis);
    } catch {
      /* best-effort */
    } finally {
      setSynthLoading(false);
    }
  }, []);

  const search = useCallback(async (override?: string) => {
    const tk = (override ?? ticker).trim().toUpperCase();
    if (!tk) return;
    if (override) setTicker(tk);
    const id = ++runId.current;
    setLoading(true);
    setError(null);
    setEntity(null);
    setSignals([]);
    setPending([]);
    setLocked([]);
    setSynthesis(null);
    setSelectedId(null);

    const collected: SignalResult[] = [];
    try {
      const res = await fetch("/api/signals", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ticker: tk }) });
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `Request failed (${res.status})`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (id !== runId.current) return;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";
        for (const part of parts) {
          const dataLine = part.split("\n").find((l) => l.startsWith("data:"));
          if (!dataLine) continue;
          let evt: Record<string, unknown>;
          try {
            evt = JSON.parse(dataLine.slice(5).trim());
          } catch {
            continue;
          }
          switch (evt.type) {
            case "entity": setEntity(evt.entity as ResolvedEntity); break;
            case "pending": setPending(evt.ids as typeof pending); break;
            case "locked": setLocked(evt.locked as LockedInfo[]); break;
            case "signal":
              collected.push(evt.signal as SignalResult);
              setSignals((prev) => [...prev, evt.signal as SignalResult]);
              break;
            case "error": setError(evt.message as string); break;
          }
        }
      }
      if (id === runId.current && collected.some((s) => s.status === "ok")) void runSynthesis(tk, collected);
    } catch (e) {
      if (id === runId.current) setError(e instanceof Error ? e.message : "Search failed");
    } finally {
      if (id === runId.current) setLoading(false);
    }
  }, [ticker, runSynthesis]);

  const pendingWaiting = pending.filter((p) => !signals.some((s) => s.connectorId === p.id));
  const okCount = useMemo(() => signals.filter((s) => s.status === "ok").length, [signals]);
  const orderedSignals = useMemo(
    () => [...signals].sort((a, b) => (a.status === "ok" ? 0 : 1) - (b.status === "ok" ? 0 : 1)),
    [signals]
  );
  const selected = orderedSignals.find((s) => s.connectorId === selectedId) ?? null;
  const selectedIdx = orderedSignals.findIndex((s) => s.connectorId === selectedId);

  // Open a detail page and push a history entry so the browser Back button returns to results.
  const openDetail = useCallback((id: string) => {
    try {
      window.history.pushState({ altedgeDetail: id }, "");
    } catch {
      /* history unavailable */
    }
    setSelectedId(id);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  const backToResults = useCallback(() => {
    if (typeof window !== "undefined" && window.history.state?.altedgeDetail) window.history.back();
    else setSelectedId(null);
  }, []);

  // Browser Back / gesture from a detail page returns to the results list, not off the app.
  useEffect(() => {
    const onPop = () => setSelectedId(null);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // Fetch key fundamentals + earnings whenever the resolved company changes.
  useEffect(() => {
    if (!entity) {
      setFundamentals(null);
      return;
    }
    let alive = true;
    fetch(`/api/fundamentals?ticker=${encodeURIComponent(entity.ticker)}`)
      .then((r) => r.json())
      .then((d) => alive && setFundamentals(d.fundamentals ?? null))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [entity]);

  const navSource = useCallback(
    (dir: -1 | 1) => {
      if (selectedIdx < 0) return;
      const next = (selectedIdx + dir + orderedSignals.length) % orderedSignals.length;
      setSelectedId(orderedSignals[next].connectorId);
      window.scrollTo({ top: 0, behavior: "smooth" });
    },
    [selectedIdx, orderedSignals]
  );

  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">AltEdge <span className="text-accent">·</span> <span className="text-base font-normal text-muted">Alternative Data Terminal</span></h1>
        <p className="mt-1 text-sm text-muted">Search a ticker for live alternative-data signals and an evidence-backed investment thesis.</p>
      </header>

      <div className="flex gap-2">
        <input
          value={ticker}
          onChange={(e) => setTicker(e.target.value.toUpperCase())}
          onKeyDown={(e) => e.key === "Enter" && search()}
          placeholder="Enter ticker (e.g. NVDA, KO, SHOP)"
          className="flex-1 rounded-lg border border-border bg-surface px-4 py-2.5 text-sm outline-none focus:border-accent"
          maxLength={10}
        />
        <button onClick={() => search()} disabled={loading} className="rounded-lg bg-accent px-5 py-2.5 text-sm font-medium text-white disabled:opacity-50">{loading ? "Scanning…" : "Analyze"}</button>
      </div>

      {error && <div className="mt-4 rounded-lg border border-bear/40 bg-bear/10 px-4 py-3 text-sm text-bear">{error}</div>}

      {entity && (
        <div className="mt-6 space-y-6">
          <div className="flex justify-end">
            <button
              onClick={() => toggleWatch(entity.ticker, !watchTickers.includes(entity.ticker))}
              className={`rounded-lg border px-3 py-1.5 text-sm ${watchTickers.includes(entity.ticker) ? "border-accent bg-accent/15 text-accent" : "border-border text-muted hover:text-foreground"}`}
            >
              {watchTickers.includes(entity.ticker) ? "★ Following" : "☆ Follow"}
            </button>
          </div>
          <CompanyHeader entity={entity} />

          {selected ? (
            <SourceDetailPage signal={selected} onBack={backToResults} onNav={navSource} navInfo={{ index: selectedIdx, total: orderedSignals.length }} />
          ) : (
            <>
              <FundamentalsCard f={fundamentals} />
              {(synthLoading || synthesis) && <ThesisPanel synthesis={synthesis} loading={synthLoading} />}

              {(orderedSignals.length > 0 || pendingWaiting.length > 0) && (
                <section>
                  <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">Signal highlights <span className="font-normal normal-case">— click any card for the full breakdown{okCount ? ` (${okCount} live)` : ""}</span></h2>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {orderedSignals.map((s) => <StatTile key={s.connectorId} signal={s} onOpen={() => openDetail(s.connectorId)} />)}
                    {pendingWaiting.map((p) => (
                      <div key={p.id} className="rounded-xl border border-border bg-surface p-4">
                        <div className="flex items-center gap-2 text-muted"><span className="text-base">{CATEGORY_ICON[p.category] ?? "•"}</span><span className="text-sm font-medium">{p.label}</span></div>
                        <div className="mt-3 h-2 w-1/2 animate-pulse rounded bg-surface-2" />
                        <div className="mt-2 h-2 w-2/3 animate-pulse rounded bg-surface-2" />
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {locked.length > 0 && (
                <section>
                  <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">Coming soon <span className="font-normal normal-case">— premium & roadmap connectors</span></h2>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{locked.map((l) => <LockedCardView key={l.id} info={l} />)}</div>
                </section>
              )}
            </>
          )}
        </div>
      )}

      {!entity && !loading && (
        <div className="mt-6 space-y-6">
          <WatchlistPanel
            tickers={watchTickers}
            all={allWatchlists}
            isSuperAdmin={isSuperAdmin}
            onPick={(t) => search(t)}
            onRemove={(t) => toggleWatch(t, false)}
          />
          {!error && (
            <div className="text-center text-sm text-muted">
              Try <button className="text-accent" onClick={() => search("NVDA")}>NVDA</button>,{" "}
              <button className="text-accent" onClick={() => search("SHOP")}>SHOP</button>, or{" "}
              <button className="text-accent" onClick={() => search("KO")}>KO</button>.
            </div>
          )}
        </div>
      )}
    </main>
  );
}
