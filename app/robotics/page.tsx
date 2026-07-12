"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { RoboticsWatchItem } from "@/app/api/robotics/route";

const ROLE_ICON: Record<string, string> = {
  oem: "🤖",
  ai_compute: "🧠",
  component_maker: "⚙️",
  raw_material: "⛏️",
};

function fmtVal(m: number | null): string {
  if (m == null) return "—";
  if (m >= 1_000_000) return `$${(m / 1_000_000).toFixed(2)}T`;
  if (m >= 1000) return `$${(m / 1000).toFixed(1)}B`;
  return `$${m.toLocaleString()}M`;
}

function Row({ item }: { item: RoboticsWatchItem }) {
  const linkable = !!item.shadowdataTicker;
  const inner = (
    <div className="flex items-start gap-3 rounded-xl border border-border bg-surface p-4 transition group-hover:border-accent/60">
      <span className="mt-0.5 text-xl">{ROLE_ICON[item.type] ?? "•"}</span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="font-semibold">{item.name}</span>
          <span className="text-xs font-medium text-accent">{item.ticker}</span>
          {item.exchange && <span className="text-[10px] text-muted">· {item.exchange}</span>}
          <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[10px] text-muted">{item.role}</span>
        </div>
        <p className="mt-1 text-xs text-muted">{item.tie}</p>
        <div className="mt-2 flex items-center gap-3 text-[11px]">
          <span className="text-muted">
            Valuation <span className="font-medium text-foreground/85">{fmtVal(item.valuationM)}</span>
          </span>
          <span className="text-muted">{item.country}</span>
          {linkable ? (
            <span className="ml-auto font-medium text-accent">Open ShadowData profile →</span>
          ) : (
            <a
              href="https://humanoids.fyi"
              target="_blank"
              rel="noreferrer"
              className="ml-auto text-muted hover:text-accent"
              onClick={(e) => e.stopPropagation()}
            >
              View on Humanoids.FYI ↗
            </a>
          )}
        </div>
      </div>
    </div>
  );
  return linkable ? (
    <Link href={`/?ticker=${item.shadowdataTicker}`} className="group block">
      {inner}
    </Link>
  ) : (
    <div className="group block opacity-90">{inner}</div>
  );
}

export default function RoboticsWatchlist() {
  const [items, setItems] = useState<RoboticsWatchItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/robotics")
      .then((r) => r.json())
      .then((d) => {
        if (d.error) setError(d.error);
        else setItems(d.items ?? []);
      })
      .catch(() => setError("Could not load the robotics watchlist."));
  }, []);

  const { tradeable, global } = useMemo(() => {
    const t = (items ?? []).filter((i) => i.shadowdataTicker);
    const g = (items ?? []).filter((i) => !i.shadowdataTicker);
    return { tradeable: t, global: g };
  }, [items]);

  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      <header className="mb-6">
        <div className="flex items-center gap-2">
          <Link href="/" className="rounded-lg border border-border px-3 py-1.5 text-sm text-muted hover:text-foreground">
            ← ShadowData
          </Link>
        </div>
        <h1 className="mt-4 text-2xl font-bold tracking-tight">
          🤖 Robotics Watchlist
        </h1>
        <p className="mt-1 text-sm text-muted">
          Every publicly-traded company in the humanoid-robot supply chain — OEMs building the robots and the
          suppliers of motors, reducers, sensors, batteries, compute and rare-earth materials. Data from the{" "}
          <a href="https://humanoids.fyi" target="_blank" rel="noreferrer" className="text-accent hover:underline">
            Humanoid Atlas · Humanoids.FYI
          </a>
          .
        </p>
      </header>

      {error && (
        <div className="rounded-lg border border-bear/40 bg-bear/10 px-4 py-3 text-sm text-bear">{error}</div>
      )}

      {!items && !error && <p className="text-sm text-muted">Loading robotics names…</p>}

      {items && (
        <div className="space-y-8">
          <section>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">
              US-tradeable{" "}
              <span className="font-normal normal-case">
                — {tradeable.length} names, click any for its full ShadowData profile
              </span>
            </h2>
            <div className="grid gap-3">
              {tradeable.map((i) => (
                <Row key={i.id} item={i} />
              ))}
            </div>
          </section>

          {global.length > 0 && (
            <section>
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">
                Global-listed{" "}
                <span className="font-normal normal-case">
                  — {global.length} names on foreign exchanges (not resolvable in ShadowData)
                </span>
              </h2>
              <div className="grid gap-3">
                {global.map((i) => (
                  <Row key={i.id} item={i} />
                ))}
              </div>
            </section>
          )}

          <p className="border-t border-border pt-4 text-[11px] leading-relaxed text-muted">
            Supply-chain relationships, roles and valuations are sourced from the Humanoid Atlas and may lag
            corporate changes. Tickers are best-effort matches; symbols that collide with an unrelated public
            company are omitted from the tradeable list. Decision-support only — not investment advice.
          </p>
        </div>
      )}
    </main>
  );
}
