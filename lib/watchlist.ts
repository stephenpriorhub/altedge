/**
 * Per-hub-user watchlists (DATA_DIR/watchlists.json). Drives the scheduled scan so hiring/
 * headcount/trend history accrues automatically for followed tickers. Super-admins can view
 * every user's list.
 */
import fs from "fs";
import path from "path";

const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(process.cwd(), "data");
const FILE = path.join(DATA_DIR, "watchlists.json");

export interface Watchlist {
  userId: string;
  email: string;
  name: string | null;
  tickers: string[];
  updatedAt: string;
}
type Store = Record<string, Watchlist>;

function read(): Store {
  if (!fs.existsSync(FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(FILE, "utf-8")) as Store;
  } catch {
    return {};
  }
}
function write(s: Store) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(s, null, 2), "utf-8");
}

export function getWatchlist(userId: string): Watchlist {
  return read()[userId] ?? { userId, email: "", name: null, tickers: [], updatedAt: new Date().toISOString() };
}

export function setWatchlist(user: { id: string; email: string; name: string | null }, ticker: string, action: "add" | "remove"): Watchlist {
  const s = read();
  const t = ticker.trim().toUpperCase();
  const wl = s[user.id] ?? { userId: user.id, email: user.email, name: user.name, tickers: [], updatedAt: "" };
  wl.email = user.email;
  wl.name = user.name;
  const set = new Set(wl.tickers);
  if (action === "add") set.add(t);
  else set.delete(t);
  wl.tickers = [...set].sort();
  wl.updatedAt = new Date().toISOString();
  s[user.id] = wl;
  write(s);
  return wl;
}

export function getAllWatchlists(): Watchlist[] {
  return Object.values(read()).sort((a, b) => a.email.localeCompare(b.email));
}

/** Every distinct ticker followed by anyone — the scan set for the cron. */
export function getAllWatchedTickers(): string[] {
  const set = new Set<string>();
  for (const wl of Object.values(read())) for (const t of wl.tickers) set.add(t);
  return [...set].sort();
}
