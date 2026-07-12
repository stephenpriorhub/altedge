/**
 * Reddit chatter (public JSON search — no key required for light use). Thesis:
 * retail/consumer sentiment and volume. A spike in a product subreddit or a wave
 * of complaint threads is a short-term demand/quality signal; sustained community
 * growth is a long-term brand-health signal.
 *
 * Reddit rate-limits unauthenticated server IPs; failures degrade to "error"/"no-data"
 * and never break the response.
 */
import { getJson, classifyFailure } from "./http";
import { result, type Connector, type Evidence, type Metric } from "./types";

const meta = {
  id: "reddit",
  label: "Reddit Chatter",
  category: "dev-chatter",
  tier: "free",
} as const;

interface RedditChild {
  data: {
    title: string;
    permalink: string;
    score: number;
    num_comments: number;
    created_utc: number;
    subreddit: string;
  };
}

const DAY = 1000 * 60 * 60 * 24;

export const redditConnector: Connector = {
  ...meta,
  enabled: true,
  description: "Post volume, score and comment activity mentioning the company across Reddit.",
  requiredIdentifiers: ["brandTerms"],
  async fetch(entity, ctx) {
    const start = Date.now();
    const term = entity.identifiers.brandTerms?.[0] || entity.companyName;
    if (!term) return result(meta, { status: "not-applicable" });
    try {
      const url =
        `https://www.reddit.com/search.json?q=${encodeURIComponent(`"${term}"`)}` +
        `&sort=new&limit=100&t=month`;
      const data = await getJson<{ data: { children: RedditChild[] } }>(url, {
        signal: ctx.signal,
        headers: { "User-Agent": "oxfordhub-shadowdata/1.0 (research tool)" },
      });
      const posts = (data.data?.children ?? []).map((c) => c.data);
      if (posts.length === 0) {
        return result(meta, {
          status: "no-data",
          note: `No Reddit posts mentioning "${term}" in the last month.`,
          tookMs: Date.now() - start,
        });
      }

      const now = ctx.now.getTime();
      const last7 = posts.filter((p) => now - p.created_utc * 1000 <= 7 * DAY);
      const totalScore = posts.reduce((s, p) => s + p.score, 0);
      const totalComments = posts.reduce((s, p) => s + p.num_comments, 0);
      const subs = new Map<string, number>();
      for (const p of posts) subs.set(p.subreddit, (subs.get(p.subreddit) ?? 0) + 1);
      const topSub = [...subs.entries()].sort((a, b) => b[1] - a[1])[0];

      const metrics: Metric[] = [
        { name: "Posts (30d)", value: posts.length },
        { name: "Posts (last 7d)", value: last7.length, trend: last7.length >= posts.length / 4 ? "up" : undefined },
        { name: "Total upvotes", value: totalScore },
        { name: "Top subreddit", value: topSub ? `r/${topSub[0]} (${topSub[1]})` : "—" },
      ];

      const evidence: Evidence[] = posts
        .slice()
        .sort((a, b) => b.score - a.score)
        .slice(0, 5)
        .map((p) => ({
          summary: `r/${p.subreddit}: ${p.title} — ${p.score} upvotes, ${p.num_comments} comments`,
          url: `https://www.reddit.com${p.permalink}`,
          sourceDate: new Date(p.created_utc * 1000).toISOString(),
        }));

      return result(meta, {
        status: "ok",
        headline: `${posts.length} Reddit posts in 30d (${totalComments.toLocaleString()} comments); most active in ${topSub ? `r/${topSub[0]}` : "—"}.`,
        metrics,
        evidence,
        tookMs: Date.now() - start,
      });
    } catch (e) {
      const f = classifyFailure(e);
      return result(meta, {
        ...f,
        error: f.status === "error" ? "Reddit rate-limits server requests; retry later." : undefined,
        tookMs: Date.now() - start,
      });
    }
  },
};
